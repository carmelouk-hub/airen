import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { BookingApplicationService } from "../../packages/booking-core/src/application-service.ts";
import {
  transitionGuestQueueEntry,
  transitionReservation,
  type ReservationQueueDependencies
} from "../../packages/ristoairen/src/reservations/reservation-queue-service.ts";
import {
  PostgresRistoBookingReadRepository,
  PostgresRistoBookingUnitOfWork
} from "../../packages/persistence-postgres/src/risto-booking-repository.ts";
import { PostgresGuestServiceOrderUnitOfWork } from "../../packages/persistence-postgres/src/risto-guest-service-order-runtime.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
const TENANT = "b4100000-0000-4410-8410-000000000001";
const LOCATION = "b4100000-0000-4410-8410-000000000002";
const ACTOR = "b4100000-0000-4410-8410-000000000003";
const QUEUE = "b4100000-0000-4410-8410-000000000011";
const LEGACY_BOOKING = "b4100000-0000-4410-8410-000000000099";
const CURSOR_KEY = "mat041-phase-b-booking-cursor-proof-key-20260915-000000";

function context(correlationId: string): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: ACTOR,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: "mat041-phase-b-tenant-membership",
    locationMembershipId: "mat041-phase-b-location-membership",
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions: [
      "reservation.manage",
      "queue.manage",
      "booking.read",
      "booking.create",
      "booking.update",
      "booking.status.update"
    ],
    entitlements: ["vertical.ristoairen", "reservations.enabled", "airen.booking"]
  });
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}

const accessGuard = Object.freeze({
  assertBookingAccess(ctx: SecurityContext): void {
    if (!ctx.entitlements.includes("airen.booking")) {
      throw new AppError("ENTITLEMENT_REQUIRED", "airen.booking entitlement is required");
    }
  }
});

const reads = new PostgresRistoBookingReadRepository(pool, CURSOR_KEY);
const bookingUow = new PostgresRistoBookingUnitOfWork(pool);
const booking = new BookingApplicationService(reads, bookingUow, accessGuard);
const guestServiceUow = new PostgresGuestServiceOrderUnitOfWork(pool);

