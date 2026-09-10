import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  receiveProviderWebhook,
  type ProviderWebhookRequest,
  type VerifiedProviderWebhookEvent,
  type WebhookSignatureVerifier
} from "../../packages/integrations/src/webhook-replay.ts";
import { PostgresWebhookReplayStore } from "../../packages/persistence-postgres/src/webhook-replay.ts";
import { PostgresPaymentRecordUnitOfWork } from "../../packages/persistence-postgres/src/risto-payment-record.ts";
import {
  createProviderPaymentCaptureHandler,
  type TrustedProviderCaptureLookup,
  type TrustedProviderCaptureResolver
} from "../../packages/ristoairen/src/pos/provider-payment-capture.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 8 });

const TENANT = "19191919-1111-4111-8111-111111111111";
const LOCATION = "19191919-2222-4222-8222-222222222222";
const IDENTITY = "19191919-3333-4333-8333-333333333333";
const ORDER = "19191919-4444-4444-8444-444444444444";
const UNAUTH_IDENTITY = "19191919-5555-4555-8555-555555555555";

function securityContext(correlationId: string, authorized = true): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: authorized ? IDENTITY : UNAUTH_IDENTITY,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: "mat019-tm",
    locationMembershipId: "mat019-lm",
    tenantRole: authorized ? "responsabile" : "staff",
    locationRole: authorized ? "responsabile" : "staff",
    permissions: authorized ? ["pos.payment.record"] : [],
    entitlements: ["vertical.ristoairen"]
  });
}

class SyntheticVerifier implements WebhookSignatureVerifier {
  async verify(request: ProviderWebhookRequest): Promise<VerifiedProviderWebhookEvent> {
    if (request.headers["x-mat019-proof"] !== "accepted") throw new Error("verification failed");
    const parsed = JSON.parse(typeof request.rawBody === "string" ? request.rawBody : Buffer.from(request.rawBody).toString("utf8"));
    return Object.freeze({
      providerEventId: String(request.headers["x-provider-event-id"]),
      eventType: String(parsed.type),
      providerPayload: Object.freeze(parsed)
    });
  }
}

