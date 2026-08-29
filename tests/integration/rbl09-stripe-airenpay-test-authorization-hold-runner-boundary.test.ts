import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AppError, type SecretRef } from "../../packages/shared-contracts/src/index.ts";
import type { TenantPaymentGatewayConnectionProjectionV1 } from "../../packages/ristoairen/src/airenpay/index.ts";
import type { SecretMaterial, SecretProvider } from "../../packages/integrations/src/index.ts";
import {
  confirmStripeTestAuthorizationForProof,
  type StripeAuthorizationProofFetch
} from "../../deploy/stripe-airenpay-test-authorization-proof-client.ts";

const RUNNER = resolve(process.cwd(), "deploy/prove-stripe-airenpay-test-authorization-hold.ts");
const PROOF_CLIENT = resolve(process.cwd(), "deploy/stripe-airenpay-test-authorization-proof-client.ts");
const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_AUTHORIZATION_HOLD_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const TEST_KEY = ["rk", "test", "rbl09", "fixture"].join("_");
const LIVE_KEY = ["sk", "live", "rbl09", "fixture"].join("_");
const TEST_RETURN_URL = "https://example.com/airenpay-stripe-test-authorization-proof-return";

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
    id: "00000000-0000-4000-8000-000000000910",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_fixture",
    capabilities: ["AUTHORIZATION_HOLD", "TRANSACTION_STATUS"],
    mode: "TEST",
    credentialSecretRef: { provider: "fixture", key: "credential" },
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

function confirmInput(fetchImpl: StripeAuthorizationProofFetch, credential = TEST_KEY) {
  return {
    connection: connection(),
    providerReference: "pi_rbl09",
    paymentMethodFixture: "pm_card_visa" as const,
    idempotencyKey: "rbl09-proof-confirm",
    secretProvider: new FixtureSecretProvider(credential),
    fetchImpl,
    apiBaseUrl: "https://api.stripe.test/v1"
  };
}

test("authorization proof confirmation uses fixed TEST fixture, fixed return URL and idempotent confirm endpoint", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeAuthorizationProofFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({
      id: "pi_rbl09",
      status: "requires_capture",
      livemode: false,
      amount: 100,
      currency: "eur",
      amount_capturable: 100
    });
  };

  const result = await confirmStripeTestAuthorizationForProof(confirmInput(fetchImpl));
  assert.deepEqual(result, {
    id: "pi_rbl09",
    status: "requires_capture",
    livemode: false,
    amount: 100,
    currency: "eur",
    amountCapturable: 100
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.stripe.test/v1/payment_intents/pi_rbl09/confirm");
  assert.equal(calls[0].init?.method, "POST");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TEST_KEY}`);
  assert.equal(headers.get("idempotency-key"), "rbl09-proof-confirm");
  const body = new URLSearchParams(String(calls[0].init?.body));
  assert.deepEqual(Array.from(body.entries()), [
    ["payment_method", "pm_card_visa"],
    ["return_url", TEST_RETURN_URL]
  ]);
});

test("authorization proof rejects any payment-method fixture other than pm_card_visa before fetch", async () => {
  let calls = 0;
  const fetchImpl: StripeAuthorizationProofFetch = async () => { calls += 1; return jsonResponse({}); };
  await expectCode(() => confirmStripeTestAuthorizationForProof({
    ...confirmInput(fetchImpl),
    paymentMethodFixture: "pm_card_mastercard" as never
  }), "PERMISSION_DENIED");
  assert.equal(calls, 0);
});

test("authorization proof rejects LIVE credential material before fetch", async () => {
  let calls = 0;
  const fetchImpl: StripeAuthorizationProofFetch = async () => { calls += 1; return jsonResponse({}); };
  await expectCode(() => confirmStripeTestAuthorizationForProof(confirmInput(fetchImpl, LIVE_KEY)), "PERMISSION_DENIED");
  assert.equal(calls, 0);
});

test("authorization proof rejects LIVE provider object and non-capturable result", async () => {
  const liveFetch: StripeAuthorizationProofFetch = async () => jsonResponse({
    id: "pi_rbl09", status: "requires_capture", livemode: true, amount: 100, currency: "eur", amount_capturable: 100
  });
  await expectCode(() => confirmStripeTestAuthorizationForProof(confirmInput(liveFetch)), "PERMISSION_DENIED");

  const zeroFetch: StripeAuthorizationProofFetch = async () => jsonResponse({
    id: "pi_rbl09", status: "requires_capture", livemode: false, amount: 100, currency: "eur", amount_capturable: 0
  });
  await expectCode(() => confirmStripeTestAuthorizationForProof(confirmInput(zeroFetch)), "CONFLICT");
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

test("authorization-hold runner fails closed when explicit opt-in flag is absent", () => {
  const result = execute();
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_hold.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("authorization-hold runner fails closed when TEST credential SecretRef material is absent", () => {
  const result = execute({ [ENABLE_FLAG]: "true" });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_hold.failed");
  assert.equal(error.code, "SECRET_RESOLUTION_FAILED");
});

test("authorization-hold runner rejects LIVE credential material before provider execution", () => {
  const result = execute({ [ENABLE_FLAG]: "true", [SECRET_ENV_KEY]: LIVE_KEY });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.authorization_hold.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("D4-A source boundary creates and confirms TEST authorization but cannot capture/release/refund", () => {
  const runnerSource = readFileSync(RUNNER, "utf8");
  const proofClientSource = readFileSync(PROOF_CLIENT, "utf8");

  assert.match(runnerSource, /\.createAuthorizationHold\s*\(/);
  assert.match(runnerSource, /confirmStripeTestAuthorizationForProof\s*\(/);
  assert.match(runnerSource, /pm_card_visa/);
  assert.match(runnerSource, /requires_capture/);
  assert.match(runnerSource, /amountCapturable/);
  assert.match(runnerSource, /captureExecuted(?:ByRunner)?: false/);
  assert.match(runnerSource, /releaseExecuted(?:ByRunner)?: false/);
  assert.match(runnerSource, /refundExecuted(?:ByRunner)?: false/);
  assert.match(runnerSource, /realMoneyMovement: false/);
  assert.doesNotMatch(runnerSource, /\.captureAuthorization\s*\(/);
  assert.doesNotMatch(runnerSource, /\.releaseAuthorization\s*\(/);
  assert.doesNotMatch(runnerSource, /\.refundPayment\s*\(/);
  assert.doesNotMatch(runnerSource, /\b(?:card_number|pan|cvv|cvc)\b/i);

  assert.match(proofClientSource, /payment_method: input\.paymentMethodFixture/);
  assert.match(proofClientSource, /return_url: TEST_RETURN_URL/);
  assert.match(proofClientSource, /const TEST_RETURN_URL = "https:\/\/example\.com\/airenpay-stripe-test-authorization-proof-return"/);
  assert.doesNotMatch(proofClientSource, /input\.(?:returnUrl|return_url)/);
  assert.match(proofClientSource, /payment_intents\/\$\{encodeURIComponent\(input\.providerReference\)\}\/confirm/);
  assert.match(proofClientSource, /input\.paymentMethodFixture !== "pm_card_visa"/);
  assert.doesNotMatch(proofClientSource, /\/capture(?:\b|[/?])/);
  assert.doesNotMatch(proofClientSource, /\/refunds(?:\b|[/?])/);
});
