import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { AppError, type SecretRef } from "../../packages/shared-contracts/src/index.ts";
import type { TenantPaymentGatewayConnectionProjectionV1 } from "../../packages/airenpay/src/index.ts";
import type { SecretMaterial, SecretProvider } from "../../packages/integrations/src/index.ts";
import {
  StripeAirenPayTestHttpClientFactory,
  type StripeAirenPayFetch
} from "../../packages/integrations/src/stripe-airenpay-test-http-client.ts";

const TEST_KEY = ["sk", "test", "rbl06", "fixture"].join("_");
const LIVE_KEY = ["sk", "live", "rbl06", "fixture"].join("_");
const WEBHOOK_KEY = ["whsec", "rbl06", "fixture"].join("_");
const NOW_SECONDS = 1_788_000_000;

class FixtureSecretMaterial implements SecretMaterial {
  private readonly value: string;
  constructor(value: string) { this.value = value; }
  use<T>(consumer: (value: string) => T): T { return consumer(this.value); }
  toString(): string { return "[REDACTED_SECRET]"; }
  toJSON(): string { return "[REDACTED_SECRET]"; }
}

class FixtureSecretProvider implements SecretProvider {
  readonly providerKey = "fixture";
  private readonly values: Readonly<Record<string, string>>;
  constructor(values: Readonly<Record<string, string>>) { this.values = values; }
  async resolve(ref: SecretRef): Promise<SecretMaterial> {
    if (ref.provider !== this.providerKey || !this.values[ref.key]) throw new AppError("SECRET_RESOLUTION_FAILED", "fixture secret unavailable");
    return new FixtureSecretMaterial(this.values[ref.key]);
  }
}

