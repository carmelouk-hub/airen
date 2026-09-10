import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { approveRefund, requestRefund } from "../../packages/ristoairen/src/pos/refund-request.ts";
import { executeApprovedRefund } from "../../packages/ristoairen/src/pos/refund-effect.ts";
import { PostgresRefundRequestUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-request.ts";
import { PostgresRefundEffectUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-effect.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });

const TENANT_A = "23232323-1111-4111-8111-111111111111";
const LOCATION_A = "23232323-2222-4222-8222-222222222222";
const REQUESTER = "23232323-3333-4333-8333-333333333333";
const APPROVER = "23232323-4444-4444-8444-444444444444";
const EXECUTOR = "23232323-5555-4555-8555-555555555555";
const EXECUTOR_2 = "23232323-5555-4555-8555-555555555556";
const ORDER_A = "23232323-6666-4666-8666-666666666666";
const PAYMENT_A = "23232323-7777-4777-8777-777777777771";
const PREEXISTING_REFUND = "23232323-7777-4777-8777-777777777772";
const TENANT_B = "23232323-8888-4888-8888-888888888888";
const LOCATION_B = "23232323-9999-4999-8999-999999999999";
const ORDER_B = "23232323-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAYMENT_B = "23232323-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function context(
  actorIdentityId: string,
  correlationId: string,
  permissions: readonly string[],
  entitled = true,
  tenantId = TENANT_A,
  locationId = LOCATION_A
): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId,
    platformRoles: [],
    platformPermissions: [],
    tenantId,
    locationId,
    tenantMembershipId: `mat023-tm-${tenantId}`,
    locationMembershipId: `mat023-lm-${locationId}`,
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions,
    entitlements: entitled ? ["vertical.ristoairen"] : []
  });
}

