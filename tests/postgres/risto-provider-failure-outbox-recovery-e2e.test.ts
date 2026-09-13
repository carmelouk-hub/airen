import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { requestRefund, approveRefund } from "../../packages/ristoairen/src/pos/refund-request.ts";
import { executeApprovedRefund } from "../../packages/ristoairen/src/pos/refund-effect.ts";
import {
  PROVIDER_REFUND_DISPATCH_EVENT,
  startProviderRefundSaga
} from "../../packages/ristoairen/src/pos/provider-refund-saga.ts";
import { PostgresRefundRequestUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-request.ts";
import { PostgresRefundEffectUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-effect.ts";
import { PostgresProviderRefundSagaUnitOfWork } from "../../packages/persistence-postgres/src/risto-provider-refund-saga.ts";
import { PostgresOutboxDeliveryStore } from "../../packages/persistence-postgres/src/risto-outbox-delivery.ts";
import {
  OUTBOX_DELIVERY_FAILURE_REASON,
  dispatchNextOutboxMessage,
  type OutboxDeliveryAdapter,
  type OutboxDeliveryMessage
} from "../../packages/integrations/src/outbox-delivery.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });

const TENANT_ID = "91000000-0000-4100-8100-000000000036";
const LOCATION_ID = "92000000-0000-4200-8200-000000000036";
const REQUESTER_ID = "93000000-0000-4300-8300-000000000036";
const APPROVER_ID = "94000000-0000-4400-8400-000000000036";
const EXECUTOR_ID = "95000000-0000-4500-8500-000000000036";
const ORDER_RECOVERY = "96000000-0000-4600-8600-000000000036";
const PAYMENT_RECOVERY = "97000000-0000-4700-8700-000000000036";
const ORDER_DEAD_LETTER = "98000000-0000-4800-8800-000000000036";
const PAYMENT_DEAD_LETTER = "99000000-0000-4900-8900-000000000036";

function context(actorIdentityId: string, correlationId: string, permissions: readonly string[]): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT_ID,
    locationId: LOCATION_ID,
    tenantMembershipId: `mat036-tm-${actorIdentityId}`,
    locationMembershipId: `mat036-lm-${actorIdentityId}`,
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions,
    entitlements: ["vertical.ristoairen"]
  });
}

const requestContext = (correlationId: string) =>
  context(REQUESTER_ID, correlationId, ["pos.refund.request"]);
const approveContext = (correlationId: string) =>
  context(APPROVER_ID, correlationId, ["pos.refund.approve"]);
const executeContext = (correlationId: string) =>
  context(EXECUTOR_ID, correlationId, ["pos.refund.execute"]);

