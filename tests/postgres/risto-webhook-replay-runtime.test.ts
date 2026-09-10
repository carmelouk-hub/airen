import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  receiveProviderWebhook,
  reconcileProviderWebhook,
  type ProviderWebhookRequest,
  type VerifiedProviderWebhookEvent,
  type WebhookSignatureVerifier
} from "../../packages/integrations/src/webhook-replay.ts";
import { PostgresWebhookReplayStore } from "../../packages/persistence-postgres/src/webhook-replay.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl });

class SyntheticVerifier implements WebhookSignatureVerifier {
  async verify(request: ProviderWebhookRequest): Promise<VerifiedProviderWebhookEvent> {
    if (request.headers["x-synthetic-proof"] !== "accepted") throw new Error("synthetic-verification-detail");
    const parsed = JSON.parse(typeof request.rawBody === "string" ? request.rawBody : Buffer.from(request.rawBody).toString("utf8"));
    return Object.freeze({
      providerEventId: String(request.headers["x-provider-event-id"] ?? parsed.event_id),
      eventType: String(parsed.type),
      providerPayload: Object.freeze(parsed)
    });
  }
}

function request(eventId: string, body: Record<string, unknown>, valid = true): ProviderWebhookRequest {
  return Object.freeze({
    rawBody: JSON.stringify(body),
    headers: Object.freeze({
      "x-synthetic-proof": valid ? "accepted" : "rejected",
      "x-provider-event-id": eventId
    })
  });
}

async function receipts() {
  return pool.query(
    `SELECT id::text AS id, provider_key AS "providerKey", provider_event_id AS "providerEventId",
            event_type AS "eventType", payload_digest AS "payloadDigest",
            processing_status AS "processingStatus", attempt_count AS "attemptCount",
            last_error AS "lastError", processed_at AS "processedAt"
       FROM events.provider_webhook_receipts
      ORDER BY first_received_at, id`
  );
}

