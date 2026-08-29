import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { BookingHoldApplicationService } from "../../packages/ristoairen/src/booking/index.ts";
import { createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingHoldUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-hold-repository.ts";
import { PostgresRistoBookingHoldLifecycle } from "../../packages/persistence-postgres/src/risto-booking-hold-lifecycle.ts";
import { T20, cleanupT20BookingData, seedT20BookingTopology, securityContext } from "../helpers/t20-booking-fixtures.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const service = new BookingHoldApplicationService(
  new PostgresRistoBookingHoldUnitOfWork(pool),
  { assertRistoAirenAccess: () => undefined }
);
const lifecycle = new PostgresRistoBookingHoldLifecycle(pool);

const manager = () => securityContext({
  actorIdentityId: T20.managerA,
  tenantId: T20.tenantA,
  locationId: T20.locationA1,
  role: "manager",
  permissions: ["booking.read","booking.create","booking.update","booking.status.update"],
  correlationId: `rbl02-lifecycle-${crypto.randomUUID()}`
});

async function applyHoldMigration(): Promise<void> {
  const url = new URL("../../packages/persistence-postgres/src/migrations/20260829_001_risto_booking_holds.sql", import.meta.url);
  await pool.query(await readFile(url, "utf8"));
}

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM risto_booking_holds WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await cleanupT20BookingData(pool);
  await pool.query(`DELETE FROM risto_booking_guarantee_policies WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_booking_capacity_slots WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
}

async function seedResource(resourceKey: string): Promise<void> {
  await pool.query(
    `INSERT INTO risto_booking_capacity_slots
      (tenant_id,location_id,resource_key,starts_at,ends_at,capacity_total,status,created_by_identity_id,updated_by_identity_id)
     VALUES ($1,$2,$3,'2026-09-01T17:00:00Z','2026-09-01T21:00:00Z',4,'active',$4,$4)
     ON CONFLICT (tenant_id,location_id,resource_key,starts_at,ends_at)
     DO UPDATE SET capacity_total=4,status='active',updated_at=now()`,
    [T20.tenantA,T20.locationA1,resourceKey,T20.managerA]
  );
  await pool.query(
    `INSERT INTO risto_booking_guarantee_policies
      (tenant_id,location_id,source_channel,resource_key,min_party_size,max_party_size,effective_from,effective_until,
       guarantee_mode,hold_duration_seconds,priority,status,created_by_identity_id,updated_by_identity_id)
     VALUES ($1,$2,'DIRECT_WEB',$3,1,100,'2026-08-01','2026-12-31','NONE',600,100,'active',$4,$4)`,
    [T20.tenantA,T20.locationA1,resourceKey,T20.managerA]
  );
}

const createInput = (resourceKey: string, partySize = 4) => Object.freeze({
  sourceChannel: "DIRECT_WEB",
  resourceKey,
  partySize,
  bookingDate: "2026-09-01",
  bookingTimeLocal: "20:00",
  expectedDurationMinutes: 120,
  customerNameSnapshot: `Lifecycle ${resourceKey}`
});

test.before(async () => {
  await seedT20BookingTopology(pool);
  await applyHoldMigration();
  await cleanup();
  await seedResource("DINNER_EXP");
  await seedResource("DINNER_CONV");
});

test.after(async () => {
  await cleanup();
  await pool.end();
});

test("RBL02-L01 expiry transitions the due hold once and releases capacity", async () => {
  const context = manager();
  const created = await service.create(context, createInput("DINNER_EXP"), "rbl02-exp-create");
  assert.equal(created.hold.status, "GUARANTEED");

  await pool.query(
    `UPDATE risto_booking_holds SET expires_at=now()-interval '1 second' WHERE id=$1`,
    [created.hold.id]
  );

  const expired = await lifecycle.expireDue(context, new Date());
  assert.equal(expired.length, 1);
  assert.equal(expired[0].id, created.hold.id);
  assert.equal(expired[0].status, "EXPIRED");

  const repeated = await lifecycle.expireDue(context, new Date());
  assert.equal(repeated.length, 0);

  const replacement = await service.create(manager(), createInput("DINNER_EXP"), "rbl02-exp-replacement");
  assert.equal(replacement.hold.status, "GUARANTEED");
  assert.equal(replacement.hold.capacityClaim, 4);

  const audit = await pool.query(
    `SELECT count(*)::int AS c FROM audit.audit_events WHERE resource_id=$1 AND action_key='BOOKING_HOLD_EXPIRED'`,
    [created.hold.id]
  );
  const outbox = await pool.query(
    `SELECT count(*)::int AS c FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='booking.hold.expired.v1'`,
    [created.hold.id]
  );
  assert.equal(audit.rows[0].c, 1);
  assert.equal(outbox.rows[0].c, 1);
});

test("RBL02-L02 conversion atomically replaces hold capacity with one canonical Booking", async () => {
  const context = manager();
  const created = await service.create(context, createInput("DINNER_CONV"), "rbl02-conv-create");
  assert.equal(created.hold.status, "GUARANTEED");

  const converted = await lifecycle.convert(context, created.hold.id, created.hold.rowVersion, "rbl02-convert-1");
  assert.equal(converted.replayed, false);
  assert.equal(converted.hold.status, "CONVERTED");
  assert.equal(converted.hold.conversionBookingId, converted.booking.id);
  assert.equal(converted.booking.status, "REQUESTED");
  assert.equal(converted.booking.partySize, 4);

  const link = await pool.query(
    `SELECT h.capacity_slot_id::text AS hold_slot,b.capacity_slot_id::text AS booking_slot,h.conversion_booking_id::text AS conversion_booking_id
       FROM risto_booking_holds h JOIN risto_bookings b ON b.id=h.conversion_booking_id
      WHERE h.id=$1`,
    [created.hold.id]
  );
  assert.equal(link.rows[0].hold_slot, link.rows[0].booking_slot);
  assert.equal(link.rows[0].conversion_booking_id, converted.booking.id);

  const replay = await lifecycle.convert(context, created.hold.id, created.hold.rowVersion, "rbl02-convert-1");
  assert.equal(replay.replayed, true);
  assert.equal(replay.booking.id, converted.booking.id);
  assert.equal(replay.hold.id, converted.hold.id);

  const bookingCount = await pool.query(
    `SELECT count(*)::int AS c FROM risto_bookings WHERE id=$1`,
    [converted.booking.id]
  );
  assert.equal(bookingCount.rows[0].c, 1);

  await assert.rejects(
    () => service.create(manager(), createInput("DINNER_CONV", 1), "rbl02-conv-overbook"),
    (error: any) => error instanceof AppError && error.code === "CONFLICT" && error.message === "BOOKING_CAPACITY_EXCEEDED"
  );

  const holdAudit = await pool.query(
    `SELECT count(*)::int AS c FROM audit.audit_events WHERE resource_id=$1 AND action_key='BOOKING_HOLD_CONVERTED'`,
    [created.hold.id]
  );
  const holdOutbox = await pool.query(
    `SELECT count(*)::int AS c FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='booking.hold.converted.v1'`,
    [created.hold.id]
  );
  const bookingAudit = await pool.query(
    `SELECT count(*)::int AS c FROM audit.audit_events WHERE resource_id=$1 AND action_key='BOOKING_CREATED'`,
    [converted.booking.id]
  );
  const bookingOutbox = await pool.query(
    `SELECT count(*)::int AS c FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='booking.created.v1'`,
    [converted.booking.id]
  );
  assert.equal(holdAudit.rows[0].c, 1);
  assert.equal(holdOutbox.rows[0].c, 1);
  assert.equal(bookingAudit.rows[0].c, 1);
  assert.equal(bookingOutbox.rows[0].c, 1);
});

test("RBL02-L03 conversion idempotency key rejects semantic mismatch", async () => {
  const context = manager();
  const current = await pool.query(
    `SELECT id::text,row_version::int FROM risto_booking_holds WHERE resource_key='DINNER_CONV' AND status='CONVERTED' ORDER BY created_at DESC LIMIT 1`
  );
  assert.equal(current.rows.length, 1);
  await assert.rejects(
    () => lifecycle.convert(context, current.rows[0].id, Number(current.rows[0].row_version), "rbl02-convert-1"),
    (error: any) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});