async function seed(): Promise<void> {
  // Earlier regressions in this same ephemeral PostgreSQL service may leave
  // their own durable events. MAT-036 isolates only its synthetic queue.
  await pool.query("DELETE FROM events.outbox_events");
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name)
    VALUES ('${TENANT_ID}', 'mat036', 'MAT036');

    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone, is_primary)
    VALUES ('${LOCATION_ID}', '${TENANT_ID}', 'main', 'Main', 'Europe/Rome', true);

    INSERT INTO identity.identities (id, display_name)
    VALUES
      ('${REQUESTER_ID}', 'MAT036 Requester'),
      ('${APPROVER_ID}', 'MAT036 Approver'),
      ('${EXECUTOR_ID}', 'MAT036 Executor');

    INSERT INTO ristoairen.orders
      (id, tenant_id, location_id, channel, status, currency,
       subtotal, discount_total, tax_total, total, opened_at,
       created_by_identity_id, version, environment_class)
    VALUES
      ('${ORDER_RECOVERY}', '${TENANT_ID}', '${LOCATION_ID}', 'POS', 'PAID', 'EUR', 30, 0, 0, 30, now(), '${REQUESTER_ID}', 1, 'TEST_TEMPORARY'),
      ('${ORDER_DEAD_LETTER}', '${TENANT_ID}', '${LOCATION_ID}', 'POS', 'PAID', 'EUR', 40, 0, 0, 40, now(), '${REQUESTER_ID}', 1, 'TEST_TEMPORARY');

    INSERT INTO ristoairen.payments
      (id, tenant_id, location_id, order_id, payment_method, amount, currency, status,
       provider_reference, received_at, recorded_by, idempotency_key,
       metadata_sanitized, row_version, environment_class)
    VALUES
      ('${PAYMENT_RECOVERY}', '${TENANT_ID}', '${LOCATION_ID}', '${ORDER_RECOVERY}', 'CARD', 30, 'EUR', 'RECORDED',
       'provider-charge-mat036-recovery', now(), '${REQUESTER_ID}', 'mat036-original-recovery', '{}', 4, 'TEST_TEMPORARY'),
      ('${PAYMENT_DEAD_LETTER}', '${TENANT_ID}', '${LOCATION_ID}', '${ORDER_DEAD_LETTER}', 'CARD', 40, 'EUR', 'RECORDED',
       'provider-charge-mat036-dead-letter', now(), '${REQUESTER_ID}', 'mat036-original-dead-letter', '{}', 4, 'TEST_TEMPORARY');
  `);
}

class SyntheticFailingAdapter implements OutboxDeliveryAdapter {
  deliveries = 0;
  private failuresRemaining: number;

  constructor(failuresRemaining: number) {
    this.failuresRemaining = failuresRemaining;
  }

  async deliver(_message: OutboxDeliveryMessage): Promise<void> {
    this.deliveries += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("provider-secret=MAT036_SHOULD_NEVER_PERSIST");
    }
  }
}

type SagaFixture = Readonly<{
  refundRequestId: string;
  refundPaymentId: string;
  sagaId: string;
  startCorrelationId: string;
}>;

async function createRefundSaga(label: "recovery" | "dead-letter"): Promise<SagaFixture> {
  const sourcePaymentId = label === "recovery" ? PAYMENT_RECOVERY : PAYMENT_DEAD_LETTER;
  const amount = label === "recovery" ? "12.00" : "15.00";
  const requestCorrelationId = `mat036-${label}-request`;
  const approveCorrelationId = `mat036-${label}-approve`;
  const effectCorrelationId = `mat036-${label}-effect`;
  const startCorrelationId = `mat036-${label}-saga-start`;

  const requested = await requestRefund(
    requestContext(requestCorrelationId),
    {
      paymentId: sourcePaymentId,
      amount,
      reason: `MAT036 ${label} provider failure proof`,
      expectedPaymentRowVersion: 4,
      idempotencyKey: `mat036-${label}-request-idem`
    },
    {
      unitOfWork: new PostgresRefundRequestUnitOfWork(pool),
      now: () => label === "recovery" ? "2026-09-13T16:30:00.000Z" : "2026-09-13T16:40:00.000Z"
    }
  );

  const approved = await approveRefund(
    approveContext(approveCorrelationId),
    {
      refundRequestId: requested.refundRequest.id,
      expectedRefundRequestRowVersion: 1
    },
    {
      unitOfWork: new PostgresRefundRequestUnitOfWork(pool),
      now: () => label === "recovery" ? "2026-09-13T16:31:00.000Z" : "2026-09-13T16:41:00.000Z"
    }
  );

  const effect = await executeApprovedRefund(
    executeContext(effectCorrelationId),
    {
      refundRequestId: approved.refundRequest.id,
      expectedRefundRequestRowVersion: approved.refundRequest.rowVersion
    },
    {
      unitOfWork: new PostgresRefundEffectUnitOfWork(pool),
      now: () => label === "recovery" ? "2026-09-13T16:32:00.000Z" : "2026-09-13T16:42:00.000Z"
    }
  );

  const started = await startProviderRefundSaga(
    executeContext(startCorrelationId),
    {
      refundRequestId: approved.refundRequest.id,
      refundPaymentId: effect.payment.id,
      providerKey: "sandbox"
    },
    { unitOfWork: new PostgresProviderRefundSagaUnitOfWork(pool) }
  );

  assert.equal(started.replayed, false);
  assert.equal(started.saga.status, "PENDING_DISPATCH");
  return Object.freeze({
    refundRequestId: approved.refundRequest.id,
    refundPaymentId: effect.payment.id,
    sagaId: started.saga.id,
    startCorrelationId
  });
}

async function outboxForSaga(sagaId: string) {
  const result = await pool.query(
    `SELECT id::text AS id,
            event_type AS "eventType",
            aggregate_type AS "aggregateType",
            aggregate_id AS "aggregateId",
            correlation_id AS "correlationId",
            delivery_status AS "deliveryStatus",
            attempt_count AS "attemptCount",
            last_error AS "lastError",
            delivered_at AS "deliveredAt"
       FROM events.outbox_events
      WHERE aggregate_id=$1
      ORDER BY created_at, id`,
    [sagaId]
  );
  return result.rows;
}

async function sagaState(sagaId: string): Promise<string> {
  const result = await pool.query(
    "SELECT status FROM ristoairen.provider_refund_sagas WHERE id=$1::uuid",
    [sagaId]
  );
  return String(result.rows[0]?.status);
}

async function refundPaymentCount(refundPaymentId: string): Promise<number> {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM ristoairen.payments WHERE id=$1::uuid",
    [refundPaymentId]
  );
  return Number(result.rows[0].count);
}

async function sagaCount(refundPaymentId: string): Promise<number> {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM ristoairen.provider_refund_sagas WHERE refund_payment_id=$1::uuid",
    [refundPaymentId]
  );
  return Number(result.rows[0].count);
}

test.after(async () => {
  await pool.end();
});

test("MAT-036 GJ2-035 provider failure / outbox recovery E2E", async (t) => {
  await seed();

  await t.test("certified provider-refund domain transaction persists one saga and one durable outbox intent", async () => {
    const fixture = await createRefundSaga("recovery");
    const outbox = await outboxForSaga(fixture.sagaId);

    assert.equal(await refundPaymentCount(fixture.refundPaymentId), 1);
    assert.equal(await sagaCount(fixture.refundPaymentId), 1);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].eventType, PROVIDER_REFUND_DISPATCH_EVENT);
    assert.equal(outbox[0].aggregateType, "ProviderRefundSaga");
    assert.equal(outbox[0].aggregateId, fixture.sagaId);
    assert.equal(outbox[0].correlationId, fixture.startCorrelationId);
    assert.equal(outbox[0].deliveryStatus, "pending");
    assert.equal(outbox[0].attemptCount, 0);

    (t as unknown as { recoveryFixture?: SagaFixture }).recoveryFixture = fixture;
  });

  await t.test("synthetic provider failure never claims external success and retry recovers without duplicate domain effect", async () => {
    const fixture = (t as unknown as { recoveryFixture?: SagaFixture }).recoveryFixture;
    assert.ok(fixture);

    const store = new PostgresOutboxDeliveryStore(pool);
    const adapter = new SyntheticFailingAdapter(1);

    const failed = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3 });
    assert.equal(failed.status, "failed");

    let outbox = await outboxForSaga(fixture.sagaId);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].deliveryStatus, "failed");
    assert.equal(outbox[0].attemptCount, 1);
    assert.equal(outbox[0].deliveredAt, null);
    assert.equal(outbox[0].lastError, OUTBOX_DELIVERY_FAILURE_REASON);
    assert.equal(String(outbox[0].lastError).includes("MAT036_SHOULD_NEVER_PERSIST"), false);
    assert.equal(await sagaState(fixture.sagaId), "PENDING_DISPATCH");
    assert.equal(await refundPaymentCount(fixture.refundPaymentId), 1);
    assert.equal(await sagaCount(fixture.refundPaymentId), 1);

    const recovered = await dispatchNextOutboxMessage({
      store,
      adapter,
      maxAttempts: 3,
      now: () => "2026-09-13T16:33:00.000Z"
    });
    assert.equal(recovered.status, "delivered");

    outbox = await outboxForSaga(fixture.sagaId);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].deliveryStatus, "delivered");
    assert.equal(outbox[0].attemptCount, 2);
    assert.equal(outbox[0].lastError, null);
    assert.ok(outbox[0].deliveredAt);
    assert.equal(await refundPaymentCount(fixture.refundPaymentId), 1);
    assert.equal(await sagaCount(fixture.refundPaymentId), 1);

    const replay = await startProviderRefundSaga(
      executeContext("mat036-recovery-saga-replay"),
      {
        refundRequestId: fixture.refundRequestId,
        refundPaymentId: fixture.refundPaymentId,
        providerKey: "sandbox"
      },
      { unitOfWork: new PostgresProviderRefundSagaUnitOfWork(pool) }
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.saga.id, fixture.sagaId);
    assert.equal(await refundPaymentCount(fixture.refundPaymentId), 1);
    assert.equal(await sagaCount(fixture.refundPaymentId), 1);
    assert.equal((await outboxForSaga(fixture.sagaId)).length, 1);

    const noRedelivery = await dispatchNextOutboxMessage({
      store,
      adapter,
      maxAttempts: 3
    });
    assert.equal(noRedelivery.status, "empty");
    assert.equal(adapter.deliveries, 2);
  });

  await t.test("retry exhaustion becomes dead_letter while committed domain truth remains singular", async () => {
    const fixture = await createRefundSaga("dead-letter");
    const store = new PostgresOutboxDeliveryStore(pool);
    const adapter = new SyntheticFailingAdapter(10);

    assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "failed");
    assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "dead_letter");

    const outbox = await outboxForSaga(fixture.sagaId);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].deliveryStatus, "dead_letter");
    assert.equal(outbox[0].attemptCount, 2);
    assert.equal(outbox[0].lastError, OUTBOX_DELIVERY_FAILURE_REASON);
    assert.equal(String(outbox[0].lastError).includes("MAT036_SHOULD_NEVER_PERSIST"), false);
    assert.equal(await sagaState(fixture.sagaId), "PENDING_DISPATCH");
    assert.equal(await refundPaymentCount(fixture.refundPaymentId), 1);
    assert.equal(await sagaCount(fixture.refundPaymentId), 1);

    const noRedelivery = await dispatchNextOutboxMessage({
      store,
      adapter,
      maxAttempts: 2
    });
    assert.equal(noRedelivery.status, "empty");
    assert.equal(adapter.deliveries, 2);
  });
});
