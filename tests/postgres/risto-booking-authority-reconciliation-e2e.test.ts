import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { BookingApplicationService } from "../../packages/booking-core/src/application-service.ts";
import {
  PostgresRistoBookingReadRepository,
  PostgresRistoBookingUnitOfWork
} from "../../packages/persistence-postgres/src/risto-booking-repository.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
const TENANT = "a4100000-0000-4410-8410-000000000001";
const LOCATION = "a4100000-0000-4410-8410-000000000002";
const ACTOR = "a4100000-0000-4410-8410-000000000003";
const QUEUE = "a4100000-0000-4410-8410-000000000011";
const TABLE = "a4100000-0000-4410-8410-000000000020";
const SESSION = "a4100000-0000-4410-8410-000000000030";
const CURSOR_KEY = "mat041-booking-cursor-proof-key-20260915-000000000000";

function context(correlationId: string): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: ACTOR,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: "mat041-tenant-membership",
    locationMembershipId: "mat041-location-membership",
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions: ["booking.read", "booking.create", "booking.update", "booking.status.update"],
    entitlements: ["airen.booking"]
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
const uow = new PostgresRistoBookingUnitOfWork(pool);
const booking = new BookingApplicationService(reads, uow, accessGuard);

async function seedAuthorityScope(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT}','mat041','MAT041 Synthetic');

    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,is_primary,status)
    VALUES ('${LOCATION}','${TENANT}','main','MAT041 Main','Europe/Rome',true,'active');

    INSERT INTO identity.identities (id,display_name)
    VALUES ('${ACTOR}','MAT041 Booking Authority Operator');

    INSERT INTO ristoairen.dining_tables
      (id,tenant_id,location_id,code,operational_status,capacity,row_version,environment_class)
    VALUES
      ('${TABLE}','${TENANT}','${LOCATION}','MAT041-T1','ACTIVE',4,1,'TEST_TEMPORARY');
  `);
}

async function canonicalBookingForeignKeys(): Promise<Array<{ conname: string; source_table: string; ref_schema: string; ref_table: string }>> {
  const result = await pool.query(`
    SELECT c.conname,
           src.relname AS source_table,
           ref_ns.nspname AS ref_schema,
           ref.relname AS ref_table
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
      JOIN pg_class ref ON ref.oid = c.confrelid
      JOIN pg_namespace ref_ns ON ref_ns.oid = ref.relnamespace
     WHERE c.contype = 'f'
       AND src_ns.nspname = 'ristoairen'
       AND c.conname IN ('fk_risto_guest_queue_booking','fk_risto_service_session_booking')
     ORDER BY c.conname
  `);
  return result.rows;
}

test.after(async () => {
  await pool.end();
});

test("RISTO-MAT-041 Phase A reconciles C001 to the single AIRen Booking authority", async (t) => {
  await seedAuthorityScope();

  await t.test("legacy Booking ledger is empty and airen_app retains read-only compatibility", async () => {
    const count = await pool.query("SELECT count(*)::int AS count FROM ristoairen.bookings");
    assert.equal(count.rows[0].count, 0);

    const privileges = await pool.query(`
      SELECT has_table_privilege('airen_app','ristoairen.bookings','SELECT') AS can_select,
             has_table_privilege('airen_app','ristoairen.bookings','INSERT') AS can_insert,
             has_table_privilege('airen_app','ristoairen.bookings','UPDATE') AS can_update,
             has_table_privilege('airen_app','ristoairen.bookings','DELETE') AS can_delete,
             has_table_privilege('airen_app','ristoairen.bookings','TRUNCATE') AS can_truncate
    `);
    assert.equal(privileges.rows[0].can_select, true);
    assert.equal(privileges.rows[0].can_insert, false);
    assert.equal(privileges.rows[0].can_update, false);
    assert.equal(privileges.rows[0].can_delete, false);
    assert.equal(privileges.rows[0].can_truncate, false);
  });

  let bookingId = "";
  await t.test("canonical AIRen Booking authority is writable and preserves ARRIVED vocabulary", async () => {
    const created = await booking.create(
      context("mat041-create"),
      {
        source: "MAT041_E2E",
        partySize: 2,
        bookingDate: "2026-09-20",
        bookingTimeLocal: "20:30",
        expectedDurationMinutes: 120,
        customerNameSnapshot: "MAT041 Synthetic Guest"
      },
      "mat041-create-1"
    );
    bookingId = created.booking.id;
    assert.equal(created.booking.status, "REQUESTED");
    assert.equal(created.booking.rowVersion, 1);

    const confirmed = await booking.transitionStatus(
      context("mat041-confirm"),
      bookingId,
      { requestedStatus: "CONFIRMED", rowVersion: 1 },
      "mat041-confirm-1"
    );
    assert.equal(confirmed.booking.status, "CONFIRMED");
    assert.equal(confirmed.booking.rowVersion, 2);

    const arrived = await booking.transitionStatus(
      context("mat041-arrive"),
      bookingId,
      { requestedStatus: "ARRIVED", rowVersion: 2 },
      "mat041-arrive-1"
    );
    assert.equal(arrived.booking.status, "ARRIVED");
    assert.equal(arrived.booking.rowVersion, 3);
    assert.ok(arrived.booking.arrivalAt);

    const constraint = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid='public.risto_bookings'::regclass
         AND contype='c'
         AND pg_get_constraintdef(oid) LIKE '%status%'
    `);
    assert.ok(constraint.rows.some((row) => String(row.definition).includes("ARRIVED")));
  });

  await t.test("stale canonical row_version fails closed with CONFLICT", async () => {
    await assert.rejects(
      booking.update(
        context("mat041-stale-update"),
        bookingId,
        { partySize: 3, rowVersion: 1 },
        "mat041-stale-update-1"
      ),
      (error: unknown) => hasCode(error, "CONFLICT")
    );

    const current = await booking.get(context("mat041-read-after-stale"), bookingId);
    assert.equal(current.partySize, 2);
    assert.equal(current.status, "ARRIVED");
    assert.equal(current.rowVersion, 3);
  });

  await t.test("queue and service Booking foreign keys point to public.risto_bookings", async () => {
    const foreignKeys = await canonicalBookingForeignKeys();
    assert.deepEqual(
      foreignKeys,
      [
        { conname: "fk_risto_guest_queue_booking", source_table: "guest_queue_entries", ref_schema: "public", ref_table: "risto_bookings" },
        { conname: "fk_risto_service_session_booking", source_table: "service_sessions", ref_schema: "public", ref_table: "risto_bookings" }
      ]
    );

    await pool.query(
      `INSERT INTO ristoairen.guest_queue_entries
        (id,tenant_id,location_id,request_key,booking_id,status,party_size,row_version,environment_class)
       VALUES ($1,$2,$3,'mat041-queue',$4,'WAITING',2,1,'TEST_TEMPORARY')`,
      [QUEUE,TENANT,LOCATION,bookingId]
    );
    await pool.query(
      `INSERT INTO ristoairen.service_sessions
        (id,tenant_id,location_id,table_id,booking_id,status,row_version,environment_class,opened_at)
       VALUES ($1,$2,$3,$4,$5,'OPEN',1,'TEST_TEMPORARY','2026-09-20T18:30:00Z')`,
      [SESSION,TENANT,LOCATION,TABLE,bookingId]
    );

    const linked = await pool.query(
      `SELECT q.booking_id AS queue_booking_id, s.booking_id AS session_booking_id
         FROM ristoairen.guest_queue_entries q
         JOIN ristoairen.service_sessions s ON s.id=$2
        WHERE q.id=$1`,
      [QUEUE,SESSION]
    );
    assert.equal(linked.rows[0].queue_booking_id, bookingId);
    assert.equal(linked.rows[0].session_booking_id, bookingId);

    const legacy = await pool.query("SELECT count(*)::int AS count FROM ristoairen.bookings");
    assert.equal(legacy.rows[0].count, 0);
  });
});