async function seedScope(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT}','mat041-phase-b','MAT041 Phase B Synthetic');

    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,is_primary,status)
    VALUES ('${LOCATION}','${TENANT}','main','MAT041 Phase B Main','Europe/Rome',true,'active');

    INSERT INTO identity.identities (id,display_name)
    VALUES ('${ACTOR}','MAT041 Phase B Operator');

    INSERT INTO ristoairen.guest_queue_entries
      (id,tenant_id,location_id,request_key,booking_id,status,party_size,row_version,environment_class)
    VALUES
      ('${QUEUE}','${TENANT}','${LOCATION}','mat041-phase-b-queue',NULL,'WAITING',2,1,'TEST_TEMPORARY');
  `);
}

test.after(async () => {
  await pool.end();
});

test("RISTO-MAT-041 Phase B retires the legacy Reservation adapter without breaking Queue or AIRen Booking", async (t) => {
  await seedScope();

  await t.test("active runtime source contains no legacy Booking ledger SQL", async () => {
    const reservationSource = await readFile(
      new URL("../../packages/ristoairen/src/reservations/reservation-queue-service.ts", import.meta.url),
      "utf8"
    );
    const persistenceSource = await readFile(
      new URL("../../packages/persistence-postgres/src/risto-guest-service-order-runtime.ts", import.meta.url),
      "utf8"
    );

    assert.equal(reservationSource.includes("RESERVATION_TRANSITIONS"), false);
    assert.equal(persistenceSource.includes("ristoairen.bookings"), false);
    assert.equal(persistenceSource.includes("getBookingForTransition"), false);
    assert.equal(persistenceSource.includes("transitionBooking"), false);
  });

  await t.test("legacy Reservation transition fails closed before opening persistence and synthesizes no status mapping", async () => {
    let transactionOpened = false;
    const dependencies = {
      unitOfWork: {
        async transaction(): Promise<never> {
          transactionOpened = true;
          throw new Error("legacy transaction must not open");
        }
      }
    } as unknown as ReservationQueueDependencies;

    const beforeLegacy = await pool.query("SELECT count(*)::int AS count FROM ristoairen.bookings");
    const beforeCanonical = await pool.query("SELECT count(*)::int AS count FROM public.risto_bookings");

    await assert.rejects(
      transitionReservation(
        context("mat041-phase-b-retired-reservation"),
        { bookingId: LEGACY_BOOKING, expectedRowVersion: 1, nextStatus: "CHECKED_IN" },
        dependencies
      ),
      (error: unknown) => hasCode(error, "RUNTIME_CONFIGURATION_INVALID")
    );

    assert.equal(transactionOpened, false);

    const afterLegacy = await pool.query("SELECT count(*)::int AS count FROM ristoairen.bookings");
    const afterCanonical = await pool.query("SELECT count(*)::int AS count FROM public.risto_bookings");
    assert.equal(afterLegacy.rows[0].count, beforeLegacy.rows[0].count);
    assert.equal(afterCanonical.rows[0].count, beforeCanonical.rows[0].count);
  });

  await t.test("GuestQueue transition remains operational on the preserved runtime", async () => {
    const updated = await transitionGuestQueueEntry(
      context("mat041-phase-b-queue"),
      { queueEntryId: QUEUE, expectedRowVersion: 1, nextStatus: "CALLED" },
      { unitOfWork: guestServiceUow, now: () => "2026-09-20T18:00:00.000Z" }
    );

    assert.equal(updated.status, "CALLED");
    assert.equal(updated.rowVersion, 2);

    const persisted = await pool.query(
      "SELECT status,row_version AS \"rowVersion\" FROM ristoairen.guest_queue_entries WHERE id=$1::uuid",
      [QUEUE]
    );
    assert.deepEqual(persisted.rows[0], { status: "CALLED", rowVersion: 2 });
  });

  await t.test("airen_app cannot mutate the historical Booking ledger", async () => {
    const privileges = await pool.query(`
      SELECT has_table_privilege('airen_app','ristoairen.bookings','SELECT') AS can_select,
             has_table_privilege('airen_app','ristoairen.bookings','INSERT') AS can_insert,
             has_table_privilege('airen_app','ristoairen.bookings','UPDATE') AS can_update,
             has_table_privilege('airen_app','ristoairen.bookings','DELETE') AS can_delete,
             has_table_privilege('airen_app','ristoairen.bookings','TRUNCATE') AS can_truncate
    `);
    assert.deepEqual(privileges.rows[0], {
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_truncate: false
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE airen_app");
      await client.query(
        "SELECT set_config('airen.tenant_id',$1,true),set_config('airen.location_id',$2,true)",
        [TENANT, LOCATION]
      );
      await assert.rejects(
        client.query(
          `INSERT INTO ristoairen.bookings
            (id,tenant_id,location_id,request_key,status,party_size,row_version,environment_class)
           VALUES ($1::uuid,$2::uuid,$3::uuid,'mat041-phase-b-forbidden','PENDING',2,1,'TEST_TEMPORARY')`,
          [LEGACY_BOOKING, TENANT, LOCATION]
        ),
        (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42501")
      );
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); }
    }
  });

  await t.test("canonical AIRen Booking remains the sole mutable authority and keeps ARRIVED semantics", async () => {
    const created = await booking.create(
      context("mat041-phase-b-create"),
      {
        source: "MAT041_PHASE_B_E2E",
        partySize: 2,
        bookingDate: "2026-09-20",
        bookingTimeLocal: "20:30",
        expectedDurationMinutes: 120,
        customerNameSnapshot: "MAT041 Phase B Guest"
      },
      "mat041-phase-b-create-1"
    );
    assert.equal(created.booking.status, "REQUESTED");
    assert.equal(created.booking.rowVersion, 1);

    const confirmed = await booking.transitionStatus(
      context("mat041-phase-b-confirm"),
      created.booking.id,
      { requestedStatus: "CONFIRMED", rowVersion: 1 },
      "mat041-phase-b-confirm-1"
    );
    assert.equal(confirmed.booking.status, "CONFIRMED");
    assert.equal(confirmed.booking.rowVersion, 2);

    const arrived = await booking.transitionStatus(
      context("mat041-phase-b-arrive"),
      created.booking.id,
      { requestedStatus: "ARRIVED", rowVersion: 2 },
      "mat041-phase-b-arrive-1"
    );
    assert.equal(arrived.booking.status, "ARRIVED");
    assert.equal(arrived.booking.rowVersion, 3);
    assert.ok(arrived.booking.arrivalAt);

    const legacy = await pool.query("SELECT count(*)::int AS count FROM ristoairen.bookings");
    assert.equal(legacy.rows[0].count, 0);
  });
});