function connection(overrides: Partial<TenantPaymentGatewayConnectionProjectionV1> = {}): TenantPaymentGatewayConnectionProjectionV1 {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000610",
    tenantId: "00000000-0000-4000-8000-000000000602",
    locationId: "00000000-0000-4000-8000-000000000603",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_fixture",
    capabilities: [
      "PAYMENT_METHOD_SETUP", "DEPOSIT_PAYMENT", "FULL_PREPAYMENT", "AUTHORIZATION_HOLD",
      "CAPTURE_AUTHORIZATION", "RELEASE_AUTHORIZATION", "REFUND_PAYMENT", "TRANSACTION_STATUS", "WEBHOOK_VERIFICATION"
    ],
    mode: "TEST",
    credentialSecretRef: { provider: "fixture", key: "credential" },
    webhookSecretRef: { provider: "fixture", key: "webhook" },
    status: "ACTIVE",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    rowVersion: 1,
    ...overrides
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function expectCode(action: () => Promise<unknown>, code: AppError["code"]): Promise<AppError> {
  try {
    await action();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    return error;
  }
}

function factory(fetchImpl: StripeAirenPayFetch, credential = TEST_KEY) {
  return new StripeAirenPayTestHttpClientFactory({
    secretProvider: new FixtureSecretProvider({ credential, webhook: WEBHOOK_KEY }),
    fetchImpl,
    apiBaseUrl: "https://api.stripe.test/v1",
    now: () => NOW_SECONDS * 1000
  });
}

test("SetupIntent request uses TEST credential, AIRen idempotency and Stripe form mapping", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeAirenPayFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({ id: "seti_rbl06", status: "requires_payment_method", client_secret: "opaque_client_secret", livemode: false });
  };
  const client = await factory(fetchImpl).forConnection(connection());
  const result = await client.createSetupIntent({
    usage: "off_session",
    automaticPaymentMethods: { enabled: true },
    metadata: { airen_orchestration_id: "orch-610", airen_correlation_id: "corr-610" }
  }, { idempotencyKey: "airen-idem-610:stripe:setup" });

  assert.equal(result.id, "seti_rbl06");
  assert.equal(result.livemode, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.stripe.test/v1/setup_intents");
  assert.equal(calls[0].init?.method, "POST");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TEST_KEY}`);
  assert.equal(headers.get("idempotency-key"), "airen-idem-610:stripe:setup");
  const body = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(body.get("usage"), "off_session");
  assert.equal(body.get("automatic_payment_methods[enabled]"), "true");
  assert.equal(body.get("metadata[airen_orchestration_id]"), "orch-610");
  assert.equal(body.get("metadata[airen_correlation_id]"), "corr-610");
});

test("authorization hold maps to PaymentIntent manual capture without exposing provider authority", async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const fetchImpl: StripeAirenPayFetch = async (input, init) => {
    captured = { url: String(input), init };
    return jsonResponse({
      id: "pi_rbl06", status: "requires_capture", client_secret: "opaque_pi_secret",
      amount: 4200, currency: "eur", amount_capturable: 4200, livemode: false
    });
  };
  const client = await factory(fetchImpl).forConnection(connection());
  const result = await client.createPaymentIntent({
    amount: 4200,
    currency: "eur",
    captureMethod: "manual",
    automaticPaymentMethods: { enabled: true },
    metadata: { airen_orchestration_id: "orch-611", airen_correlation_id: "corr-611" }
  }, { idempotencyKey: "airen-idem-611:stripe:authorization-hold" });
  assert.equal(result.status, "requires_capture");
  assert.equal(captured?.url, "https://api.stripe.test/v1/payment_intents");
  const body = new URLSearchParams(String(captured?.init?.body));
  assert.equal(body.get("amount"), "4200");
  assert.equal(body.get("currency"), "eur");
  assert.equal(body.get("capture_method"), "manual");
});

test("LIVE credential material is rejected before any network call", async () => {
  let calls = 0;
  const fetchImpl: StripeAirenPayFetch = async () => { calls += 1; return jsonResponse({}); };
  const client = await factory(fetchImpl, LIVE_KEY).forConnection(connection());
  await expectCode(() => client.createSetupIntent({
    usage: "off_session", automaticPaymentMethods: { enabled: true }, metadata: {}
  }, { idempotencyKey: "airen-idem-612:stripe:setup" }), "PERMISSION_DENIED");
  assert.equal(calls, 0);
});

test("provider errors expose only bounded codes and never provider messages", async () => {
  const fetchImpl: StripeAirenPayFetch = async () => jsonResponse({
    error: { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "SENSITIVE PROVIDER MESSAGE" }
  }, 402);
  const client = await factory(fetchImpl).forConnection(connection());
  const error = await expectCode(() => client.createPaymentIntent({
    amount: 1500, currency: "eur", captureMethod: "automatic", automaticPaymentMethods: { enabled: true }, metadata: {}
  }, { idempotencyKey: "airen-idem-613:stripe:deposit" }), "VALIDATION_FAILED");
  assert.deepEqual(error.details, {
    provider: "stripe", httpStatus: 402, providerErrorType: "card_error",
    providerErrorCode: "card_declined", providerDeclineCode: "generic_decline"
  });
  assert.equal(JSON.stringify(error).includes("SENSITIVE PROVIDER MESSAGE"), false);
});

function signedWebhook(body: Uint8Array, timestamp = NOW_SECONDS): string {
  const digest = createHmac("sha256", WEBHOOK_KEY).update(String(timestamp)).update(".").update(body).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

test("raw-body webhook verification accepts valid TEST event and rejects tampering", async () => {
  const fetchImpl: StripeAirenPayFetch = async () => jsonResponse({});
  const client = await factory(fetchImpl).forConnection(connection());
  const rawBody = Buffer.from(JSON.stringify({
    id: "evt_rbl06", type: "setup_intent.succeeded", created: NOW_SECONDS, livemode: false,
    data: { object: { id: "seti_rbl06" } }
  }));
  const verified = await client.verifyWebhook(rawBody, signedWebhook(rawBody), connection());
  assert.equal(verified.id, "evt_rbl06");
  assert.equal(verified.providerReference, "seti_rbl06");
  assert.equal(verified.livemode, false);

  const tampered = Buffer.from(rawBody.toString("utf8").replace("seti_rbl06", "seti_tampered"));
  await expectCode(() => client.verifyWebhook(tampered, signedWebhook(rawBody), connection()), "AUTHENTICATION_REQUIRED");
});

test("validly signed LIVE webhook is still rejected by TEST-only client", async () => {
  const fetchImpl: StripeAirenPayFetch = async () => jsonResponse({});
  const client = await factory(fetchImpl).forConnection(connection());
  const rawBody = Buffer.from(JSON.stringify({
    id: "evt_live_fixture", type: "payment_intent.succeeded", created: NOW_SECONDS, livemode: true,
    data: { object: { id: "pi_live_fixture", amount: 1000, currency: "eur" } }
  }));
  await expectCode(() => client.verifyWebhook(rawBody, signedWebhook(rawBody), connection()), "PERMISSION_DENIED");
});

test("factory rejects LIVE Stripe connection configuration", async () => {
  const fetchImpl: StripeAirenPayFetch = async () => jsonResponse({});
  await expectCode(() => factory(fetchImpl).forConnection(connection({ mode: "LIVE" })), "PERMISSION_DENIED");
});
