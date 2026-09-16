import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { AIREN_BOOKING_ENTITLEMENT, type BookingReadRepository } from "../../packages/booking-core/src/contracts.ts";
import { BookingApplicationService } from "../../packages/booking-core/src/application-service.ts";
import { PostgresFoundationReadStore } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-repository.ts";
import { PostgresRistoPublicSelfServiceRepository } from "../../packages/persistence-postgres/src/risto-public-self-service.ts";
import { RistoPublicSelfServiceApplicationService } from "../../packages/ristoairen/src/public-self-service/application-service.ts";
import { PUBLIC_SELF_SERVICE_BOOKING_SOURCE, PUBLIC_SELF_SERVICE_IDENTITY_ID } from "../../packages/ristoairen/src/public-self-service/contracts.ts";
import { dispatchPublicBookingApiRequest } from "../../apps/api/src/public-booking-api.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

const TENANT = "c0011000-0000-4000-8000-000000000001";
const LOCATION = "c0011000-0000-4000-8000-000000000002";
const OTHER_TENANT = "c0012000-0000-4000-8000-000000000001";
const OTHER_LOCATION = "c0012000-0000-4000-8000-000000000002";
const BOOKING_CREDENTIAL = Buffer.alloc(32, 0x41).toString("base64url");
const WRONG_CREDENTIAL = Buffer.alloc(32, 0x42).toString("base64url");
const QUEUE_CREDENTIAL = Buffer.alloc(32, 0x43).toString("base64url");
const hash = (credential: string) => createHash("sha256").update(Buffer.from(credential, "base64url")).digest("hex");

const resolver = Object.freeze({
  async resolveFromHostname(hostname: string) {
    if (hostname === "c001.example.test") return Object.freeze({ tenantId: TENANT, locationId: LOCATION, hostname, canonicalOrigin: `https://${hostname}` });
    if (hostname === "other.example.test") return Object.freeze({ tenantId: OTHER_TENANT, locationId: OTHER_LOCATION, hostname, canonicalOrigin: `https://${hostname}` });
    return null;
  }
});

