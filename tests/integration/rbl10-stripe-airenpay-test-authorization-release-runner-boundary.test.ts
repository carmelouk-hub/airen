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

const RUNNER = resolve(process.cwd(), "deploy/prove-stripe-airenpay-test-authorization-release.ts");
const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_AUTHORIZATION_RELEASE_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const FIXED_D4A_PROVIDER_REFERENCE = "pi_3U9w04P5zjpreN161pyxan3o";
const TEST_KEY = ["rk", "test", "rbl10", "fixture"].join("_");
const LIVE_KEY = ["sk", "live", "rbl10", "fixture"].join("_");

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
    id: "00000000-0000-4000-8000-000000001010",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_fixture",
    capabilities: ["RELEASE_AUTHORIZATION", "TRANSACTION_STATUS"],
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
    orchestrationId: "00000000-0000-4000-8000-000000001031",
    correlationId: "rbl10-stripe-test-authorization-release-proof-v1",
    idempotencyKey: "rbl10-stripe-test-authorization-release-proof-v1",
    connection: activeConnection
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("RBL10 releaseAuthorization maps only to Stripe TEST cancel with AIRen release idempotency", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeAirenPayFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const url = String(input);
    if (init?.method === "POST" && url.endsWith(`/payment_intents/${FIXED_D4A_PROVIDER_REFERENCE}/cancel`)) {
      return jsonResponse({
        id: FIXED_D4A_PROVIDER_REFERENCE,
        status: "canceled",
        livemode: false,
        amount: 100,
        currency: "eur",
        amount_capturable: 0
      });
    }
    if (init?.method === "GET" && url.endsWith(`/payment_intents/${FIXED_D4A_PROVIDER_REFERENCE}`)) {
      return jsonResponse({
        id: FIXED_D4A_PROVIDER_REFERENCE,
        status: "canceled",
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

  const released = await adapter.releaseAuthorization(operationContext, FIXED_D4A_PROVIDER_REFERENCE);
  assert.equal(released.providerReference, FIXED_D4A_PROVIDER_REFERENCE);
  assert.equal(released.status, "RELEASED");
  assert.equal(released.providerMetadata?.stripeStatus, "canceled");
  assert.equal(released.providerMetadata?.livemode, false);

  const readBack = await adapter.getTransactionStatus(operationContext, FIXED_D4A_PROVIDER_REFERENCE);
  assert.equal(readBack.providerReference, FIXED_D4A_PROVIDER_REFERENCE);
  assert.equal(readBack.status, "CANCELLED");
  assert.equal(readBack.providerMetadata?.stripeStatus, "canceled");
  assert.deepEqual(readBack.amount, { amountMinor: 100, currency: "EUR" });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.stripe.test/v1/payment_intents/${FIXED_D4A_PROVIDER_REFERENCE}/cancel`);
  assert.equal(calls[0].init?.method, "POST");
  const releaseHeaders = new Headers(calls[0].init?.headers);
  assert.equal(releaseHeaders.get("authorization"), `Bearer ${TEST_KEY}`);
  assert.equal(releaseHeaders.get("idempotency-key"), "rbl10-stripe-test-authorization-release-proof-v1:stripe:release");
  assert.equal(String(calls[0].init?.body ?? ""), "");
  assert.equal(calls[1].url, `https://api.stripe.test/v1/payment_intents/${FIXED_D4A_PROVIDER_REFERENCE}`);
  assert.equal(calls[1].init?.method, "GET");
  assert.equal(calls.some(call => /\/capture(?:\b|[/?])/.test(call.url)), false);
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

test("authorization-release runner fails closed when explicit opt-in flag is absent", () => {
  const result = execute();
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_release.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("authorization-release runner fails closed when TEST credential SecretRef material is absent", () => {
  const result = execute({ [ENABLE_FLAG]: "true" });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_release.failed");
  assert.equal(error.code, "SECRET_RESOLUTION_FAILED");
});

test("authorization-release runner rejects LIVE credential material before provider execution", () => {
  const result = execute({ [ENABLE_FLAG]: "true", [SECRET_ENV_KEY]: LIVE_KEY });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_release.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("D4-B source boundary releases only the fixed D4-A authorization and cannot create, confirm, capture or refund", () => {
  const runnerSource = readFileSync(RUNNER, "utf8");

  assert.match(runnerSource, /pi_3U9w04P5zjpreN161pyxan3o/);
  assert.match(runnerSource, /rbl10-stripe-test-authorization-release-proof-v1/);
  assert.match(runnerSource, /00000000-0000-4000-8000-000000001031/);
  assert.match(runnerSource, /requires_capture/);
  assert.match(runnerSource, /GUARANTEE_SATISFIED/);
  assert.match(runnerSource, /\.releaseAuthorization\s*\(/);
  assert.match(runnerSource, /stripeStatus !== "canceled"/);
  assert.match(runnerSource, /released\.status !== "RELEASED"/);
  assert.match(runnerSource, /after\.status !== "CANCELLED"/);
  assert.match(runnerSource, /releaseExecuted(?:ByRunner)?: true/);
  assert.match(runnerSource, /captureExecuted(?:ByRunner)?: false/);
  assert.match(runnerSource, /refundExecuted(?:ByRunner)?: false/);
  assert.match(runnerSource, /realMoneyMovement: false/);

  assert.doesNotMatch(runnerSource, /\.createAuthorizationHold\s*\(/);
  assert.doesNotMatch(runnerSource, /confirmStripeTestAuthorizationForProof\s*\(/);
  assert.doesNotMatch(runnerSource, /\.captureAuthorization\s*\(/);
  assert.doesNotMatch(runnerSource, /\.refundPayment\s*\(/);
  assert.doesNotMatch(runnerSource, /process\.env\[[^\]]*(?:PROVIDER|PAYMENT).*REFERENCE/i);
  assert.doesNotMatch(runnerSource, /\b(?:card_number|pan|cvv|cvc)\b/i);
});
