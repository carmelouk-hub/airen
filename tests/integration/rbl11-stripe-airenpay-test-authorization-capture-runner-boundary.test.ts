import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError, type SecretRef } from "../../packages/shared-contracts/src/index.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../../packages/airenpay/src/index.ts";
import type { SecretMaterial, SecretProvider } from "../../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import {
  StripeAirenPayTestHttpClientFactory,
  type StripeAirenPayFetch
} from "../../packages/integrations/src/stripe-airenpay-test-http-client.ts";

const RUNNER = resolve(process.cwd(), "deploy/prove-stripe-airenpay-test-authorization-capture.ts");
const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_AUTHORIZATION_CAPTURE_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const PROVIDER_REFERENCE = "pi_rbl11_capture_fixture";
const TEST_KEY = ["rk", "test", "rbl11", "fixture"].join("_");
const LIVE_KEY = ["sk", "live", "rbl11", "fixture"].join("_");

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
    id: "00000000-0000-4000-8000-000000001110",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_fixture",
    capabilities: ["CAPTURE_AUTHORIZATION", "TRANSACTION_STATUS"],
    mode: "TEST",
    credentialSecretRef: { provider: "fixture", key: "credential" },
    status: "ACTIVE",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    rowVersion: 1,
    ...overrides
  });
}

function context(activeConnection = connection()): AirenPayGatewayOperationContextV1 {
  return Object.freeze({
    orchestrationId: "00000000-0000-4000-8000-000000001121",
    correlationId: "rbl11-stripe-test-authorization-capture-proof-v1",
    idempotencyKey: "rbl11-stripe-test-authorization-capture-proof-v1",
    connection: activeConnection
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("RBL11 captureAuthorization maps exactly EUR 1.00 TEST to Stripe capture with AIRen capture idempotency", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeAirenPayFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const url = String(input);
    if (init?.method === "POST" && url.endsWith(`/payment_intents/${PROVIDER_REFERENCE}/capture`)) {
      return jsonResponse({
        id: PROVIDER_REFERENCE,
        status: "succeeded",
        livemode: false,
        amount: 100,
        currency: "eur",
        amount_capturable: 0
      });
    }
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
    return jsonResponse({ error: { type: "invalid_request_error" } }, 400);
  };

  const factory = new StripeAirenPayTestHttpClientFactory({
    secretProvider: new FixtureSecretProvider(TEST_KEY),
    fetchImpl,
    apiBaseUrl: "https://api.stripe.test/v1"
  });
  const adapter = new StripeAirenPayTestAdapter(factory);
  const operationContext = context();

  const captured = await adapter.captureAuthorization(operationContext, PROVIDER_REFERENCE, {
    amountMinor: 100,
    currency: "EUR"
  });
  assert.equal(captured.providerReference, PROVIDER_REFERENCE);
  assert.equal(captured.status, "CAPTURED");
  assert.equal(captured.providerMetadata?.stripeStatus, "succeeded");
  assert.equal(captured.providerMetadata?.livemode, false);

  const readBack = await adapter.getTransactionStatus(operationContext, PROVIDER_REFERENCE);
  assert.equal(readBack.providerReference, PROVIDER_REFERENCE);
  assert.equal(readBack.status, "GUARANTEE_SATISFIED");
  assert.equal(readBack.providerMetadata?.stripeStatus, "succeeded");
  assert.equal(readBack.providerMetadata?.livemode, false);
  assert.deepEqual(readBack.amount, { amountMinor: 100, currency: "EUR" });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.stripe.test/v1/payment_intents/${PROVIDER_REFERENCE}/capture`);
  assert.equal(calls[0].init?.method, "POST");
  const captureHeaders = new Headers(calls[0].init?.headers);
  assert.equal(captureHeaders.get("authorization"), `Bearer ${TEST_KEY}`);
  assert.equal(captureHeaders.get("idempotency-key"), "rbl11-stripe-test-authorization-capture-proof-v1:stripe:capture");
  assert.equal(String(calls[0].init?.body ?? ""), "amount_to_capture=100");
  assert.equal(calls[1].url, `https://api.stripe.test/v1/payment_intents/${PROVIDER_REFERENCE}`);
  assert.equal(calls[1].init?.method, "GET");
  assert.equal(calls.some(call => /\/cancel(?:\b|[/?])/.test(call.url)), false);
  assert.equal(calls.some(call => /\/refunds(?:\b|[/?])/.test(call.url)), false);
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

test("authorization-capture runner fails closed when explicit opt-in flag is absent", () => {
  const result = execute();
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_capture.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("authorization-capture runner fails closed when TEST credential SecretRef material is absent", () => {
  const result = execute({ [ENABLE_FLAG]: "true" });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_capture.failed");
  assert.equal(error.code, "SECRET_RESOLUTION_FAILED");
});

test("authorization-capture runner rejects LIVE credential material before provider execution", () => {
  const result = execute({ [ENABLE_FLAG]: "true", [SECRET_ENV_KEY]: LIVE_KEY });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_capture.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("D4-C source boundary creates a fresh TEST authorization and captures once without release/refund", () => {
  const runnerSource = readFileSync(RUNNER, "utf8");

  assert.match(runnerSource, /AIRENPAY_STRIPE_TEST_AUTHORIZATION_CAPTURE_PROOF_ENABLED/);
  assert.match(runnerSource, /00000000-0000-4000-8000-000000001121/);
  assert.match(runnerSource, /rbl11-stripe-test-authorization-capture-proof-v1/);
  assert.match(runnerSource, /\.createAuthorizationHold\s*\(/);
  assert.match(runnerSource, /confirmStripeTestAuthorizationForProof\s*\(/);
  assert.match(runnerSource, /pm_card_visa/);
  assert.match(runnerSource, /requires_capture/);
  assert.match(runnerSource, /amountCapturable !== TEST_AMOUNT_MINOR/);
  assert.match(runnerSource, /\.captureAuthorization\s*\(/);
  assert.match(runnerSource, /amountMinor:\s*TEST_AMOUNT_MINOR/);
  assert.match(runnerSource, /TEST_AMOUNT_MINOR = 100/);
  assert.match(runnerSource, /TEST_CURRENCY = "EUR"/);
  assert.match(runnerSource, /captured\.status !== "CAPTURED"/);
  assert.match(runnerSource, /stripeStatus !== "succeeded"/);
  assert.match(runnerSource, /testCaptureExecuted(?:ByRunner)?: true/);
  assert.match(runnerSource, /captureExecuted(?:ByRunner)?: true/);
  assert.match(runnerSource, /releaseExecuted(?:ByRunner)?: false/);
  assert.match(runnerSource, /refundExecuted(?:ByRunner)?: false/);
  assert.match(runnerSource, /testModeOnly: true/);
  assert.match(runnerSource, /realMoneyMovement: false/);

  assert.doesNotMatch(runnerSource, /pi_3U9w04P5zjpreN161pyxan3o/);
  assert.doesNotMatch(runnerSource, /\.releaseAuthorization\s*\(/);
  assert.doesNotMatch(runnerSource, /\.refundPayment\s*\(/);
  assert.doesNotMatch(runnerSource, /process\.env\[[^\]]*(?:PROVIDER|PAYMENT).*REFERENCE/i);
  assert.doesNotMatch(runnerSource, /\b(?:card_number|pan|cvv|cvc)\b/i);
});
