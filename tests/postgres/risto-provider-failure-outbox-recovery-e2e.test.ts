import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { recordPayment } from "../../packages/ristoairen/src/pos/payment-record.ts";
import { PostgresPaymentRecordUnitOfWork } from "../../packages/persistence-postgres/src/risto-payment-record.ts";
import {
  OUTBOX_DELIVERY_FAILURE_REASON,
  dispatchNextOutboxMessage,
  type OutboxDeliveryAdapter,
  type OutboxDeliveryMessage
} from "../../packages/integrations/src/outbox-delivery.ts";
import { PostgresOutboxDeliveryStore } from "../../packages/persistence-postgres/src/risto-outbox-delivery.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

const TENANT_ID = "91000000-0000-4100-8100-000000000036";
const LOCATION_ID = "92000000-0000-4200-8200-000000000036";
const IDENTITY_ID = "93000000-0000-4300-8300-000000000036";
const ORDER_RECOVERY = "94000000-0000-4400-8400-000000000036";
const ORDER_DEAD_LETTER = "95000000-0000-4500-8500-000000000036";

function context(correlationId: string): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: IDENTITY_ID,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT_ID,
    locationId: LOCATION_ID,
    tenantMembershipId: "mat036-tm",
    locationMembershipId: "mat036-lm",
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions: ["pos.payment.record"],
    entitlements: ["vertical.ristoairen"]
  });
}

async function seed(): Promise<void> {
  await pool.query("DELETE FROM events.outbox_events");
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name)
    VALUES ('${TENANT_ID}', 'mat036', 'MAT036');

    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone, is_primary)
    VALUES ('${LOCATION_ID}', '${TENANT_ID}', 'main', 'Main', 'Europe/Rome', true);

    INSERT INTO identity.identities (id, display_name)
    VALUES ('${IDENTITY_ID}', 'MAT036 Operator');

    INSERT INTO ristoairen.orders
      (id, tenant_id, location_id, channel, status, currency,
       subtotal, discount_total, tax_total, total, opened_at,
       created_by_identity_id, version, environment_class)
    VALUES
      ('${ORDER_RECOVERY}', '${TENANT_ID}', '${LOCATION_ID}', 'POS', 'BILLING', 'EUR', 30, 0, 0, 30, now(), '${IDENTITY_ID}', 1, 'TEST_TEMPORARY'),
      ('${ORDER_DEAD_LETTER}', '${TENANT_ID}', '${LOCATION_ID}', 'POS', 'BILLING', 'EUR', 40, 0, 0, 40, now(), '${IDENTITY_ID}', 1, 'TEST_TEMPORARY');
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

async function paymentCount(orderId: string): Promise<number> {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM ristoairen.payments WHERE order_id=$1::uuid",
    [orderId]
  );
  return Number(result.rows[0].count);
}

async function auditCount(correlationId: string): Promise<number> {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM audit.audit_events WHERE correlation_id=$1 AND action_key='PAYMENT_RECORDED'",
    [correlationId]
  );
  return Number(result.rows[0].count);
}

async function outboxForCorrelation(correlationId: string) {
  const result = await pool.query(
    `SELECT id::text AS id,
            delivery_status AS "deliveryStatus",
            attempt_count AS "attemptCount",
            last_error AS "lastError",
            delivered_at AS "deliveredAt"
       FROM events.outbox_events
      WHERE correlation_id=$1
      ORDER BY created_at, id`,
    [correlationId]
  );
  return result.rows;
}

test.after(async () => {
  await pool.end();
});

