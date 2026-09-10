import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type {
  OutboxDeliveryAdapter,
  OutboxDeliveryMessage
} from "../../packages/integrations/src/outbox-delivery.ts";
import { PostgresOutboxDeliveryStore } from "../../packages/persistence-postgres/src/risto-outbox-delivery.ts";
import {
  BackgroundJobEngine,
  createOutboxDeliveryTick
} from "../../packages/runtime-jobs/src/background-job-engine.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });

async function seedOutboxEvent(label: string): Promise<string> {
  const tenant = await pool.query(
    `INSERT INTO platform.tenants (slug, name)
     VALUES ($1, $2)
     RETURNING id::text AS id`,
    [`mat017-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`, `MAT017 ${label}`]
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
     VALUES ($1::uuid,$2::uuid,'SYNTHETIC_BACKGROUND_DELIVERY_REQUESTED','Payment',$3,1,$4::jsonb,$5)
     RETURNING id::text AS id`,
    [tenantId, locationId, `payment-${label}`, JSON.stringify({ paymentId: `payment-${label}`, amount: "42.00", currency: "EUR" }), `corr-${label}`]
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

class RecoveringSyntheticAdapter implements OutboxDeliveryAdapter {
  deliveries = 0;
  private readonly controller: AbortController;

  constructor(controller: AbortController) {
    this.controller = controller;
  }

  async deliver(_message: OutboxDeliveryMessage): Promise<void> {
    this.deliveries += 1;
    if (this.deliveries === 1) {
      throw new Error("provider-secret=MAT017_MUST_NEVER_PERSIST");
    }
    this.controller.abort();
  }
}

test.after(async () => {
  await pool.end();
});

test("MAT-017 background job engine drives PostgreSQL outbox recovery without provider authority", async () => {
  await pool.query("DELETE FROM events.outbox_events");

  const eventId = await seedOutboxEvent("recover");
  const controller = new AbortController();
  const adapter = new RecoveringSyntheticAdapter(controller);
  const store = new PostgresOutboxDeliveryStore(pool);
  const sleeps: number[] = [];

  const engine = new BackgroundJobEngine({
    pollIntervalMs: 7,
    maxConsecutiveWorkTicks: 10,
    runTick: createOutboxDeliveryTick({
      store,
      adapter,
      maxAttempts: 3,
      now: () => "2026-09-10T10:30:00.000Z"
    }),
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
    }
  });

  const summary = await engine.run(controller.signal);
  const persisted = await state(eventId);

  assert.equal(adapter.deliveries, 2);
  assert.deepEqual(sleeps, [7]);
  assert.equal(summary.ticks, 2);
  assert.equal(summary.idleTicks, 1);
  assert.equal(summary.workTicks, 1);
  assert.equal(persisted.deliveryStatus, "delivered");
  assert.equal(persisted.attemptCount, 2);
  assert.equal(persisted.lastError, null);
  assert.ok(persisted.deliveredAt);
  assert.equal(String(persisted.lastError).includes("MAT017_MUST_NEVER_PERSIST"), false);
});