const requestContext = (id: string) => context(REQUESTER, id, ["pos.refund.request"]);
const approveContext = (id: string) => context(APPROVER, id, ["pos.refund.approve"]);
const executeContext = (id: string, actor = EXECUTOR, permissions: readonly string[] = ["pos.refund.execute"], entitled = true) =>
  context(actor, id, permissions, entitled);

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT_A}','mat023-a','MAT023 A'),('${TENANT_B}','mat023-b','MAT023 B');

    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone)
    VALUES ('${LOCATION_A}','${TENANT_A}','main','MAT023 Main A','Europe/Rome'),
           ('${LOCATION_B}','${TENANT_B}','main','MAT023 Main B','Europe/Rome');

    INSERT INTO identity.identities (id,display_name)
    VALUES ('${REQUESTER}','MAT023 Requester'),('${APPROVER}','MAT023 Approver'),
           ('${EXECUTOR}','MAT023 Executor'),('${EXECUTOR_2}','MAT023 Executor 2');

    INSERT INTO ristoairen.orders
      (id,tenant_id,location_id,channel,status,currency,subtotal,discount_total,tax_total,total,opened_at,created_by_identity_id,version,environment_class)
    VALUES ('${ORDER_A}','${TENANT_A}','${LOCATION_A}','POS','PAID','EUR',50,0,0,50,now(),'${REQUESTER}',1,'TEST_TEMPORARY'),
           ('${ORDER_B}','${TENANT_B}','${LOCATION_B}','POS','PAID','EUR',70,0,0,70,now(),'${APPROVER}',1,'TEST_TEMPORARY');

    INSERT INTO ristoairen.payments
      (id,tenant_id,location_id,order_id,payment_method,amount,currency,status,received_at,recorded_by,idempotency_key,metadata_sanitized,row_version,environment_class)
    VALUES ('${PAYMENT_A}','${TENANT_A}','${LOCATION_A}','${ORDER_A}','CARD',50,'EUR','RECORDED',now(),'${REQUESTER}','mat023-original-a','{}',3,'TEST_TEMPORARY'),
           ('${PAYMENT_B}','${TENANT_B}','${LOCATION_B}','${ORDER_B}','CARD',70,'EUR','RECORDED',now(),'${APPROVER}','mat023-original-b','{}',1,'TEST_TEMPORARY');

    INSERT INTO ristoairen.payments
      (id,tenant_id,location_id,order_id,payment_method,amount,currency,status,received_at,recorded_by,refund_of_payment_id,idempotency_key,metadata_sanitized,row_version,environment_class)
    VALUES ('${PREEXISTING_REFUND}','${TENANT_A}','${LOCATION_A}','${ORDER_A}','CARD',10,'EUR','RECORDED',now(),'${REQUESTER}','${PAYMENT_A}','mat023-existing-refund','{}',1,'TEST_TEMPORARY');
  `);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

const requestUow = () => new PostgresRefundRequestUnitOfWork(pool);
const effectUow = () => new PostgresRefundEffectUnitOfWork(pool);

async function makeApprovedRequest(key: string, amount: string): Promise<{ id: string; rowVersion: number }> {
  const requested = await requestRefund(
    requestContext(`mat023-request-${key}`),
    {
      paymentId: PAYMENT_A,
      amount,
      reason: `MAT023 ${key}`,
      expectedPaymentRowVersion: 3,
      idempotencyKey: `mat023-request-${key}`
    },
    { unitOfWork: requestUow(), now: () => "2026-09-10T13:00:00.000Z" }
  );
  const approved = await approveRefund(
    approveContext(`mat023-approve-${key}`),
    { refundRequestId: requested.refundRequest.id, expectedRefundRequestRowVersion: 1 },
    { unitOfWork: requestUow(), now: () => "2026-09-10T13:01:00.000Z" }
  );
  return { id: approved.refundRequest.id, rowVersion: approved.refundRequest.rowVersion };
}

test("MAT-023 approved refund monetary effect runtime", async (t) => {
  await seed();
  t.after(async () => { await pool.end(); });

  const first = await makeApprovedRequest("first", "20.00");
  let firstEffectId = "";

  await t.test("APPROVED RefundRequest creates one append-only compensating Payment and one audit", async () => {
    const originalBefore = await pool.query(
      "SELECT amount::text AS amount,status,row_version,refund_of_payment_id FROM ristoairen.payments WHERE id=$1",
      [PAYMENT_A]
    );
    const requestBefore = await pool.query("SELECT status,row_version FROM ristoairen.refund_requests WHERE id=$1", [first.id]);
    const outboxBefore = await pool.query("SELECT count(*)::int AS count FROM events.outbox_events");

    const result = await executeApprovedRefund(
      executeContext("mat023-effect-first"),
      { refundRequestId: first.id, expectedRefundRequestRowVersion: first.rowVersion },
      { unitOfWork: effectUow(), now: () => "2026-09-10T13:02:00.000Z" }
    );

    firstEffectId = result.payment.id;
    assert.equal(result.replayed, false);
    assert.equal(result.refundRequestId, first.id);
    assert.equal(result.payment.amount, "20.00");
    assert.equal(result.payment.currency, "EUR");
    assert.equal(result.payment.paymentMethod, "CARD");
    assert.equal(result.payment.status, "RECORDED");
    assert.equal(result.payment.refundOfPaymentId, PAYMENT_A);
    assert.equal(result.payment.idempotencyKey, `refund-effect:${first.id}`);
    assert.equal(result.payment.providerReference, undefined);
    assert.equal(result.payment.recordedBy, EXECUTOR);
    assert.equal(result.payment.environmentClass, "TEST_TEMPORARY");
    assert.deepEqual(result.payment.metadataSanitized, { refundRequestId: first.id, workflow: "refund.effect" });

    const originalAfter = await pool.query(
      "SELECT amount::text AS amount,status,row_version,refund_of_payment_id FROM ristoairen.payments WHERE id=$1",
      [PAYMENT_A]
    );
    const requestAfter = await pool.query("SELECT status,row_version FROM ristoairen.refund_requests WHERE id=$1", [first.id]);
    assert.deepEqual(originalAfter.rows[0], originalBefore.rows[0]);
    assert.deepEqual(requestAfter.rows[0], requestBefore.rows[0]);

    const effectRows = await pool.query(
      "SELECT count(*)::int AS count FROM ristoairen.payments WHERE idempotency_key=$1 AND refund_of_payment_id=$2",
      [`refund-effect:${first.id}`, PAYMENT_A]
    );
    const audit = await pool.query(
      "SELECT actor_identity_id::text AS actor,correlation_id,metadata FROM audit.audit_events WHERE action_key='PAYMENT_REFUNDED' AND resource_id=$1",
      [firstEffectId]
    );
    const outboxAfter = await pool.query("SELECT count(*)::int AS count FROM events.outbox_events");
    assert.equal(effectRows.rows[0].count, 1);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].actor, EXECUTOR);
    assert.equal(audit.rows[0].correlation_id, "mat023-effect-first");
    assert.equal(audit.rows[0].metadata.refundRequestId, first.id);
    assert.equal(outboxAfter.rows[0].count, outboxBefore.rows[0].count);
  });

  await t.test("semantic replay returns the same compensating Payment with no second audit", async () => {
    const replay = await executeApprovedRefund(
      executeContext("mat023-effect-replay", EXECUTOR_2),
      { refundRequestId: first.id, expectedRefundRequestRowVersion: first.rowVersion },
      { unitOfWork: effectUow() }
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.payment.id, firstEffectId);
    assert.equal(replay.payment.recordedBy, EXECUTOR);
    const rows = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE idempotency_key=$1", [`refund-effect:${first.id}`]);
    const audit = await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='PAYMENT_REFUNDED' AND resource_id=$1", [firstEffectId]);
    assert.equal(rows.rows[0].count, 1);
    assert.equal(audit.rows[0].count, 1);
  });

  await t.test("PENDING request cannot create money", async () => {
    const pending = await requestRefund(
      requestContext("mat023-pending-request"),
      { paymentId: PAYMENT_A, amount: "1.00", reason: "pending", expectedPaymentRowVersion: 3, idempotencyKey: "mat023-pending" },
      { unitOfWork: requestUow() }
    );
    const before = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments");
    await expectCode(
      executeApprovedRefund(executeContext("mat023-pending-effect"), { refundRequestId: pending.refundRequest.id, expectedRefundRequestRowVersion: 1 }, { unitOfWork: effectUow() }),
      "CONFLICT"
    );
    const after = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments");
    const audit = await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='PAYMENT_REFUNDED' AND metadata->>'refundRequestId'=$1", [pending.refundRequest.id]);
    assert.equal(after.rows[0].count, before.rows[0].count);
    assert.equal(audit.rows[0].count, 0);
  });

  await t.test("request/approve permissions do not imply execute and entitlement is independently required", async () => {
    await expectCode(
      executeApprovedRefund(executeContext("mat023-request-only", EXECUTOR, ["pos.refund.request"]), { refundRequestId: first.id, expectedRefundRequestRowVersion: first.rowVersion }, { unitOfWork: effectUow() }),
      "PERMISSION_DENIED"
    );
    await expectCode(
      executeApprovedRefund(executeContext("mat023-approve-only", EXECUTOR, ["pos.refund.approve"]), { refundRequestId: first.id, expectedRefundRequestRowVersion: first.rowVersion }, { unitOfWork: effectUow() }),
      "PERMISSION_DENIED"
    );
    await expectCode(
      executeApprovedRefund(executeContext("mat023-no-entitlement", EXECUTOR, ["pos.refund.execute"], false), { refundRequestId: first.id, expectedRefundRequestRowVersion: first.rowVersion }, { unitOfWork: effectUow() }),
      "ENTITLEMENT_REQUIRED"
    );
  });

  await t.test("stale RefundRequest row_version fails closed", async () => {
    await expectCode(
      executeApprovedRefund(executeContext("mat023-stale"), { refundRequestId: first.id, expectedRefundRequestRowVersion: 1 }, { unitOfWork: effectUow() }),
      "CONFLICT"
    );
  });

  await t.test("RLS hides an APPROVED RefundRequest belonging to another tenant", async () => {
    const otherId = "23232323-cccc-4ccc-8ccc-cccccccccccc";
    await pool.query(
      `INSERT INTO ristoairen.refund_requests
       (id,tenant_id,location_id,payment_id,order_id,requested_amount,currency,reason,requested_by_identity_id,requested_at,
        request_idempotency_key,original_payment_row_version,status,approved_by_identity_id,approved_at,row_version,environment_class)
       VALUES ($1,$2,$3,$4,$5,5,'EUR','other tenant approved',$6,now(),'mat023-other',1,'APPROVED',$7,now(),2,'TEST_TEMPORARY')`,
      [otherId, TENANT_B, LOCATION_B, PAYMENT_B, ORDER_B, REQUESTER, APPROVER]
    );
    await expectCode(
      executeApprovedRefund(executeContext("mat023-cross-tenant"), { refundRequestId: otherId, expectedRefundRequestRowVersion: 2 }, { unitOfWork: effectUow() }),
      "NOT_FOUND"
    );
  });

  await t.test("concurrent execution of one approved request converges to one Payment and one replay", async () => {
    const request = await makeApprovedRequest("same-concurrency", "5.00");
    const input = { refundRequestId: request.id, expectedRefundRequestRowVersion: request.rowVersion } as const;
    const [a, b] = await Promise.all([
      executeApprovedRefund(executeContext("mat023-same-a", EXECUTOR), input, { unitOfWork: effectUow() }),
      executeApprovedRefund(executeContext("mat023-same-b", EXECUTOR_2), input, { unitOfWork: effectUow() })
    ]);
    assert.equal([a.replayed, b.replayed].filter(Boolean).length, 1);
    assert.equal(a.payment.id, b.payment.id);
    const rows = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE idempotency_key=$1", [`refund-effect:${request.id}`]);
    const audit = await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='PAYMENT_REFUNDED' AND resource_id=$1", [a.payment.id]);
    assert.equal(rows.rows[0].count, 1);
    assert.equal(audit.rows[0].count, 1);
  });

  await t.test("concurrent distinct approved requests cannot over-refund the original Payment", async () => {
    // Original 50.00 - pre-existing 10.00 - first effect 20.00 - same-concurrency 5.00 = 15.00 remaining.
    const one = await makeApprovedRequest("balance-a", "10.00");
    const two = await makeApprovedRequest("balance-b", "10.00");
    const before = await pool.query(
      "SELECT COALESCE(sum(amount),0)::text AS total FROM ristoairen.payments WHERE refund_of_payment_id=$1",
      [PAYMENT_A]
    );
    assert.equal(before.rows[0].total, "35.00");

    const settled = await Promise.allSettled([
      executeApprovedRefund(executeContext("mat023-balance-a", EXECUTOR), { refundRequestId: one.id, expectedRefundRequestRowVersion: one.rowVersion }, { unitOfWork: effectUow() }),
      executeApprovedRefund(executeContext("mat023-balance-b", EXECUTOR_2), { refundRequestId: two.id, expectedRefundRequestRowVersion: two.rowVersion }, { unitOfWork: effectUow() })
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
    const rejected = settled.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected" && rejected.reason instanceof AppError && rejected.reason.code === "CONFLICT");

    const after = await pool.query(
      "SELECT COALESCE(sum(amount),0)::text AS total,count(*)::int AS count FROM ristoairen.payments WHERE refund_of_payment_id=$1",
      [PAYMENT_A]
    );
    assert.equal(after.rows[0].total, "45.00");
    assert.equal(after.rows[0].count, 4);

    const effects = await pool.query(
      "SELECT count(*)::int AS count FROM ristoairen.payments WHERE idempotency_key IN ($1,$2)",
      [`refund-effect:${one.id}`, `refund-effect:${two.id}`]
    );
    assert.equal(effects.rows[0].count, 1);
  });
});