function callback(eventId: string, body: Record<string, unknown>, valid = true): ProviderWebhookRequest {
  return Object.freeze({
    rawBody: JSON.stringify(body),
    headers: Object.freeze({
      "x-mat019-proof": valid ? "accepted" : "rejected",
      "x-provider-event-id": eventId
    })
  });
}

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name)
    VALUES ('${TENANT}', 'mat019', 'MAT019 Synthetic Tenant');
    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone)
    VALUES ('${LOCATION}', '${TENANT}', 'main', 'MAT019 Synthetic Location', 'Europe/Rome');
    INSERT INTO identity.identities (id, display_name) VALUES
      ('${IDENTITY}', 'MAT019 Trusted Financial Actor'),
      ('${UNAUTH_IDENTITY}', 'MAT019 Unprivileged Actor');
    INSERT INTO ristoairen.orders
      (id, tenant_id, location_id, channel, status, currency,
       subtotal, discount_total, tax_total, total, opened_at,
       created_by_identity_id, version, environment_class)
    VALUES
      ('${ORDER}', '${TENANT}', '${LOCATION}', 'POS', 'BILLING', 'EUR',
       80, 0, 0, 80, now(), '${IDENTITY}', 1, 'TEST_TEMPORARY');
  `);
}

function trustedResolver(observed: TrustedProviderCaptureLookup[]): TrustedProviderCaptureResolver {
  return Object.freeze({
    async resolve(lookup: TrustedProviderCaptureLookup) {
      observed.push(Object.freeze({ ...lookup }));
      if (lookup.providerEventId === "evt-mat019-capture") {
        return Object.freeze({
          securityContext: securityContext("mat019-capture"),
          payment: Object.freeze({
            orderId: ORDER,
            paymentMethod: "CARD" as const,
            amount: "25.00",
            currency: "EUR",
            idempotencyKey: "mat019-provider-capture-1",
            providerReference: "trusted-provider-ref-019"
          })
        });
      }
      if (lookup.providerEventId === "evt-mat019-unauthorized") {
        return Object.freeze({
          securityContext: securityContext("mat019-unauthorized", false),
          payment: Object.freeze({
            orderId: ORDER,
            paymentMethod: "CARD" as const,
            amount: "10.00",
            currency: "EUR",
            idempotencyKey: "mat019-provider-capture-unauthorized"
          })
        });
      }
      return null;
    }
  });
}

test("MAT-019 verified provider capture creates at most one canonical Payment effect", async (t) => {
  await seed();
  t.after(async () => { await pool.end(); });

  const verifier = new SyntheticVerifier();
  const replayStore = new PostgresWebhookReplayStore(pool);
  const paymentUow = new PostgresPaymentRecordUnitOfWork(pool);
  const observedLookups: TrustedProviderCaptureLookup[] = [];
  const handler = createProviderPaymentCaptureHandler({
    resolver: trustedResolver(observedLookups),
    unitOfWork: paymentUow,
    now: () => "2026-09-10T11:20:00.000Z"
  });
  const dependencies = Object.freeze({
    providerKey: "synthetic.capture",
    verifier,
    replayStore,
    handler,
    now: () => "2026-09-10T11:20:00.000Z"
  });

  await t.test("provider payload cannot choose financial scope or amount and exact replay is single-effect", async () => {
    const request = callback("evt-mat019-capture", {
      type: "payment.captured",
      tenant_id: "provider-controlled-tenant",
      location_id: "provider-controlled-location",
      order_id: "provider-controlled-order",
      amount: "999999.00",
      currency: "USD",
      actor_identity_id: "provider-controlled-actor",
      permissions: ["pos.payment.record"],
      provider_reference: "provider-controlled-reference"
    });

    const first = await receiveProviderWebhook(dependencies, request);
    const replay = await receiveProviderWebhook(dependencies, request);
    assert.equal(first.status, "processed");
    assert.equal(replay.status, "duplicate_acknowledged");
    assert.equal(first.receiptId, replay.receiptId);

    const money = await pool.query(
      `SELECT tenant_id::text AS tenant_id, location_id::text AS location_id,
              order_id::text AS order_id, amount::text AS amount, currency,
              provider_reference, idempotency_key, status
         FROM ristoairen.payments
        WHERE idempotency_key='mat019-provider-capture-1'`
    );
    assert.equal(money.rowCount, 1);
    assert.deepEqual(money.rows[0], {
      tenant_id: TENANT,
      location_id: LOCATION,
      order_id: ORDER,
      amount: "25.00",
      currency: "EUR",
      provider_reference: "trusted-provider-ref-019",
      idempotency_key: "mat019-provider-capture-1",
      status: "RECORDED"
    });

    assert.equal(observedLookups.length, 1);
    assert.deepEqual(observedLookups[0], {
      providerEventId: "evt-mat019-capture",
      eventType: "payment.captured"
    });
    assert.equal("providerPayload" in (observedLookups[0] as Record<string, unknown>), false);

    const audit = await pool.query(
      `SELECT count(*)::int AS count
         FROM audit.audit_events
        WHERE action_key='PAYMENT_RECORDED'
          AND metadata->>'idempotencyKey'='mat019-provider-capture-1'`
    );
    assert.equal(audit.rows[0].count, 1);
  });

  await t.test("same provider event ID with changed body fails before a second monetary effect", async () => {
    const changed = callback("evt-mat019-capture", {
      type: "payment.captured",
      amount: "1.00",
      tenant_id: "different-provider-controlled-tenant"
    });
    await assert.rejects(
      receiveProviderWebhook(dependencies, changed),
      /WEBHOOK_REPLAY_DIGEST_CONFLICT/
    );
    const count = await pool.query(
      `SELECT count(*)::int AS count FROM ristoairen.payments WHERE idempotency_key='mat019-provider-capture-1'`
    );
    assert.equal(count.rows[0].count, 1);
  });

  await t.test("missing trusted binding fails closed with no Payment", async () => {
    await assert.rejects(
      receiveProviderWebhook(
        { ...dependencies, providerKey: "synthetic.unknown" },
        callback("evt-mat019-unknown", { type: "payment.captured", amount: "80.00" })
      ),
      /WEBHOOK_PROCESSING_FAILED/
    );
    const count = await pool.query(
      `SELECT count(*)::int AS count FROM ristoairen.payments WHERE idempotency_key LIKE 'mat019-%'`
    );
    assert.equal(count.rows[0].count, 1);
  });

  await t.test("provider claims cannot grant pos.payment.record to an unprivileged trusted actor", async () => {
    await assert.rejects(
      receiveProviderWebhook(
        { ...dependencies, providerKey: "synthetic.unauthorized" },
        callback("evt-mat019-unauthorized", {
          type: "payment.captured",
          permissions: ["pos.payment.record"],
          role: "owner",
          amount: "10.00"
        })
      ),
      /WEBHOOK_PROCESSING_FAILED/
    );
    const unauthorized = await pool.query(
      `SELECT count(*)::int AS count FROM ristoairen.payments WHERE idempotency_key='mat019-provider-capture-unauthorized'`
    );
    assert.equal(unauthorized.rows[0].count, 0);
  });
});
