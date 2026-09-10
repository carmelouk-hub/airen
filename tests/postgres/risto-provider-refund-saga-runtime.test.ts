import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { requestRefund, approveRefund } from "../../packages/ristoairen/src/pos/refund-request.ts";
import { executeApprovedRefund } from "../../packages/ristoairen/src/pos/refund-effect.ts";
import {
  PROVIDER_REFUND_DISPATCH_EVENT,
  createProviderRefundResultHandler,
  startProviderRefundSaga
} from "../../packages/ristoairen/src/pos/provider-refund-saga.ts";
import { PostgresRefundRequestUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-request.ts";
import { PostgresRefundEffectUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-effect.ts";
import { PostgresProviderRefundSagaUnitOfWork } from "../../packages/persistence-postgres/src/risto-provider-refund-saga.ts";
import { PostgresOutboxDeliveryStore } from "../../packages/persistence-postgres/src/risto-outbox-delivery.ts";
import { PostgresWebhookReplayStore } from "../../packages/persistence-postgres/src/webhook-replay.ts";
import { dispatchNextOutboxMessage } from "../../packages/integrations/src/outbox-delivery.ts";
import { receiveProviderWebhook } from "../../packages/integrations/src/webhook-replay.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });

const TENANT_A = "24242424-1111-4111-8111-111111111111";
const LOCATION_A = "24242424-2222-4222-8222-222222222222";
const REQUESTER = "24242424-3333-4333-8333-333333333333";
const APPROVER = "24242424-4444-4444-8444-444444444444";
const EXECUTOR = "24242424-5555-4555-8555-555555555555";
const PROVIDER_ACTOR = "24242424-5555-4555-8555-555555555556";
const ORDER_A = "24242424-6666-4666-8666-666666666666";
const PAYMENT_A = "24242424-7777-4777-8777-777777777777";
const TENANT_B = "24242424-8888-4888-8888-888888888888";
const LOCATION_B = "24242424-9999-4999-8999-999999999999";

function context(actor: string, correlationId: string, permissions: readonly string[], tenantId = TENANT_A, locationId = LOCATION_A): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: actor,
    platformRoles: [], platformPermissions: [],
    tenantId, locationId,
    tenantMembershipId: `mat024-tm-${tenantId}`,
    locationMembershipId: `mat024-lm-${locationId}`,
    tenantRole: "responsabile", locationRole: "responsabile",
    permissions,
    entitlements: ["vertical.ristoairen"]
  });
}