test("MAT-036 GJ2-035 provider failure / outbox recovery E2E", async (t) => {
  await seed();
  const paymentUow = new PostgresPaymentRecordUnitOfWork(pool);

  await t.test("authorized domain transaction commits Payment + audit + outbox atomically", async () => {
    const result = await recordPayment(
      context("mat036-recovery"),
      {
        orderId: ORDER_RECOVERY,
        paymentMethod: "CARD",
        amount: "30.00",
        currency: "EUR",
        idempotencyKey: "mat036-recovery-idem"
      },
      { unitOfWork: paymentUow, now: () => "2026-09-13T16:30:00.000Z" }
    );

    assert.equal(result.replayed, false);
    assert.equal(await paymentCount(ORDER_RECOVERY), 1);
    assert.equal(await auditCount("mat036-recovery"), 1);

    const outbox = await outboxForCorrelation("mat036-recovery");
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].deliveryStatus, "pending");
    assert.equal(outbox[0].attemptCount, 0);
  });

  await t.test("synthetic provider failure never claims external success and retry recovers without duplicate domain effect", async () => {
    const store = new PostgresOutboxDeliveryStore(pool);
    const adapter = new SyntheticFailingAdapter(1);

    const failed = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3 });
    assert.equal(failed.status, "failed");

    let outbox = await outboxForCorrelation("mat036-recovery");
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].deliveryStatus, "failed");
    assert.equal(outbox[0].attemptCount, 1);
    assert.equal(outbox[0].deliveredAt, null);
    assert.equal(outbox[0].lastError, OUTBOX_DELIVERY_FAILURE_REASON);
    assert.equal(String(outbox[0].lastError).includes("MAT036_SHOULD_NEVER_PERSIST"), false);
    assert.equal(await paymentCount(ORDER_RECOVERY), 1);
    assert.equal(await auditCount("mat036-recovery"), 1);

    const recovered = await dispatchNextOutboxMessage({
      store,
      adapter,
      maxAttempts: 3,
      now: () => "2026-09-13T16:31:00.000Z"
    });
    assert.equal(recovered.status, "delivered");

    outbox = await outboxForCorrelation("mat036-recovery");
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].deliveryStatus, "delivered");
    assert.equal(outbox[0].attemptCount, 2);
    assert.equal(outbox[0].lastError, null);
    assert.ok(outbox[0].deliveredAt);
    assert.equal(await paymentCount(ORDER_RECOVERY), 1);
    assert.equal(await auditCount("mat036-recovery"), 1);

    const replay = await recordPayment(
      context("mat036-recovery-replay"),
      {
        orderId: ORDER_RECOVERY,
        paymentMethod: "CARD",
        amount: "30.00",
        currency: "EUR",
        idempotencyKey: "mat036-recovery-idem"
      },
      { unitOfWork: paymentUow, now: () => "2026-09-13T16:32:00.000Z" }
    );
    assert.equal(replay.replayed, true);
    assert.equal(await paymentCount(ORDER_RECOVERY), 1);
    assert.equal((await outboxForCorrelation("mat036-recovery")).length, 1);

    const noRedelivery = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3 });
    assert.equal(noRedelivery.status, "empty");
    assert.equal(adapter.deliveries, 2);
  });

  await t.test("retry exhaustion becomes dead_letter while committed domain truth remains singular", async () => {
    await recordPayment(
      context("mat036-dead-letter"),
      {
        orderId: ORDER_DEAD_LETTER,
        paymentMethod: "CARD",
        amount: "40.00",
        currency: "EUR",
        idempotencyKey: "mat036-dead-letter-idem"
      },
      { unitOfWork: paymentUow, now: () => "2026-09-13T16:33:00.000Z" }
    );

    const store = new PostgresOutboxDeliveryStore(pool);
    const adapter = new SyntheticFailingAdapter(10);

    assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "failed");
    assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "dead_letter");

    const outbox = await outboxForCorrelation("mat036-dead-letter");
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].deliveryStatus, "dead_letter");
    assert.equal(outbox[0].attemptCount, 2);
    assert.equal(outbox[0].lastError, OUTBOX_DELIVERY_FAILURE_REASON);
    assert.equal(String(outbox[0].lastError).includes("MAT036_SHOULD_NEVER_PERSIST"), false);
    assert.equal(await paymentCount(ORDER_DEAD_LETTER), 1);
    assert.equal(await auditCount("mat036-dead-letter"), 1);

    const noRedelivery = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 });
    assert.equal(noRedelivery.status, "empty");
    assert.equal(adapter.deliveries, 2);
  });
});
