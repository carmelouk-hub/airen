import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNNER = resolve(process.cwd(), "deploy/prove-stripe-airenpay-test-payment-intent.ts");
const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_PAYMENT_INTENT_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";

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

test("PaymentIntent proof runner fails closed when explicit opt-in flag is absent", () => {
  const result = execute();
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.payment_intent.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("PaymentIntent proof runner fails closed when TEST credential SecretRef material is absent", () => {
  const result = execute({ [ENABLE_FLAG]: "true" });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.payment_intent.failed");
  assert.equal(error.code, "SECRET_RESOLUTION_FAILED");
});

test("PaymentIntent proof runner rejects LIVE credential material before provider execution", () => {
  const liveFixture = ["sk", "live", "rbl08", "fixture"].join("_");
  const result = execute({ [ENABLE_FLAG]: "true", [SECRET_ENV_KEY]: liveFixture });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), "");
  const error = lastJsonLine(result.stderr);
  assert.equal(error.event, "airenpay.stripe.test.payment_intent.failed");
  assert.equal(error.code, "PERMISSION_DENIED");
});

test("PaymentIntent proof runner source contains no confirm/capture/refund execution path", () => {
  const source = readFileSync(RUNNER, "utf8");
  assert.match(source, /createDepositPayment/);
  assert.match(source, /confirmRequestedByRunner: false/);
  assert.match(source, /captureRequestedByRunner: false/);
  assert.match(source, /realMoneyMovement: false/);
  assert.doesNotMatch(source, /\.captureAuthorization\s*\(/);
  assert.doesNotMatch(source, /\.releaseAuthorization\s*\(/);
  assert.doesNotMatch(source, /\.refundPayment\s*\(/);
  assert.doesNotMatch(source, /\.createAuthorizationHold\s*\(/);
  assert.doesNotMatch(source, /payment_method\s*[:=]/);
  assert.doesNotMatch(source, /confirm\s*[:=]\s*true/);
});
