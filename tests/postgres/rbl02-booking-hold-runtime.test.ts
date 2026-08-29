import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { BookingHoldApplicationService } from "../../packages/ristoairen/src/booking/index.ts";
import { createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingHoldUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-hold-repository.ts";
import { T20, cleanupT20BookingData, seedT20BookingTopology, securityContext } from "../helpers/t20-booking-fixtures.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const service = new BookingHoldApplicationService(
  new PostgresRistoBookingHoldUnitOfWork(pool),
  { assertRistoAirenAccess: () => undefined }
);

const manager = (tenantId = T20.tenantA, locationId = T20.locationA1, actorIdentityId = T20.managerA) =>
  securityContext({
    actorIdentityId,
    tenantId,
    locationId,
    role: "manager",
    permissions: ["booking.read","booking.create","booking.update","booking.status.update"],
    correlationId: `rbl02-runtime-${crypto.randomUUID()}`
  });

async function applyHoldMigration(): Promise<void> {
  const url = new URL("../../packages/persistence-postgres/src/migrations/20260829_001_risto_booking_holds.sql", import.meta.url);
  const sql = await readFile(url, "utf8");
  await pool.query(sql);
}

async function cleanupHoldData(): Promise<void> {
  await pool.query(`DELETE FROM risto_booking_holds WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_booking_guarantee_policies WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_booking_capacity_slots WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await cleanupT20BookingData(pool);
}

async function seedResource(resourceKey: string, capacityTotal: number, priority: number): Promise<void> {
  await pool.query(
    `INSERT INTO risto_booking_capacity_slots
      (tenant_id,location_id,resource_key,starts_at,ends_at,capacity_total,status,created_by_identity_id,updated_by_identity_id)
     VALUES ($1,$2,$3,'2026-09-01T17:00:00Z','2026-09-01T21:00:00Z',$4,'active',$5,$5)
     ON CONFLICT (tenant_id,location_id,resource_key,starts_at,ends_at)
     DO UPDATE SET capacity_total=EXCLUDED.capacity_total,status='active',updated_at=now()`,
    [T20.tenantA,T20.locationA1,resourceKey,capacityTotal,T20.managerA]
  );
  await pool.query(
    `INSERT INTO risto_booking_guarantee_policies
      (tenant_id,location_id,source_channel,resource_key,min_party_size,max_party_size,effective_from,effective_until,
       guarantee_mode,hold_duration_seconds,priority,status,created_by_identity_id,updated_by_identity_id)
     VALUES ($1,$2,'DIRECT_WEB',$3,1,100,'2026-08-01','2026-12-31','NONE',600,$4,'active',$5,$5)`,
    [T20.tenantA,T20.locationA1,resourceKey,priority,T20.managerA]
  );
}

const createInput = (resourceKey = "DINNER", partySize = 2) => Object.freeze({
  sourceChannel: "DIRECT_WEB",
  resourceKey,
  partySize,
  bookingDate: "2026-09-01",
  bookingTimeLocal: "20:00",
  expectedDurationMinutes: 120,
  customerNameSnapshot: "Synthetic Hold Guest"
});

test.before(async () => {
  await seedT20BookingTopology(pool);
  await applyHoldMigration();
  await cleanupHoldData();
  await seedResource("DINNER", 4, 100);
  await seedResource("DINNER_CONC", 4, 200);
});

test.after(async () => {
  await cleanupHoldData();
  await pool.end();
});

let primaryHoldId = "";
let primaryRowVersion = 0;

test("RBL02-R01 hold migration is re-applicable without schema drift", async () => {
  await assert.doesNotReject(() => applyHoldMigration());
});

test("RBL02-R02 create claims capacity and NONE policy reaches GUARANTEED", async () => {
  const result = await service.create(manager(), createInput(), "rbl02-create-1");
  assert.equal(result.replayed, false);
  assert.equal(result.hold.status, "GUARANTEED");
  assert.equal(result.hold.capacityClaim, 2);
  primaryHoldId = result.hold.id;
  primaryRowVersion = result.hold.rowVersion;
});

test("RBL02-R03 persisted hold is TEST_TEMPORARY and trusted-scope bound", async () => {
  const result = await pool.query(
    `SELECT tenant_id::text,location_id::text,environment_class,capacity_slot_id IS NOT NULL AS has_slot
       FROM risto_booking_holds WHERE id=$1`,
    [primaryHoldId]
  );
  assert.deepEqual(result.rows[0], {
    tenant_id: T20.tenantA,
    location_id: T20.locationA1,
    environment_class: "TEST_TEMPORARY",
    has_slot: true
  });
});

test("RBL02-R04 retry with same key and payload replays without duplicate hold", async () => {
  const result = await service.create(manager(), createInput(), "rbl02-create-1");
  assert.equal(result.replayed, true);
  assert.equal(result.hold.id, primaryHoldId);
  const count = await pool.query(`SELECT count(*)::int AS c FROM risto_booking_holds WHERE id=$1`, [primaryHoldId]);
  assert.equal(count.rows[0].c, 1);
});

test("RBL02-R05 semantic mismatch on reused key fails closed", async () => {
  await assert.rejects(
    () => service.create(manager(), createInput("DINNER", 3), "rbl02-create-1"),
    (error: any) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("RBL02-R06 create emits exactly one minimized audit and outbox event", async () => {
  const audit = await pool.query(
    `SELECT count(*)::int AS c FROM audit.audit_events
      WHERE resource_id=$1 AND action_key='BOOKING_HOLD_CREATED'`,
    [primaryHoldId]
  );
  const outbox = await pool.query(
    `SELECT payload FROM events.outbox_events
      WHERE aggregate_id=$1 AND event_type='booking.hold.created.v1'`,
    [primaryHoldId]
  );
  assert.equal(audit.rows[0].c, 1);
  assert.equal(outbox.rows.length, 1);
  assert.deepEqual(
    Object.keys(outbox.rows[0].payload).sort(),
    ["hold_id","status","starts_at","capacity_claim","expires_at","guarantee_mode"].sort()
  );
});

test("RBL02-R07 cross-tenant mutation sees the hold as not visible", async () => {
  await assert.rejects(
    () => service.cancel(
      manager(T20.tenantB,T20.locationB1,T20.managerB),
      primaryHoldId,
      { rowVersion: primaryRowVersion, reason: "cross_tenant_attempt" },
      "rbl02-cross-tenant"
    ),
    (error: any) => error instanceof AppError && error.code === "NOT_FOUND"
  );
});

test("RBL02-R08 concurrent capacity claims serialize and only one oversubscribing request succeeds", async () => {
  const calls = [
    service.create(manager(), createInput("DINNER_CONC", 3), "rbl02-conc-a"),
    service.create(manager(), createInput("DINNER_CONC", 3), "rbl02-conc-b")
  ];
  const results = await Promise.allSettled(calls);
  const fulfilled = results.filter((entry) => entry.status === "fulfilled");
  const rejected = results.filter((entry) => entry.status === "rejected") as PromiseRejectedResult[];
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof AppError);
  assert.equal(rejected[0].reason.code, "CONFLICT");
  assert.equal(rejected[0].reason.message, "BOOKING_CAPACITY_EXCEEDED");
});

test("RBL02-R09 cancellation releases capacity for a subsequent full claim", async () => {
  const cancelled = await service.cancel(
    manager(),
    primaryHoldId,
    { rowVersion: primaryRowVersion, reason: "guest_cancelled" },
    "rbl02-cancel-primary"
  );
  assert.equal(cancelled.hold.status, "CANCELLED");
  const replacement = await service.create(manager(), createInput("DINNER", 4), "rbl02-replacement");
  assert.equal(replacement.hold.status, "GUARANTEED");
  assert.equal(replacement.hold.capacityClaim, 4);
});

test("RBL02-R10 cancelled hold emits one cancellation audit/outbox and cannot consume active capacity", async () => {
  const audit = await pool.query(
    `SELECT count(*)::int AS c FROM audit.audit_events
      WHERE resource_id=$1 AND action_key='BOOKING_HOLD_CANCELLED'`,
    [primaryHoldId]
  );
  const outbox = await pool.query(
    `SELECT count(*)::int AS c FROM events.outbox_events
      WHERE aggregate_id=$1 AND event_type='booking.hold.cancelled.v1'`,
    [primaryHoldId]
  );
  assert.equal(audit.rows[0].c, 1);
  assert.equal(outbox.rows[0].c, 1);
  const state = await pool.query(`SELECT status FROM risto_booking_holds WHERE id=$1`, [primaryHoldId]);
  assert.equal(state.rows[0].status, "CANCELLED");
});