const reads: BookingReadRepository = Object.freeze({
  async query() { throw new AppError("RUNTIME_CONFIGURATION_INVALID", "tenant-wide read forbidden"); },
  async findVisibleById() { throw new AppError("RUNTIME_CONFIGURATION_INVALID", "raw id read forbidden"); },
});
const accessGuard = Object.freeze({
  assertBookingAccess(context: SecurityContext): void {
    if (!context.entitlements.includes(AIREN_BOOKING_ENTITLEMENT)) throw new AppError("ENTITLEMENT_REQUIRED", "airen.booking required");
  }
});
const foundationReads = new PostgresFoundationReadStore(pool);
const booking = new BookingApplicationService(reads, new PostgresRistoBookingUnitOfWork(pool, "airen_app", "service"), accessGuard);
const service = new RistoPublicSelfServiceApplicationService(
  Object.freeze({ tenantResolver: resolver, entitlements: foundationReads, ownership: new PostgresRistoPublicSelfServiceRepository(pool) }),
  booking,
);

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES
      ('${TENANT}','mat041-c001','MAT041 C001 Synthetic'),
      ('${OTHER_TENANT}','mat041-c001-other','MAT041 C001 Other');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,is_primary,status) VALUES
      ('${LOCATION}','${TENANT}','main','C001 Main','Europe/Rome',true,'active'),
      ('${OTHER_LOCATION}','${OTHER_TENANT}','main','C001 Other Main','Europe/Rome',true,'active');
    INSERT INTO billing.entitlement_catalog (entitlement_key,description)
      VALUES ('airen.booking','AIRen Booking') ON CONFLICT (entitlement_key) DO NOTHING;
    INSERT INTO billing.tenant_entitlements (tenant_id,entitlement_key,source_kind,enabled)
      VALUES ('${TENANT}','airen.booking','test',true),('${OTHER_TENANT}','airen.booking','test',true);
    INSERT INTO ristoairen.guest_queue_entries
      (tenant_id,location_id,request_key,booking_id,status,party_size,row_version,environment_class)
      VALUES ('${TENANT}','${LOCATION}','${hash(QUEUE_CREDENTIAL)}',NULL,'WAITING',3,1,'TEST_TEMPORARY');
  `);
}

function hasCode(code: string) {
  return (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}

test.after(async () => { await pool.end(); });

test("RISTO-MAT-041 C001 exposes only credential-owned Booking/Queue self-service", async (t) => {
  await seed();

  let createdRowVersion = 0;
  await t.test("create delegates to canonical Booking with hashed ownership and service audit", async () => {
    const created = await service.createBooking({
      hostname: "c001.example.test", credential: BOOKING_CREDENTIAL, correlationId: "c001-create", idempotencyKey: "c001-create-1",
      booking: { partySize: 2, bookingDate: "2026-09-22", bookingTimeLocal: "20:30", expectedDurationMinutes: 120, customerNameSnapshot: "Synthetic Guest", phoneSnapshot: "+390000000000" }
    });
    assert.equal(created.replayed, false);
    assert.equal(created.booking.status, "REQUESTED");
    assert.equal("id" in created.booking, false);
    assert.equal("tenantId" in created.booking, false);
    assert.equal("locationId" in created.booking, false);
    assert.equal("source" in created.booking, false);
    createdRowVersion = created.booking.rowVersion;

    const stored = await pool.query("SELECT id,source,external_reference,created_by_identity_id::text AS actor FROM public.risto_bookings WHERE tenant_id=$1 AND location_id=$2", [TENANT, LOCATION]);
    assert.equal(stored.rowCount, 1);
    assert.equal(stored.rows[0].source, PUBLIC_SELF_SERVICE_BOOKING_SOURCE);
    assert.equal(stored.rows[0].external_reference, hash(BOOKING_CREDENTIAL));
    assert.equal(stored.rows[0].actor, PUBLIC_SELF_SERVICE_IDENTITY_ID);
    assert.equal(stored.rows[0].external_reference.includes(BOOKING_CREDENTIAL), false);

    const audit = await pool.query("SELECT actor_kind,actor_identity_id::text AS actor FROM audit.audit_events WHERE correlation_id='c001-create' AND action_key='BOOKING_CREATED'");
    assert.deepEqual(audit.rows[0], { actor_kind: "service", actor: PUBLIC_SELF_SERVICE_IDENTITY_ID });

    const replay = await service.createBooking({
      hostname: "c001.example.test", credential: BOOKING_CREDENTIAL, correlationId: "c001-create-replay", idempotencyKey: "c001-create-1",
      booking: { partySize: 2, bookingDate: "2026-09-22", bookingTimeLocal: "20:30", expectedDurationMinutes: 120, customerNameSnapshot: "Synthetic Guest", phoneSnapshot: "+390000000000" }
    });
    assert.equal(replay.replayed, true);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM public.risto_bookings WHERE tenant_id=$1", [TENANT])).rows[0].count, 1);
  });

  await t.test("wrong credential, cross-host use and raw UUID routes fail closed", async () => {
    await assert.rejects(service.getBooking({ hostname: "c001.example.test", credential: WRONG_CREDENTIAL, correlationId: "wrong" }), hasCode("NOT_FOUND"));
    await assert.rejects(service.getBooking({ hostname: "other.example.test", credential: BOOKING_CREDENTIAL, correlationId: "cross-host" }), hasCode("NOT_FOUND"));

    const rawProbe = await dispatchPublicBookingApiRequest({
      method: "GET", url: "/api/public/v1/self-service/booking/c0011000-0000-4000-8000-000000000099",
      headers: { host: "c001.example.test", "x-self-service-credential": BOOKING_CREDENTIAL, "x-correlation-id": "raw-probe" }
    }, service);
    assert.equal(rawProbe.status, 404);

    const spoof = await dispatchPublicBookingApiRequest({
      method: "POST", url: "/api/public/v1/self-service/booking",
      headers: { host: "c001.example.test", "x-self-service-credential": BOOKING_CREDENTIAL, "x-correlation-id": "spoof", "idempotency-key": "spoof-1" },
      body: { tenantId: OTHER_TENANT, partySize: 2, bookingDate: "2026-09-22", bookingTimeLocal: "20:30", expectedDurationMinutes: 120, customerNameSnapshot: "Spoof" }
    }, service);
    assert.equal(spoof.status, 403);
  });

  await t.test("owned update succeeds but public status surface is cancellation only", async () => {
    const updated = await service.updateBooking({
      hostname: "c001.example.test", credential: BOOKING_CREDENTIAL, correlationId: "c001-update", idempotencyKey: "c001-update-1",
      update: { rowVersion: createdRowVersion, partySize: 4 }
    });
    assert.equal(updated.booking.partySize, 4);
    assert.equal(updated.booking.rowVersion, createdRowVersion + 1);
    createdRowVersion = updated.booking.rowVersion;

    const forbiddenStatus = await dispatchPublicBookingApiRequest({
      method: "POST", url: "/api/public/v1/self-service/booking/status",
      headers: { host: "c001.example.test", "x-self-service-credential": BOOKING_CREDENTIAL, "x-correlation-id": "status-probe", "idempotency-key": "status-probe-1" },
      body: { requestedStatus: "CONFIRMED", rowVersion: createdRowVersion }
    }, service);
    assert.equal(forbiddenStatus.status, 404);
  });

  await t.test("cancel revokes Booking self-service ownership at the lifecycle boundary", async () => {
    const cancelled = await service.cancelBooking({
      hostname: "c001.example.test", credential: BOOKING_CREDENTIAL, correlationId: "c001-cancel", idempotencyKey: "c001-cancel-1",
      cancel: { rowVersion: createdRowVersion, reason: "guest_request" }
    });
    assert.equal(cancelled.booking.status, "CANCELLED");
    await assert.rejects(service.getBooking({ hostname: "c001.example.test", credential: BOOKING_CREDENTIAL, correlationId: "after-cancel" }), hasCode("NOT_FOUND"));
  });

  await t.test("Queue exposes only the own active credential projection and expires with lifecycle", async () => {
    const queue = await service.getQueue({ hostname: "c001.example.test", credential: QUEUE_CREDENTIAL, correlationId: "queue-read" });
    assert.deepEqual(Object.keys(queue).sort(), ["createdAt","kind","partySize","rowVersion","status","updatedAt"].sort());
    assert.equal(queue.status, "WAITING");
    await assert.rejects(service.getQueue({ hostname: "c001.example.test", credential: WRONG_CREDENTIAL, correlationId: "queue-wrong" }), hasCode("NOT_FOUND"));
    await pool.query("UPDATE ristoairen.guest_queue_entries SET status='SEATED',row_version=row_version+1 WHERE tenant_id=$1 AND location_id=$2 AND request_key=$3", [TENANT, LOCATION, hash(QUEUE_CREDENTIAL)]);
    await assert.rejects(service.getQueue({ hostname: "c001.example.test", credential: QUEUE_CREDENTIAL, correlationId: "queue-seated" }), hasCode("NOT_FOUND"));
  });

  await t.test("legacy Booking ledger remains empty and no CHECKED_IN mapping is synthesized", async () => {
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ristoairen.bookings")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM public.risto_bookings WHERE status='ARRIVED'")).rows[0].count, 0);
  });
});
