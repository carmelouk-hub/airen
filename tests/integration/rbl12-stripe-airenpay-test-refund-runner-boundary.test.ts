import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError, type SecretRef } from "../../packages/shared-contracts/src/index.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../../packages/ristoairen/src/airenpay/index.ts";
import type { SecretMaterial, SecretProvider } from "../../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import {
  StripeAirenPayTestHttpClientFactory,
  type StripeAirenPayFetch
} from "../../packages/integrations/src/stripe-airenpay-test-http-client.ts";

const RUNNER = resolve(process.cwd(), "deploy/prove-stripe-airenpay-test-refund.ts");
const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_REFUND_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const PROVIDER_REFERENCE = "pi_rbl12_refund_fixture";
const TEST_KEY = ["rk", "test", "rbl12", "fixture"].join("_");
const LIVE_KEY = ["sk", "live", "rbl12", "fixture"].join("_");

class FixtureSecretMaterial implements SecretMaterial {
  private readonly value: string;
  constructor(value: string) { this.value = value; }
  use<T>(consumer: (value: string) => T): T { return consumer(this.value); }
  toString(): string { return "[REDACTED_SECRET]"; }
  toJSON(): string { return "[REDACTED_SECRET]"; }
}

class FixtureSecretProvider implements SecretProvider {
  readonly providerKey = "fixture";
  private readonly credential: string;
  constructor(credential: string) { this.credential = credential; }
  async resolve(ref: SecretRef): Promise<SecretMaterial> {
    if (ref.provider !== this.providerKey || ref.key !== "credential") {
      throw new AppError("SECRET_RESOLUTION_FAILED", "fixture secret unavailable");
    }
    return new FixtureSecretMaterial(this.credential);
  }
}

function connection(overrides: Partial<TenantPaymentGatewayConnectionProjectionV1> = {}): TenantPaymentGatewayConnectionProjectionV1 {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000001210",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_fixture",
    capabilities: ["REFUND_PAYMENT", "TRANSACTION_STATUS"],
    mode: "TEST",
    credentialSecretRef: { provider: "fixture", key: "credential" },
    status: "ACTIVE",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    rowVersion: 1,
    ...overrides
  });
}

