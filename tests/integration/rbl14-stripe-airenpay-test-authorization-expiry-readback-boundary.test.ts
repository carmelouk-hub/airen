import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppError, type SecretRef } from "../../packages/shared-contracts/src/index.ts";
import {
  assertAirenPayAuthorizationWindowCompatible,
  type TenantPaymentGatewayConnectionProjectionV1
} from "../../packages/airenpay/src/index.ts";
import type { SecretMaterial, SecretProvider } from "../../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import {
  StripeAirenPayTestHttpClientFactory,
  type StripeAirenPayFetch
} from "../../packages/integrations/src/stripe-airenpay-test-http-client.ts";

const TEST_KEY = ["rk", "test", "rbl14", "fixture"].join("_");
const CAPTURE_BEFORE = 1_788_689_106;
const EXPECTED_EXPIRY = "2026-09-06T10:05:06.000Z";

class FixtureSecretMaterial implements SecretMaterial {
  private readonly value: string;
  constructor(value: string) { this.value = value; }
  use<T>(consumer: (value: string) => T): T { return consumer(this.value); }
  toString(): string { return "[REDACTED_SECRET]"; }
  toJSON(): string { return "[REDACTED_SECRET]"; }
}

class FixtureSecretProvider implements SecretProvider {
  readonly providerKey = "fixture";
  async resolve(ref: SecretRef): Promise<SecretMaterial> {
    if (ref.provider !== this.providerKey || ref.key !== "credential") {
      throw new AppError("SECRET_RESOLUTION_FAILED", "fixture secret unavailable");
    }
    return new FixtureSecretMaterial(TEST_KEY);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000001410",
    tenantId: "00000000-0000-4000-8000-000000001402",
    locationId: "00000000-0000-4000-8000-000000001403",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_rbl14",
    capabilities: ["TRANSACTION_STATUS"],
    mode: "TEST",
    credentialSecretRef: Object.freeze({ provider: "fixture", key: "credential" }),
    status: "ACTIVE",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    rowVersion: 1
  });
}

function paymentIntentFixture(captureBefore: unknown = CAPTURE_BEFORE) {
  return Object.freeze({
    id: "pi_rbl14",
    status: "requires_capture",
    amount: 100,
    currency: "eur",
    amount_capturable: 100,
    livemode: false,
    latest_charge: Object.freeze({
      id: "ch_rbl14",
      payment_method_details: Object.freeze({
        type: "card",
        card: Object.freeze({ capture_before: captureBefore })
      })
    })
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function expectCode(action: () => Promise<unknown> | unknown, code: AppError["code"], message?: string): Promise<AppError> {
  try {
    await action();
    assert.fail(`expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    if (message) assert.equal(error.message, message);
    return error;
  }
}

function factory(fetchImpl: StripeAirenPayFetch) {
  return new StripeAirenPayTestHttpClientFactory({
    secretProvider: new FixtureSecretProvider(),
    fetchImpl,
    apiBaseUrl: "https://api.stripe.test/v1"
  });
}

test("RBL14-D01 expiry-aware PaymentIntent retrieval expands latest_charge and maps capture_before", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: StripeAirenPayFetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse(paymentIntentFixture());
  };
  const client = await factory(fetchImpl).forConnection(connection());
  assert.ok(client.retrievePaymentIntentWithAuthorizationExpiry);
  const result = await client.retrievePaymentIntentWithAuthorizationExpiry("pi_rbl14");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[0].url, "https://api.stripe.test/v1/payment_intents/pi_rbl14?expand%5B%5D=latest_charge");
  assert.equal(result.authorizationExpiresAt, EXPECTED_EXPIRY);
  assert.equal(result.livemode, false);
});

test("RBL14-D02 dedicated AIRenPay expiry status path propagates provider authorization expiry", async () => {
  const calls: string[] = [];
  const fetchImpl: StripeAirenPayFetch = async input => {
    calls.push(String(input));
    return jsonResponse(paymentIntentFixture());
  };
  const adapter = new StripeAirenPayTestAdapter(factory(fetchImpl));
  const result = await adapter.getTransactionStatusWithAuthorizationExpiry(Object.freeze({
    orchestrationId: "00000000-0000-4000-8000-000000001411",
    correlationId: "rbl14-expiry-propagation",
    idempotencyKey: "rbl14-expiry-propagation",
    connection: connection()
  }), "pi_rbl14");

  assert.equal(calls[0], "https://api.stripe.test/v1/payment_intents/pi_rbl14?expand%5B%5D=latest_charge");
  assert.equal(result.providerReference, "pi_rbl14");
  assert.equal(result.authorizationExpiresAt, EXPECTED_EXPIRY);
  assert.deepEqual(result.amount, { amountMinor: 100, currency: "EUR" });
});

test("RBL14-D03 authorization-window policy accepts service before expiry and fails closed at or after expiry", async () => {
  const accepted = assertAirenPayAuthorizationWindowCompatible(EXPECTED_EXPIRY, "2026-09-06T09:00:00.000Z");
  assert.equal(accepted.compatible, true);
  assert.equal(accepted.authorizationExpiresAt, EXPECTED_EXPIRY);

  await expectCode(
    () => assertAirenPayAuthorizationWindowCompatible(EXPECTED_EXPIRY, EXPECTED_EXPIRY),
    "CONFLICT",
    "AUTHORIZATION_EXPIRES_BEFORE_SERVICE"
  );
  await expectCode(
    () => assertAirenPayAuthorizationWindowCompatible(EXPECTED_EXPIRY, "2026-09-06T11:00:00.000Z"),
    "CONFLICT",
    "AUTHORIZATION_EXPIRES_BEFORE_SERVICE"
  );
  await expectCode(
    () => assertAirenPayAuthorizationWindowCompatible(undefined, "2026-09-06T09:00:00.000Z"),
    "CONFLICT",
    "AUTHORIZATION_EXPIRY_UNAVAILABLE"
  );
});

test("RBL14-D04 malformed provider capture_before fails closed on expiry-aware retrieval", async () => {
  const fetchImpl: StripeAirenPayFetch = async () => jsonResponse(paymentIntentFixture("not-an-integer"));
  const client = await factory(fetchImpl).forConnection(connection());
  assert.ok(client.retrievePaymentIntentWithAuthorizationExpiry);
  await expectCode(() => client.retrievePaymentIntentWithAuthorizationExpiry!("pi_rbl14"), "INTERNAL_ERROR");
});

test("RBL14-D05 governed expiry runner is explicit-opt-in and contains no Stripe mutation path", async () => {
  const url = new URL("../../deploy/prove-stripe-airenpay-test-authorization-expiry-readback.ts", import.meta.url);
  const source = await readFile(url, "utf8");

  assert.match(source, /AIRENPAY_STRIPE_TEST_AUTHORIZATION_EXPIRY_PROOF_ENABLED/);
  assert.match(source, /pi_3UA5bpP5zjpreN160czIgndr/);
  assert.match(source, /getTransactionStatusWithAuthorizationExpiry\(/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /httpMutation: false/);
  assert.match(source, /postEndpointUsed: false/);
  assert.doesNotMatch(source, /createPaymentIntent\(/);
  assert.doesNotMatch(source, /createAuthorizationHold\(/);
  assert.doesNotMatch(source, /captureAuthorization\(/);
  assert.doesNotMatch(source, /releaseAuthorization\(/);
  assert.doesNotMatch(source, /refundPayment\(/);
  assert.doesNotMatch(source, /createRefund\(/);
});
