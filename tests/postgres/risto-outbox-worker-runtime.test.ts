import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  OUTBOX_DELIVERY_FAILURE_REASON,
  dispatchNextOutboxMessage,
  type OutboxDeliveryAdapter,
  type OutboxDeliveryMessage
} from "../../packages/integrations/src/outbox-delivery.ts";
import { PostgresOutboxDeliveryStore } from "../../packages/persistence-postgres/src/risto-outbox-delivery.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });

async function seedOutboxEvent(label: string): Promise<string> {
  const tenant = await pool.query(
    `INSERT INTO platform.tenants (slug, name)
     VALUES ($1, $2)
     RETURNING id::text AS id`,
    [`mat016-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`, `MAT016 ${label}`]
  );
  const tenantId = String(tenant.rows[0].id);
  const location = await pool.query(
    `INSERT INTO platform.locations (tenant_id, slug, name, timezone, is_primary)
     VALUES ($1::uuid, 'main', 'Main', 'Europe/Rome', true)
     RETURNING id::text AS id`,
    [tenantId]
  );
  const locationId = String(location.rows[0].id);
  const event = await pool.query(
    `INSERT INTO events.outbox_events
      (tenant_id, location_id, event_type, aggregate_type, aggregate_id,
       payload_version, payload, correlation_id)
     VALUES ($1::uuid,$2::uuid,'SYNTHETIC_PROVIDER_DELIVERY_REQUESTED','Payment',$3,1,$4::jsonb,$5)
     RETURNING id::text AS id`,
    [tenantId, locationId, `payment-${label}`, JSON.stringify({ paymentId: `payment-${label}`, amount: "30.00", currency: "EUR" }), `corr-${label}`]
  );
  return String(event.rows[0].id);
}

async function state(eventId: string) {
  const result = await pool.query(
    `SELECT delivery_status AS "deliveryStatus", attempt_count AS "attemptCount",
            last_error AS "lastError", delivered_at AS "deliveredAt"
       FROM events.outbox_events
      WHERE id = $1::uuid`,
    [eventId]
  );
  return result.rows[0];
}

class SyntheticAdapter implements OutboxDeliveryAdapter {
  deliveries = 0;
  private failuresRemaining: number;

  constructor(failuresRemaining = 0) {
    this.failuresRemaining = failuresRemaining;
  }

  async deliver(_message: OutboxDeliveryMessage): Promise<void> {
    this.deliveries += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("provider-secret=SHOULD_NEVER_PERSIST");
    }
  }
}

async function expectDirectTableAccessDenied(role: string, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    await assert.rejects(client.query(sql), /permission denied|violates row-level security/i);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

test.after(async () => {
  await pool.end();
});

test("MAT-016 PostgreSQL outbox worker runtime boundary", async (t) => {
  // MAT-014 regression runs in the same ephemeral PostgreSQL service and may
  // legitimately leave its own pending domain event. MAT-016 isolates only its
  // synthetic fixture queue before testing worker selection semantics.
  await pool.query("DELETE FROM events.outbox_events");

  await t.test("worker and application roles cannot directly update durable outbox state", async () => {
    await expectDirectTableAccessDenied("airen_outbox_worker", "UPDATE events.outbox_events SET delivery_status='delivered'");
    await expectDirectTableAccessDenied("airen_app", "UPDATE events.outbox_events SET delivery_status='delivered'");
    await expectDirectTableAccessDenied("airen_outbox_worker", "SELECT * FROM events.outbox_events");
  });

  await t.test("concurrent claim is single-consumer and increments attempt atomically", async () => {
    const eventId = await seedOutboxEvent("claim");
    const first = new PostgresOutboxDeliveryStore(pool);
    const second = new PostgresOutboxDeliveryStore(pool);
    const [a, b] = await Promise.all([first.claimNext(), second.claimNext()]);
    const claimed = [a, b].filter((value) => value !== null);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]?.id, eventId);
    assert.equal(claimed[0]?.attemptCount, 1);
    const persisted = await state(eventId);
    assert.equal(persisted.deliveryStatus, "processing");
    assert.equal(persisted.attemptCount, 1);
    await first.markFailed(eventId, { terminal: true, reasonCode: OUTBOX_DELIVERY_FAILURE_REASON });
  });

  await t.test("synthetic provider failure persists only sanitized reason and retry recovers", async () => {
    const eventId = await seedOutboxEvent("recover");
    const store = new PostgresOutboxDeliveryStore(pool);
    const adapter = new SyntheticAdapter(1);

    const failed = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3 });
    assert.equal(failed.status, "failed");
    let persisted = await state(eventId);
    assert.equal(persisted.deliveryStatus, "failed");
    assert.equal(persisted.attemptCount, 1);
    assert.equal(persisted.lastError, OUTBOX_DELIVERY_FAILURE_REASON);
    assert.equal(String(persisted.lastError).includes("SHOULD_NEVER_PERSIST"), false);

    const recovered = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3, now: () => "2026-09-10T10:00:00.000Z" });
    assert.equal(recovered.status, "delivered");
    persisted = await state(eventId);
    assert.equal(persisted.deliveryStatus, "delivered");
    assert.equal(persisted.attemptCount, 2);
    assert.equal(persisted.lastError, null);
    assert.ok(persisted.deliveredAt);

    const noRedelivery = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3 });
    assert.equal(noRedelivery.status, "empty");
    assert.equal(adapter.deliveries, 2);
  });

  await t.test("retry exhaustion becomes dead_letter and cannot be redelivered", async () => {
    const eventId = await seedOutboxEvent("deadletter");
    const store = new PostgresOutboxDeliveryStore(pool);
    const adapter = new SyntheticAdapter(10);

    assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "failed");
    assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "dead_letter");
    const persisted = await state(eventId);
    assert.equal(persisted.deliveryStatus, "dead_letter");
    assert.equal(persisted.attemptCount, 2);
    assert.equal(persisted.lastError, OUTBOX_DELIVERY_FAILURE_REASON);

    assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "empty");
    assert.equal(adapter.deliveries, 2);
  });
});