function context(activeConnection = connection()): AirenPayGatewayOperationContextV1 {
  return Object.freeze({
    orchestrationId: "00000000-0000-4000-8000-000000001221",
    correlationId: "rbl12-stripe-test-refund-proof-v1",
    idempotencyKey: "rbl12-stripe-test-refund-proof-v1",
    connection: activeConnection
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("RBL12 maps the real Stripe Refund response shape without inventing livemode and preserves AIRen idempotency", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeAirenPayFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const url = String(input);
    if (init?.method === "GET" && url.endsWith(`/payment_intents/${PROVIDER_REFERENCE}`)) {
      return jsonResponse({
        id: PROVIDER_REFERENCE,
        status: "succeeded",
        livemode: false,
        amount: 100,
        currency: "eur",
        amount_capturable: 0
      });
    }
    if (init?.method === "POST" && url.endsWith("/refunds")) {
      return jsonResponse({
        id: "re_rbl12_fixture",
        payment_intent: PROVIDER_REFERENCE,
        charge: "ch_rbl12_fixture",
        amount: 100,
        currency: "eur",
        status: "succeeded"
      });
    }
    return jsonResponse({ error: { type: "invalid_request_error" } }, 400);
  };

  const factory = new StripeAirenPayTestHttpClientFactory({
    secretProvider: new FixtureSecretProvider(TEST_KEY),
    fetchImpl,
    apiBaseUrl: "https://api.stripe.test/v1"
  });
  const adapter = new StripeAirenPayTestAdapter(factory);
  const operationContext = context();

  const beforeRefund = await adapter.getTransactionStatus(operationContext, PROVIDER_REFERENCE);
  assert.equal(beforeRefund.providerReference, PROVIDER_REFERENCE);
  assert.equal(beforeRefund.status, "GUARANTEE_SATISFIED");
  assert.equal(beforeRefund.providerMetadata?.stripeStatus, "succeeded");
  assert.equal(beforeRefund.providerMetadata?.livemode, false);
  assert.deepEqual(beforeRefund.amount, { amountMinor: 100, currency: "EUR" });

  const refunded = await adapter.refundPayment(operationContext, PROVIDER_REFERENCE, {
    amountMinor: 100,
    currency: "EUR"
  });
  assert.equal(refunded.providerReference, PROVIDER_REFERENCE);
  assert.equal(refunded.status, "REFUNDED");
  assert.equal(refunded.providerMetadata?.stripeObject, "refund");
  assert.equal(refunded.providerMetadata?.stripeRefundReference, "re_rbl12_fixture");
  assert.equal(refunded.providerMetadata?.stripeStatus, "succeeded");
  assert.equal(refunded.providerMetadata?.livemode, false);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.stripe.test/v1/payment_intents/${PROVIDER_REFERENCE}`);
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[1].url, "https://api.stripe.test/v1/refunds");
  assert.equal(calls[1].init?.method, "POST");
  const refundHeaders = new Headers(calls[1].init?.headers);
  assert.equal(refundHeaders.get("authorization"), `Bearer ${TEST_KEY}`);
  assert.equal(refundHeaders.get("idempotency-key"), "rbl12-stripe-test-refund-proof-v1:stripe:refund");
  assert.equal(String(calls[1].init?.body ?? ""), `payment_intent=${PROVIDER_REFERENCE}&amount=100`);
  assert.equal(calls.some(call => /\/capture(?:\b|[/?])/.test(call.url)), false);
  assert.equal(calls.some(call => /\/cancel(?:\b|[/?])/.test(call.url)), false);
});

function execute(overrides: Readonly<Record<string, string>> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  delete env[ENABLE_FLAG];
  delete env[SECRET_ENV_KEY];
  Object.assign(env, overrides);
  return spawnSync(process.execPath, ["--experimental-strip-types", RUNNER], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 10_000
  });
}

function lastJsonLine(stderr: string): Record<string, unknown> {
  const line = stderr.trim().split(/\r?\n/).reverse().find(value => value.trim().startsWith("{"));
  assert.ok(line, `expected JSON error line, got: ${stderr}`);
  return JSON.parse(line) as Record<string, unknown>;
}

test("refund runner fails closed when explicit opt-in flag is absent", () => {
  const result = execute();
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.refund.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("refund runner fails closed when TEST credential SecretRef material is absent", () => {
  const result = execute({ [ENABLE_FLAG]: "true" });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.refund.failed");
  assert.equal(error.code, "SECRET_RESOLUTION_FAILED");
});

test("refund runner rejects LIVE credential material before provider execution", () => {
  const result = execute({ [ENABLE_FLAG]: "true", [SECRET_ENV_KEY]: LIVE_KEY });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.refund.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("D4-D source boundary binds one refund to the exact D4-C captured sandbox payment and requires independent provider read-back", () => {
  const runnerSource = readFileSync(RUNNER, "utf8");

  assert.match(runnerSource, /AIRENPAY_STRIPE_TEST_REFUND_PROOF_ENABLED/);
  assert.match(runnerSource, /acct_1U9k1nP5zjpreN16/);
  assert.match(runnerSource, /pi_3UA5bpP5zjpreN160czIgndr/);
  assert.match(runnerSource, /00000000-0000-4000-8000-000000001221/);
  assert.match(runnerSource, /rbl12-stripe-test-refund-proof-v1/);
  assert.match(runnerSource, /\.getTransactionStatus\s*\(context, D4C_CAPTURED_PAYMENT_INTENT\)/);
  assert.match(runnerSource, /stripeStatus !== "succeeded"/);
  assert.match(runnerSource, /beforeRefund\.status !== "GUARANTEE_SATISFIED"/);
  assert.match(runnerSource, /\.refundPayment\s*\(context, D4C_CAPTURED_PAYMENT_INTENT/);
  assert.match(runnerSource, /TEST_AMOUNT_MINOR = 100/);
  assert.match(runnerSource, /TEST_CURRENCY = "EUR"/);
  assert.match(runnerSource, /refunded\.status !== "REFUNDED"/);
  assert.match(runnerSource, /stripeRefundReference/);
  assert.match(runnerSource, /startsWith\("re_"\)/);
  assert.match(runnerSource, /refundExecutedByRunner: true/);
  assert.match(runnerSource, /authorizationCreatedByRunner: false/);
  assert.match(runnerSource, /paymentIntentCreatedByRunner: false/);
  assert.match(runnerSource, /captureExecutedByRunner: false/);
  assert.match(runnerSource, /releaseExecutedByRunner: false/);
  assert.match(runnerSource, /testModeOnly: true/);
  assert.match(runnerSource, /testProviderMutation: true/);
  assert.match(runnerSource, /realMoneyMovement: false/);
  assert.match(runnerSource, /independentProviderRefundReadbackRequired: true/);
  assert.match(runnerSource, /gateClosureEligible: false/);

  assert.doesNotMatch(runnerSource, /\.createAuthorizationHold\s*\(/);
  assert.doesNotMatch(runnerSource, /\.captureAuthorization\s*\(/);
  assert.doesNotMatch(runnerSource, /\.releaseAuthorization\s*\(/);
  assert.doesNotMatch(runnerSource, /confirmStripeTestAuthorizationForProof\s*\(/);
  assert.doesNotMatch(runnerSource, /process\.env\[[^\]]*(?:PROVIDER|PAYMENT).*REFERENCE/i);
  assert.doesNotMatch(runnerSource, /\b(?:card_number|pan|cvv|cvc)\b/i);
});