async function expectDirectAccessDenied(role: string, sql: string): Promise<void> {
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

test.after(async () => { await pool.end(); });

test("MAT-018 provider-neutral webhook replay runtime boundary", async (t) => {
  await pool.query("DELETE FROM events.provider_webhook_receipts");
  const verifier = new SyntheticVerifier();
  const store = new PostgresWebhookReplayStore(pool);

  await t.test("runtime roles have no direct receipt-table CRUD", async () => {
    await expectDirectAccessDenied("airen_webhook_worker", "SELECT * FROM events.provider_webhook_receipts");
    await expectDirectAccessDenied("airen_webhook_worker", "UPDATE events.provider_webhook_receipts SET processing_status='processed'");
    await expectDirectAccessDenied("airen_app", "SELECT * FROM events.provider_webhook_receipts");
  });

  await t.test("invalid verification fails closed before durable receipt or handler", async () => {
    let handled = 0;
    const before = (await receipts()).rowCount;
    await assert.rejects(
      receiveProviderWebhook(
        { providerKey: "synthetic.payments", verifier, replayStore: store, handler: async () => { handled += 1; } },
        request("evt-invalid", { type: "payment.captured", sensitive_marker: "NON_PERSISTENT_MARKER" }, false)
      ),
      /WEBHOOK_SIGNATURE_INVALID/
    );
    assert.equal(handled, 0);
    assert.equal((await receipts()).rowCount, before);
  });

  await t.test("first verified callback processes once and exact replay is acknowledged without second effect", async () => {
    let handled = 0;
    const req = request("evt-once", { type: "payment.captured", amount: "42.00", tenant_id: "provider-must-not-authorize" });
    const deps = {
      providerKey: "synthetic.payments", verifier, replayStore: store,
      handler: async () => { handled += 1; }, now: () => "2026-09-10T10:55:00.000Z"
    } as const;
    const first = await receiveProviderWebhook(deps, req);
    const replay = await receiveProviderWebhook(deps, req);
    assert.equal(first.status, "processed");
    assert.equal(replay.status, "duplicate_acknowledged");
    assert.equal(first.receiptId, replay.receiptId);
    assert.equal(handled, 1);
    const row = (await pool.query(`SELECT processing_status, attempt_count, last_error FROM events.provider_webhook_receipts WHERE provider_key='synthetic.payments' AND provider_event_id='evt-once'`)).rows[0];
    assert.equal(row.processing_status, "processed");
    assert.equal(row.attempt_count, 1);
    assert.equal(row.last_error, null);
  });

  await t.test("same provider event ID with a different raw-body digest fails closed", async () => {
    let handled = 0;
    const deps = { providerKey: "synthetic.conflict", verifier, replayStore: store, handler: async () => { handled += 1; } } as const;
    await receiveProviderWebhook(deps, request("evt-conflict", { type: "payment.captured", amount: "10.00" }));
    await assert.rejects(receiveProviderWebhook(deps, request("evt-conflict", { type: "payment.captured", amount: "999.00" })), /WEBHOOK_REPLAY_DIGEST_CONFLICT/);
    assert.equal(handled, 1);
  });

  await t.test("processing failure persists only sanitized state and explicit reconcile re-verifies then recovers", async () => {
    let calls = 0;
    const req = request("evt-reconcile", { type: "refund.completed", sensitive_marker: "NON_PERSISTENT_BODY_MARKER", tenant_id: "untrusted-provider-tenant" });
    const deps = {
      providerKey: "synthetic.refunds", verifier, replayStore: store,
      handler: async () => { calls += 1; if (calls === 1) throw new Error("NON_PERSISTENT_ERROR_MARKER"); },
      now: () => "2026-09-10T10:56:00.000Z"
    } as const;
    await assert.rejects(receiveProviderWebhook(deps, req), /WEBHOOK_PROCESSING_FAILED/);
    const duplicate = await receiveProviderWebhook(deps, req);
    assert.equal(duplicate.status, "duplicate_acknowledged");
    assert.equal(calls, 1);
    let row = (await pool.query(`SELECT processing_status, attempt_count, last_error FROM events.provider_webhook_receipts WHERE provider_key='synthetic.refunds' AND provider_event_id='evt-reconcile'`)).rows[0];
    assert.equal(row.processing_status, "failed");
    assert.equal(row.attempt_count, 1);
    assert.equal(row.last_error, "WEBHOOK_PROCESSING_FAILED");
    const reconciled = await reconcileProviderWebhook(deps, req);
    assert.equal(reconciled.status, "processed");
    assert.equal(calls, 2);
    row = (await pool.query(`SELECT processing_status, attempt_count, last_error FROM events.provider_webhook_receipts WHERE provider_key='synthetic.refunds' AND provider_event_id='evt-reconcile'`)).rows[0];
    assert.equal(row.processing_status, "processed");
    assert.equal(row.attempt_count, 2);
    assert.equal(row.last_error, null);
  });

  await t.test("concurrent exact callbacks produce one handler effect", async () => {
    let handled = 0;
    const req = request("evt-concurrent", { type: "payment.captured", amount: "30.00" });
    const deps = {
      providerKey: "synthetic.concurrent", verifier, replayStore: store,
      handler: async () => { handled += 1; await new Promise((resolve) => setTimeout(resolve, 20)); }
    } as const;
    const [a, b] = await Promise.all([receiveProviderWebhook(deps, req), receiveProviderWebhook(deps, req)]);
    assert.equal(handled, 1);
    assert.deepEqual(new Set([a.status, b.status]), new Set(["processed", "duplicate_acknowledged"]));
  });

  await t.test("receipt persistence contains no raw body, verification header, tenant, location or payload authority columns", async () => {
    const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='events' AND table_name='provider_webhook_receipts'`);
    const names = new Set(columns.rows.map((row) => String(row.column_name)));
    for (const prohibited of ["raw_body", "headers", "verification_header", "tenant_id", "location_id", "payload"]) assert.equal(names.has(prohibited), false);
    const serialized = JSON.stringify((await receipts()).rows);
    assert.equal(serialized.includes("NON_PERSISTENT_BODY_MARKER"), false);
    assert.equal(serialized.includes("untrusted-provider-tenant"), false);
    assert.equal(serialized.includes("NON_PERSISTENT_ERROR_MARKER"), false);
  });
});
