import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError, type SecretRef } from "../../packages/shared-contracts/src/index.ts";
import type { TenantPaymentGatewayConnectionProjectionV1 } from "../../packages/ristoairen/src/airenpay/index.ts";
import type { SecretMaterial, SecretProvider } from "../../packages/integrations/src/index.ts";
import {
  StripeAirenPayTestHttpClientFactory,
  type StripeAirenPayFetch
} from "../../packages/integrations/src/stripe-airenpay-test-http-client.ts";

const RUNNER = resolve(process.cwd(), "deploy/prove-stripe-airenpay-test-refund-readback-recovery.ts");
const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_REFUND_READBACK_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const PAYMENT_INTENT = "pi_rbl13_readback_fixture";
const CHARGE = "ch_rbl13_readback_fixture";
const REFUND = "re_rbl13_readback_fixture";
const TEST_KEY = ["rk", "test", "rbl13", "fixture"].join("_");
const LIVE_KEY = ["sk", "live", "rbl13", "fixture"].join("_");

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

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000001310",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_fixture",
    capabilities: ["TRANSACTION_STATUS"],
    mode: "TEST",
    credentialSecretRef: { provider: "fixture", key: "credential" },
    status: "ACTIVE",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    rowVersion: 1
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("RBL13 reads the existing Stripe TEST PaymentIntent and Refund using GET only", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeAirenPayFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const url = String(input);
    if (init?.method === "GET" && url.endsWith(`/payment_intents/${PAYMENT_INTENT}`)) {
      return jsonResponse({
        id: PAYMENT_INTENT,
        status: "succeeded",
        livemode: false,
        amount: 100,
        currency: "eur",
        amount_capturable: 0
      });
    }
    if (init?.method === "GET" && url.endsWith(`/refunds/${REFUND}`)) {
      return jsonResponse({
        id: REFUND,
        payment_intent: PAYMENT_INTENT,
        charge: CHARGE,
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
  const activeConnection = connection();
  const client = await factory.forConnection(activeConnection);
  const payment = await client.retrievePaymentIntent(PAYMENT_INTENT);
  const refund = await factory.retrieveRefundForProof(activeConnection, REFUND);

  assert.equal(payment.id, PAYMENT_INTENT);
  assert.equal(payment.status, "succeeded");
  assert.equal(payment.livemode, false);
  assert.equal(payment.amount, 100);
  assert.equal(payment.currency, "eur");
  assert.equal(refund.id, REFUND);
  assert.equal(refund.paymentIntentId, PAYMENT_INTENT);
  assert.equal(refund.chargeId, CHARGE);
  assert.equal(refund.status, "succeeded");
  assert.equal(refund.amount, 100);
  assert.equal(refund.currency, "eur");
  assert.equal(refund.livemode, false);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[1].init?.method, "GET");
  assert.equal(calls.some(call => call.init?.method === "POST"), false);
  assert.equal(calls[0].url, `https://api.stripe.test/v1/payment_intents/${PAYMENT_INTENT}`);
  assert.equal(calls[1].url, `https://api.stripe.test/v1/refunds/${REFUND}`);
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

test("RBL13 recovery runner fails closed when explicit opt-in is absent", () => {
  const result = execute();
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.refund.readback.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("RBL13 recovery runner fails closed when SecretRef material is absent", () => {
  const result = execute({ [ENABLE_FLAG]: "true" });
  assert.equal(result.status, 1);
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.refund.readback.failed");
  assert.equal(error.code, "SECRET_RESOLUTION_FAILED");
});

test("RBL13 recovery runner rejects LIVE credential material before provider I/O", () => {
  const result = execute({ [ENABLE_FLAG]: "true", [SECRET_ENV_KEY]: LIVE_KEY });
  assert.equal(result.status, 1);
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.refund.readback.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("RBL13 source boundary is exact-ref and read-only with no refund mutation path", () => {
  const source = readFileSync(RUNNER, "utf8");
  assert.match(source, /AIRENPAY_STRIPE_TEST_REFUND_READBACK_PROOF_ENABLED/);
  assert.match(source, /acct_1U9k1nP5zjpreN16/);
  assert.match(source, /pi_3UA5bpP5zjpreN160czIgndr/);
  assert.match(source, /ch_3UA5bpP5zjpreN160c7cip0Y/);
  assert.match(source, /re_3UA5bpP5zjpreN160ZI14ePG/);
  assert.match(source, /retrievePaymentIntent\(D4C_PAYMENT_INTENT\)/);
  assert.match(source, /retrieveRefundForProof\(activeConnection, D4D_REFUND\)/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /httpMutation: false/);
  assert.match(source, /refundCreatedByRunner: false/);
  assert.match(source, /postRefundEndpointUsed: false/);
  assert.match(source, /independentProviderReadbackStillRequired: true/);
  assert.match(source, /gateClosureEligible: false/);
  assert.doesNotMatch(source, /\.createRefund\s*\(/);
  assert.doesNotMatch(source, /\.refundPayment\s*\(/);
  assert.doesNotMatch(source, /"POST"/);
  assert.doesNotMatch(source, /createAuthorizationHold|captureAuthorization|releaseAuthorization/);
});
