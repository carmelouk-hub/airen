import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { recordPayment } from "../../packages/ristoairen/src/pos/payment-record.ts";
import { PostgresPaymentRecordUnitOfWork } from "../../packages/persistence-postgres/src/risto-payment-record.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "22222222-2222-4222-8222-222222222222";
const IDENTITY_A = "33333333-3333-4333-8333-333333333333";
const ORDER_A = "44444444-4444-4444-8444-444444444441";
const ORDER_B = "44444444-4444-4444-8444-444444444442";
const TENANT_B = "55555555-5555-4555-8555-555555555555";
const LOCATION_B = "66666666-6666-4666-8666-666666666666";
const IDENTITY_B = "77777777-7777-4777-8777-777777777777";
const ORDER_OTHER = "88888888-8888-4888-8888-888888888888";

function context(correlationId: string): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: IDENTITY_A,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT_A,
    locationId: LOCATION_A,
    tenantMembershipId: "mat014-tm",
    locationMembershipId: "mat014-lm",
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions: ["pos.payment.record"],
    entitlements: ["vertical.ristoairen"]
  });
}

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name) VALUES
      ('${TENANT_A}', 'mat014-a', 'MAT014 A'),
      ('${TENANT_B}', 'mat014-b', 'MAT014 B');
    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone) VALUES
      ('${LOCATION_A}', '${TENANT_A}', 'main', 'Main A', 'Europe/Rome'),
      ('${LOCATION_B}', '${TENANT_B}', 'main', 'Main B', 'Europe/Rome');
    INSERT INTO identity.identities (id, display_name) VALUES
      ('${IDENTITY_A}', 'MAT014 Operator A'),
      ('${IDENTITY_B}', 'MAT014 Operator B');
    INSERT INTO ristoairen.orders
      (id, tenant_id, location_id, channel, status, currency,
       subtotal, discount_total, tax_total, total, opened_at,
       created_by_identity_id, version, environment_class)
    VALUES
      ('${ORDER_A}', '${TENANT_A}', '${LOCATION_A}', 'POS', 'BILLING', 'EUR', 100, 0, 0, 100, now(), '${IDENTITY_A}', 1, 'TEST_TEMPORARY'),
      ('${ORDER_B}', '${TENANT_A}', '${LOCATION_A}', 'POS', 'BILLING', 'EUR', 100, 0, 0, 100, now(), '${IDENTITY_A}', 1, 'TEST_TEMPORARY'),
      ('${ORDER_OTHER}', '${TENANT_B}', '${LOCATION_B}', 'POS', 'BILLING', 'EUR', 100, 0, 0, 100, now(), '${IDENTITY_B}', 1, 'TEST_TEMPORARY');
  `);
}

test("MAT-014 PostgreSQL payment persistence boundary", async (t) => {
  await seed();
  t.after(async () => { await pool.end(); });

  const uow = new PostgresPaymentRecordUnitOfWork(pool);

  const first = await recordPayment(
    context("mat014-first"),
    { orderId: ORDER_A, paymentMethod: "CASH", amount: "30.00", currency: "EUR", idempotencyKey: "mat014-idem-a" },
    { unitOfWork: uow, now: () => "2026-09-10T09:10:00.000Z" }
  );
  assert.equal(first.replayed, false);
  assert.equal(first.payment.amount, "30.00");

  const replay = await recordPayment(
    context("mat014-replay"),
    { orderId: ORDER_A, paymentMethod: "CASH", amount: "30.00", currency: "EUR", idempotencyKey: "mat014-idem-a" },
    { unitOfWork: uow, now: () => "2026-09-10T09:11:00.000Z" }
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.payment.id, first.payment.id);

  const persisted = await pool.query(
    "SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1 AND location_id=$2 AND order_id=$3",
    [TENANT_A, LOCATION_A, ORDER_A]
  );
  assert.equal(persisted.rows[0].count, 1);

  const audit = await pool.query(
    "SELECT action_key, correlation_id, resource_id FROM audit.audit_events WHERE action_key='PAYMENT_RECORDED' AND resource_id=$1",
    [first.payment.id]
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].correlation_id, "mat014-first");

  // RLS must hide an Order belonging to another Tenant/Location even if its UUID is known.
  const hidden = await uow.transaction((tx) => tx.getOrderForPayment(ORDER_OTHER), context("mat014-rls"));
  assert.equal(hidden, null);

  // Different idempotency keys on the same Order still serialize on the Order advisory lock.
  // Exactly one 60 EUR payment can succeed against a 100 EUR outstanding balance.
  const concurrent = await Promise.allSettled([
    recordPayment(
      context("mat014-race-1"),
      { orderId: ORDER_B, paymentMethod: "CARD", amount: "60.00", currency: "EUR", idempotencyKey: "mat014-race-1" },
      { unitOfWork: uow, now: () => "2026-09-10T09:12:00.000Z" }
    ),
    recordPayment(
      context("mat014-race-2"),
      { orderId: ORDER_B, paymentMethod: "CARD", amount: "60.00", currency: "EUR", idempotencyKey: "mat014-race-2" },
      { unitOfWork: uow, now: () => "2026-09-10T09:12:01.000Z" }
    )
  ]);
  assert.equal(concurrent.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((x) => x.status === "rejected").length, 1);
  const rejected = concurrent.find((x): x is PromiseRejectedResult => x.status === "rejected");
  assert.ok(rejected?.reason instanceof AppError);
  assert.equal(rejected.reason.code, "CONFLICT");

  const racePayments = await pool.query(
    "SELECT count(*)::int AS count, coalesce(sum(amount),0)::text AS total FROM ristoairen.payments WHERE order_id=$1",
    [ORDER_B]
  );
  assert.equal(racePayments.rows[0].count, 1);
  assert.equal(racePayments.rows[0].total, "60.00");

  const raceAudits = await pool.query(
    "SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='PAYMENT_RECORDED' AND metadata->>'orderId'=$1",
    [ORDER_B]
  );
  assert.equal(raceAudits.rows[0].count, 1);
});
