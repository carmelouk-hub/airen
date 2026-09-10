import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { requestRefund } from "../../packages/ristoairen/src/pos/refund-request.ts";
import { PostgresRefundRequestUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-request.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

const TENANT_A = "20202020-1111-4111-8111-111111111111";
const LOCATION_A = "20202020-2222-4222-8222-222222222222";
const REQUESTER = "20202020-3333-4333-8333-333333333333";
const OTHER_ACTOR = "20202020-4444-4444-8444-444444444444";
const ORDER_A = "20202020-5555-4555-8555-555555555555";
const PAYMENT_A = "20202020-6666-4666-8666-666666666661";
const REFUND_CHILD = "20202020-6666-4666-8666-666666666662";
const TENANT_B = "20202020-7777-4777-8777-777777777777";
const LOCATION_B = "20202020-8888-4888-8888-888888888888";
const ORDER_B = "20202020-9999-4999-8999-999999999999";
const PAYMENT_B = "20202020-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function context(correlationId: string, permissions: readonly string[] = ["pos.refund.request"], entitled = true): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: REQUESTER,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT_A,
    locationId: LOCATION_A,
    tenantMembershipId: "mat020-tm",
    locationMembershipId: "mat020-lm",
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions,
    entitlements: entitled ? ["vertical.ristoairen"] : []
  });
}

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name) VALUES
      ('${TENANT_A}', 'mat020-a', 'MAT020 A'),
      ('${TENANT_B}', 'mat020-b', 'MAT020 B');
    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone) VALUES
      ('${LOCATION_A}', '${TENANT_A}', 'main', 'MAT020 Main A', 'Europe/Rome'),
      ('${LOCATION_B}', '${TENANT_B}', 'main', 'MAT020 Main B', 'Europe/Rome');
    INSERT INTO identity.identities (id, display_name) VALUES
      ('${REQUESTER}', 'MAT020 Refund Requester'),
      ('${OTHER_ACTOR}', 'MAT020 Other Actor');
    INSERT INTO ristoairen.orders
      (id, tenant_id, location_id, channel, status, currency,
       subtotal, discount_total, tax_total, total, opened_at,
       created_by_identity_id, version, environment_class)
    VALUES
      ('${ORDER_A}', '${TENANT_A}', '${LOCATION_A}', 'POS', 'PAID', 'EUR', 50, 0, 0, 50, now(), '${REQUESTER}', 1, 'TEST_TEMPORARY'),
      ('${ORDER_B}', '${TENANT_B}', '${LOCATION_B}', 'POS', 'PAID', 'EUR', 70, 0, 0, 70, now(), '${OTHER_ACTOR}', 1, 'TEST_TEMPORARY');
    INSERT INTO ristoairen.payments
      (id, tenant_id, location_id, order_id, payment_method, amount, currency, status,
       received_at, recorded_by, idempotency_key, metadata_sanitized, row_version, environment_class)
    VALUES
      ('${PAYMENT_A}', '${TENANT_A}', '${LOCATION_A}', '${ORDER_A}', 'CARD', 50, 'EUR', 'RECORDED', now(), '${REQUESTER}', 'mat020-original-a', '{}', 3, 'TEST_TEMPORARY'),
      ('${PAYMENT_B}', '${TENANT_B}', '${LOCATION_B}', '${ORDER_B}', 'CARD', 70, 'EUR', 'RECORDED', now(), '${OTHER_ACTOR}', 'mat020-original-b', '{}', 1, 'TEST_TEMPORARY');
    INSERT INTO ristoairen.payments
      (id, tenant_id, location_id, order_id, payment_method, amount, currency, status,
       received_at, recorded_by, refund_of_payment_id, idempotency_key, metadata_sanitized, row_version, environment_class)
    VALUES
      ('${REFUND_CHILD}', '${TENANT_A}', '${LOCATION_A}', '${ORDER_A}', 'CARD', 10, 'EUR', 'ARBITRARY_UNFROZEN_REFUND_LABEL', now(), '${REQUESTER}', '${PAYMENT_A}', 'mat020-existing-refund', '{}', 1, 'TEST_TEMPORARY');
  `);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

test("MAT-020 refund.request authorization/runtime foundation", async (t) => {
  await seed();
  t.after(async () => { await pool.end(); });
  const uow = new PostgresRefundRequestUnitOfWork(pool);

  await t.test("authorized partial request returns immutable approval envelope and creates zero monetary effect", async () => {
    const before = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1", [TENANT_A]);
    const envelope = await requestRefund(
      context("mat020-partial"),
      {
        paymentId: PAYMENT_A,
        amount: "20.00",
        reason: "Customer requested partial refund",
        expectedPaymentRowVersion: 3,
        idempotencyKey: "mat020-refund-request-1"
      },
      { unitOfWork: uow }
    );

    assert.equal(envelope.schema, "risto.refund-approval-envelope.v1");
    assert.equal(envelope.paymentId, PAYMENT_A);
    assert.equal(envelope.orderId, ORDER_A);
    assert.equal(envelope.requestedAmount, "20.00");
    assert.equal(envelope.currency, "EUR");
    assert.equal(envelope.observedRefundedAmount, "10.00");
    assert.equal(envelope.observedRefundableBeforeRequest, "40.00");
    assert.equal(envelope.requestedBy, REQUESTER);
    assert.equal(envelope.approvalRequired, true);
    assert.equal(envelope.monetaryEffectCreated, false);
    assert.match(envelope.envelopeDigest, /^[a-f0-9]{64}$/);
    assert.equal(Object.isFrozen(envelope), true);

    const after = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1", [TENANT_A]);
    assert.equal(after.rows[0].count, before.rows[0].count);
  });

  await t.test("omitted amount requests exactly the conservative remaining refundable balance", async () => {
    const envelope = await requestRefund(
      context("mat020-full"),
      {
        paymentId: PAYMENT_A,
        reason: "Request remaining refundable balance",
        expectedPaymentRowVersion: 3,
        idempotencyKey: "mat020-refund-request-full"
      },
      { unitOfWork: uow }
    );
    assert.equal(envelope.requestedAmount, "40.00");
    assert.equal(envelope.observedRefundedAmount, "10.00");
  });

  await t.test("every existing refund-lineage child reduces balance even with an unfrozen status label", async () => {
    await expectCode(
      requestRefund(
        context("mat020-over"),
        {
          paymentId: PAYMENT_A,
          amount: "40.01",
          reason: "Must fail closed above conservative balance",
          expectedPaymentRowVersion: 3,
          idempotencyKey: "mat020-refund-request-over"
        },
        { unitOfWork: uow }
      ),
      "CONFLICT"
    );
  });

  await t.test("stale Payment row version fails closed", async () => {
    await expectCode(
      requestRefund(
        context("mat020-version"),
        {
          paymentId: PAYMENT_A,
          amount: "5.00",
          reason: "Stale version",
          expectedPaymentRowVersion: 2,
          idempotencyKey: "mat020-refund-request-stale"
        },
        { unitOfWork: uow }
      ),
      "CONFLICT"
    );
  });

  await t.test("refund-lineage child cannot become a new original refund target", async () => {
    await expectCode(
      requestRefund(
        context("mat020-child"),
        {
          paymentId: REFUND_CHILD,
          amount: "1.00",
          reason: "Nested refund target must be rejected",
          expectedPaymentRowVersion: 1,
          idempotencyKey: "mat020-refund-request-child"
        },
        { unitOfWork: uow }
      ),
      "VALIDATION_FAILED"
    );
  });

  await t.test("pos.refund.approve alone does not grant refund.request", async () => {
    await expectCode(
      requestRefund(
        context("mat020-approve-only", ["pos.refund.approve"]),
        {
          paymentId: PAYMENT_A,
          amount: "5.00",
          reason: "Approval permission is not request permission",
          expectedPaymentRowVersion: 3,
          idempotencyKey: "mat020-refund-request-approve-only"
        },
        { unitOfWork: uow }
      ),
      "PERMISSION_DENIED"
    );
  });

  await t.test("missing RISTOAIREN entitlement is rejected", async () => {
    await expectCode(
      requestRefund(
        context("mat020-no-entitlement", ["pos.refund.request"], false),
        {
          paymentId: PAYMENT_A,
          amount: "5.00",
          reason: "Missing entitlement",
          expectedPaymentRowVersion: 3,
          idempotencyKey: "mat020-refund-request-no-entitlement"
        },
        { unitOfWork: uow }
      ),
      "ENTITLEMENT_REQUIRED"
    );
  });

  await t.test("RLS hides another Tenant/Location Payment even when its UUID is known", async () => {
    await expectCode(
      requestRefund(
        context("mat020-cross-tenant"),
        {
          paymentId: PAYMENT_B,
          amount: "5.00",
          reason: "Cross tenant must be hidden",
          expectedPaymentRowVersion: 1,
          idempotencyKey: "mat020-refund-request-cross-tenant"
        },
        { unitOfWork: uow }
      ),
      "NOT_FOUND"
    );
  });

  await t.test("request replay is deterministic and remains zero-effect", async () => {
    const input = {
      paymentId: PAYMENT_A,
      amount: "7.00",
      reason: "Deterministic request envelope",
      expectedPaymentRowVersion: 3,
      idempotencyKey: "mat020-refund-request-deterministic"
    } as const;
    const first = await requestRefund(context("mat020-deterministic"), input, { unitOfWork: uow });
    const second = await requestRefund(context("mat020-deterministic"), input, { unitOfWork: uow });
    assert.deepEqual(second, first);
    const count = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1", [TENANT_A]);
    assert.equal(count.rows[0].count, 2);
  });
});