const requestContext = (id: string) => context(REQUESTER, id, ["pos.refund.request"]);
const approveContext = (id: string) => context(APPROVER, id, ["pos.refund.approve"]);
const executeContext = (id: string, actor = EXECUTOR, tenantId = TENANT_A, locationId = LOCATION_A) =>
  context(actor, id, ["pos.refund.execute"], tenantId, locationId);

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT_A}','mat024-a','MAT024 A'),('${TENANT_B}','mat024-b','MAT024 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone)
    VALUES ('${LOCATION_A}','${TENANT_A}','main','MAT024 Main A','Europe/Rome'),
           ('${LOCATION_B}','${TENANT_B}','main','MAT024 Main B','Europe/Rome');
    INSERT INTO identity.identities (id,display_name)
    VALUES ('${REQUESTER}','MAT024 Requester'),('${APPROVER}','MAT024 Approver'),
           ('${EXECUTOR}','MAT024 Executor'),('${PROVIDER_ACTOR}','MAT024 Provider Actor');
    INSERT INTO ristoairen.orders
      (id,tenant_id,location_id,channel,status,currency,subtotal,discount_total,tax_total,total,opened_at,created_by_identity_id,version,environment_class)
    VALUES ('${ORDER_A}','${TENANT_A}','${LOCATION_A}','POS','PAID','EUR',40,0,0,40,now(),'${REQUESTER}',1,'TEST_TEMPORARY');
    INSERT INTO ristoairen.payments
      (id,tenant_id,location_id,order_id,payment_method,amount,currency,status,provider_reference,received_at,recorded_by,idempotency_key,metadata_sanitized,row_version,environment_class)
    VALUES ('${PAYMENT_A}','${TENANT_A}','${LOCATION_A}','${ORDER_A}','CARD',40,'EUR','RECORDED','provider-charge-mat024-a',now(),'${REQUESTER}','mat024-original-a','{}',4,'TEST_TEMPORARY');
  `);
}

async function makeRefundEffect(): Promise<{ requestId: string; refundPaymentId: string }> {
  const requested = await requestRefund(
    requestContext("mat024-request"),
    { paymentId: PAYMENT_A, amount: "12.00", reason: "MAT024 provider refund", expectedPaymentRowVersion: 4, idempotencyKey: "mat024-request-a" },
    { unitOfWork: new PostgresRefundRequestUnitOfWork(pool), now: () => "2026-09-10T14:00:00.000Z" }
  );
  const approved = await approveRefund(
    approveContext("mat024-approve"),
    { refundRequestId: requested.refundRequest.id, expectedRefundRequestRowVersion: 1 },
    { unitOfWork: new PostgresRefundRequestUnitOfWork(pool), now: () => "2026-09-10T14:01:00.000Z" }
  );
  const effect = await executeApprovedRefund(
    executeContext("mat024-effect"),
    { refundRequestId: approved.refundRequest.id, expectedRefundRequestRowVersion: approved.refundRequest.rowVersion },
    { unitOfWork: new PostgresRefundEffectUnitOfWork(pool), now: () => "2026-09-10T14:02:00.000Z" }
  );
  return { requestId: approved.refundRequest.id, refundPaymentId: effect.payment.id };
}

test("MAT-024 provider refund saga orchestration and reconciliation", async (t) => {
  await seed();
  t.after(async () => { await pool.end(); });
  const refund = await makeRefundEffect();
  const uow = new PostgresProviderRefundSagaUnitOfWork(pool);
  let sagaId = "";

  await t.test("start persists one saga and one durable provider-neutral REFUND dispatch", async () => {
    const result = await startProviderRefundSaga(
      executeContext("mat024-saga-start"),
      { refundRequestId: refund.requestId, refundPaymentId: refund.refundPaymentId, providerKey: "sandbox" },
      { unitOfWork: uow }
    );
    sagaId = result.saga.id;
    assert.equal(result.replayed, false);
    assert.equal(result.saga.status, "PENDING_DISPATCH");
    assert.equal(result.saga.providerSourceReference, "provider-charge-mat024-a");
    assert.equal(result.saga.idempotencyKey, `provider-refund:sandbox:${refund.refundPaymentId}`);

    const outbox = await pool.query(
      "SELECT event_type,aggregate_type,aggregate_id,payload,delivery_status,attempt_count FROM events.outbox_events WHERE aggregate_id=$1",
      [sagaId]
    );
    assert.equal(outbox.rows.length, 1);
    assert.equal(outbox.rows[0].event_type, PROVIDER_REFUND_DISPATCH_EVENT);
    assert.equal(outbox.rows[0].aggregate_type, "ProviderRefundSaga");
    assert.equal(outbox.rows[0].delivery_status, "pending");
    assert.equal(outbox.rows[0].attempt_count, 0);
    assert.equal(outbox.rows[0].payload.refundPaymentId, refund.refundPaymentId);
    assert.equal(outbox.rows[0].payload.providerKey, "sandbox");
  });

  await t.test("semantic start replay converges without duplicate saga, outbox or local Payment", async () => {
    const beforePayments = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments");
    const replay = await startProviderRefundSaga(
      executeContext("mat024-saga-replay", PROVIDER_ACTOR),
      { refundRequestId: refund.requestId, refundPaymentId: refund.refundPaymentId, providerKey: "sandbox" },
      { unitOfWork: uow }
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.saga.id, sagaId);
    const sagas = await pool.query("SELECT count(*)::int AS count FROM ristoairen.provider_refund_sagas WHERE refund_payment_id=$1", [refund.refundPaymentId]);
    const outbox = await pool.query("SELECT count(*)::int AS count FROM events.outbox_events WHERE aggregate_id=$1", [sagaId]);
    const afterPayments = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments");
    assert.equal(sagas.rows[0].count, 1);
    assert.equal(outbox.rows[0].count, 1);
    assert.equal(afterPayments.rows[0].count, beforePayments.rows[0].count);
  });

  await t.test("existing MAT-015/016 dispatcher delivers the refund intent with retry-safe durable state", async () => {
    const delivered: unknown[] = [];
    const result = await dispatchNextOutboxMessage({
      store: new PostgresOutboxDeliveryStore(pool),
      adapter: { deliver: async (message) => { delivered.push(message); assert.equal(Object.isFrozen(message), true); assert.equal(Object.isFrozen(message.payload), true); } },
      now: () => "2026-09-10T14:03:00.000Z"
    });
    assert.equal(result.status, "delivered");
    assert.equal(delivered.length, 1);
    const row = await pool.query("SELECT delivery_status,attempt_count,last_error FROM events.outbox_events WHERE aggregate_id=$1", [sagaId]);
    assert.deepEqual(row.rows[0], { delivery_status: "delivered", attempt_count: 1, last_error: null });
    const empty = await dispatchNextOutboxMessage({ store: new PostgresOutboxDeliveryStore(pool), adapter: { deliver: async () => { throw new Error("must not redeliver"); } } });
    assert.equal(empty.status, "empty");
  });

  await t.test("verified webhook result resolves through server-owned binding and reconciles exactly once", async () => {
    const paymentCountBefore = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments");
    let resolverCalls = 0;
    const handler = createProviderRefundResultHandler({
      resolve: async (lookup) => {
        resolverCalls += 1;
        assert.equal(lookup.providerEventId, "evt-refund-ok-1");
        return Object.freeze({
          securityContext: executeContext("mat024-provider-result", PROVIDER_ACTOR),
          refundPaymentId: refund.refundPaymentId,
          outcome: "SUCCEEDED" as const,
          providerRefundReference: "provider-refund-mat024-1",
          resultCode: "SUCCEEDED"
        });
      }
    }, { unitOfWork: uow, now: () => "2026-09-10T14:04:00.000Z" });

    const dependencies = {
      providerKey: "sandbox",
      verifier: { verify: async () => Object.freeze({ providerEventId: "evt-refund-ok-1", eventType: "refund.succeeded", providerPayload: { ignoredFinancialAuthority: true } }) },
      replayStore: new PostgresWebhookReplayStore(pool),
      handler,
      now: () => "2026-09-10T14:04:00.000Z"
    };
    const request = Object.freeze({ rawBody: "{\"event\":\"refund.succeeded\"}", headers: Object.freeze({ "x-signature": "test-only" }) });
    const first = await receiveProviderWebhook(dependencies, request);
    assert.equal(first.status, "processed");
    const duplicate = await receiveProviderWebhook(dependencies, request);
    assert.equal(duplicate.status, "duplicate_acknowledged");
    assert.equal(resolverCalls, 1);

    const saga = await pool.query("SELECT status,provider_refund_reference,provider_event_id,result_code,row_version FROM ristoairen.provider_refund_sagas WHERE id=$1", [sagaId]);
    assert.deepEqual(saga.rows[0], {
      status: "SUCCEEDED", provider_refund_reference: "provider-refund-mat024-1",
      provider_event_id: "evt-refund-ok-1", result_code: "SUCCEEDED", row_version: 2
    });
    const paymentCountAfter = await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments");
    assert.equal(paymentCountAfter.rows[0].count, paymentCountBefore.rows[0].count);
    const audits = await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='PROVIDER_REFUND_RECONCILED' AND resource_id=$1", [sagaId]);
    assert.equal(audits.rows[0].count, 1);
  });

  await t.test("RLS hides the saga from a different tenant/location context", async () => {
    await assert.rejects(
      startProviderRefundSaga(
        executeContext("mat024-cross-tenant", EXECUTOR, TENANT_B, LOCATION_B),
        { refundRequestId: refund.requestId, refundPaymentId: refund.refundPaymentId, providerKey: "sandbox" },
        { unitOfWork: new PostgresProviderRefundSagaUnitOfWork(pool) }
      ),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "NOT_FOUND")
    );
  });
});
