import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../../packages/airenpay/src/index.ts";
import {
  StripeAirenPayTestAdapter,
  type StripeAirenPayTestClientFactory,
  type StripeAirenPayTestClientPort,
  type StripePaymentIntentProjection,
  type StripeRefundProjection,
  type StripeRequestOptions,
  type StripeSetupIntentProjection,
  type StripeVerifiedWebhookProjection
} from "../../packages/integrations/src/stripe-airenpay-test-adapter.ts";

function connection(overrides: Partial<TenantPaymentGatewayConnectionProjectionV1> = {}): TenantPaymentGatewayConnectionProjectionV1 {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000510",
    tenantId: "00000000-0000-4000-8000-000000000502",
    locationId: "00000000-0000-4000-8000-000000000503",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_reference",
    capabilities: [
      "PAYMENT_METHOD_SETUP",
      "DEPOSIT_PAYMENT",
      "FULL_PREPAYMENT",
      "AUTHORIZATION_HOLD",
      "CAPTURE_AUTHORIZATION",
      "RELEASE_AUTHORIZATION",
      "REFUND_PAYMENT",
      "TRANSACTION_STATUS",
      "WEBHOOK_VERIFICATION"
    ],
    mode: "TEST",
    credentialSecretRef: Object.freeze({ provider: "env", key: "AIRENPAY_STRIPE_TEST_CREDENTIAL" }),
    webhookSecretRef: Object.freeze({ provider: "env", key: "AIRENPAY_STRIPE_TEST_WEBHOOK" }),
    status: "ACTIVE",
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
    rowVersion: 1,
    ...overrides
  });
}

function operationContext(overrides: Partial<AirenPayGatewayOperationContextV1> = {}): AirenPayGatewayOperationContextV1 {
  return Object.freeze({
    orchestrationId: "00000000-0000-4000-8000-000000000520",
    correlationId: "rbl05-correlation",
    idempotencyKey: "rbl05-idempotency",
    connection: connection(),
    ...overrides
  });
}

type Call = Readonly<{ method: string; params?: unknown; options?: StripeRequestOptions; reference?: string; signature?: string; rawBody?: Uint8Array }>;

class FakeStripeClient implements StripeAirenPayTestClientPort {
  readonly calls: Call[] = [];
  setupIntent: StripeSetupIntentProjection = Object.freeze({
    id: "seti_test_1",
    status: "requires_payment_method",
    clientSecret: "seti_client_action_token",
    livemode: false
  });
  paymentIntent: StripePaymentIntentProjection = Object.freeze({
    id: "pi_test_1",
    status: "requires_payment_method",
    clientSecret: "pi_client_action_token",
    amount: 2500,
    currency: "eur",
    livemode: false
  });
  refund: StripeRefundProjection = Object.freeze({
    id: "re_test_1",
    status: "succeeded",
    paymentIntentId: "pi_test_1",
    amount: 2500,
    currency: "eur",
    livemode: false
  });
  webhook: StripeVerifiedWebhookProjection = Object.freeze({
    id: "evt_test_1",
    type: "payment_intent.succeeded",
    providerReference: "pi_test_1",
    created: 1787994000,
    livemode: false,
    amount: 2500,
    currency: "eur"
  });

  async createSetupIntent(params: Parameters<StripeAirenPayTestClientPort["createSetupIntent"]>[0], options: StripeRequestOptions) {
    this.calls.push({ method: "createSetupIntent", params, options });
    return this.setupIntent;
  }
  async createPaymentIntent(params: Parameters<StripeAirenPayTestClientPort["createPaymentIntent"]>[0], options: StripeRequestOptions) {
    this.calls.push({ method: "createPaymentIntent", params, options });
    return this.paymentIntent;
  }
  async capturePaymentIntent(reference: string, params: Parameters<StripeAirenPayTestClientPort["capturePaymentIntent"]>[1], options: StripeRequestOptions) {
    this.calls.push({ method: "capturePaymentIntent", reference, params, options });
    return Object.freeze({ ...this.paymentIntent, id: reference, status: "succeeded" as const });
  }
  async cancelPaymentIntent(reference: string, options: StripeRequestOptions) {
    this.calls.push({ method: "cancelPaymentIntent", reference, options });
    return Object.freeze({ ...this.paymentIntent, id: reference, status: "canceled" as const });
  }
  async createRefund(params: Parameters<StripeAirenPayTestClientPort["createRefund"]>[0], options: StripeRequestOptions) {
    this.calls.push({ method: "createRefund", params, options });
    return this.refund;
  }
  async retrieveSetupIntent(reference: string) {
    this.calls.push({ method: "retrieveSetupIntent", reference });
    return Object.freeze({ ...this.setupIntent, id: reference });
  }
  async retrievePaymentIntent(reference: string) {
    this.calls.push({ method: "retrievePaymentIntent", reference });
    return Object.freeze({ ...this.paymentIntent, id: reference });
  }
  async verifyWebhook(rawBody: Uint8Array, signature: string) {
    this.calls.push({ method: "verifyWebhook", rawBody, signature });
    return this.webhook;
  }
}

class FakeFactory implements StripeAirenPayTestClientFactory {
  readonly client = new FakeStripeClient();
  readonly connections: TenantPaymentGatewayConnectionProjectionV1[] = [];
  async forConnection(value: TenantPaymentGatewayConnectionProjectionV1) {
    this.connections.push(value);
    return this.client;
  }
}

function adapter() {
  const factory = new FakeFactory();
  return { adapter: new StripeAirenPayTestAdapter(factory), factory };
}

test("RBL05-D01 SetupIntent mapping is TEST-only, off-session and idempotent", async () => {
  const subject = adapter();
  const result = await subject.adapter.createPaymentMethodSetup(operationContext());
  assert.equal(result.providerReference, "seti_test_1");
  assert.equal(result.status, "CUSTOMER_ACTION_REQUIRED");
  assert.equal(result.clientAction?.kind, "CLIENT_CONFIRMATION");
  const call = subject.factory.client.calls[0];
  assert.equal(call.method, "createSetupIntent");
  assert.deepEqual(call.params, {
    usage: "off_session",
    automaticPaymentMethods: { enabled: true },
    metadata: {
      airen_orchestration_id: operationContext().orchestrationId,
      airen_correlation_id: operationContext().correlationId
    }
  });
  assert.equal(call.options?.idempotencyKey, "rbl05-idempotency:stripe:setup");
});

test("RBL05-D02 deposit and prepayment use automatic capture with minor-unit money", async () => {
  const subject = adapter();
  await subject.adapter.createDepositPayment(operationContext(), { amountMinor: 2500, currency: "EUR" });
  await subject.adapter.createFullPrepayment(operationContext({ idempotencyKey: "rbl05-prepay" }), { amountMinor: 9900, currency: "USD" });
  const [deposit, prepay] = subject.factory.client.calls;
  assert.deepEqual(deposit.params, {
    amount: 2500,
    currency: "eur",
    captureMethod: "automatic",
    automaticPaymentMethods: { enabled: true },
    metadata: {
      airen_orchestration_id: operationContext().orchestrationId,
      airen_correlation_id: operationContext().correlationId
    }
  });
  assert.equal(deposit.options?.idempotencyKey, "rbl05-idempotency:stripe:deposit");
  assert.equal((prepay.params as any).captureMethod, "automatic");
  assert.equal(prepay.options?.idempotencyKey, "rbl05-prepay:stripe:full-prepayment");
});

test("RBL05-D03 authorization hold maps to PaymentIntent manual capture", async () => {
  const subject = adapter();
  await subject.adapter.createAuthorizationHold(operationContext(), { amountMinor: 5000, currency: "EUR" });
  const call = subject.factory.client.calls[0];
  assert.equal((call.params as any).captureMethod, "manual");
  assert.equal(call.options?.idempotencyKey, "rbl05-idempotency:stripe:authorization-hold");
});

test("RBL05-D04 capture, release and refund remain explicit separate commands", async () => {
  const subject = adapter();
  const capture = await subject.adapter.captureAuthorization(operationContext(), "pi_test_auth", { amountMinor: 1200, currency: "EUR" });
  const release = await subject.adapter.releaseAuthorization(operationContext({ idempotencyKey: "release-idem" }), "pi_test_release");
  const refund = await subject.adapter.refundPayment(operationContext({ idempotencyKey: "refund-idem" }), "pi_test_1", { amountMinor: 500, currency: "EUR" });
  assert.equal(capture.status, "CAPTURED");
  assert.equal(release.status, "RELEASED");
  assert.equal(refund.status, "REFUNDED");
  assert.equal(subject.factory.client.calls[0].options?.idempotencyKey, "rbl05-idempotency:stripe:capture");
  assert.equal(subject.factory.client.calls[1].options?.idempotencyKey, "release-idem:stripe:release");
  assert.equal(subject.factory.client.calls[2].options?.idempotencyKey, "refund-idem:stripe:refund");
});

test("RBL05-D05 LIVE connection and LIVE provider objects fail closed", async () => {
  const liveConnection = connection({ mode: "LIVE" });
  const subject = adapter();
  await assert.rejects(
    () => subject.adapter.createPaymentMethodSetup(operationContext({ connection: liveConnection })),
    (error: any) => error instanceof AppError && error.code === "PERMISSION_DENIED"
  );
  subject.factory.client.setupIntent = Object.freeze({ id: "seti_live", status: "succeeded", livemode: true });
  await assert.rejects(
    () => subject.adapter.createPaymentMethodSetup(operationContext()),
    (error: any) => error instanceof AppError && error.code === "PERMISSION_DENIED"
  );
});

test("RBL05-D06 provider type cannot be spoofed into Stripe adapter", async () => {
  const subject = adapter();
  await assert.rejects(
    () => subject.adapter.createDepositPayment(operationContext({ connection: connection({ providerType: "ADYEN" }) }), { amountMinor: 1000, currency: "EUR" }),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
});

test("RBL05-D07 webhook verification receives exact raw bytes and normalizes verified event", async () => {
  const subject = adapter();
  const rawBody = new Uint8Array([123, 34, 105, 100, 34, 58, 49, 125]);
  const result = await subject.adapter.verifyAndNormalizeWebhook({
    connectionId: connection().id,
    rawBody,
    headers: { "stripe-signature": "t=1787994000,v1=opaque-test-signature" },
    receivedAt: "2026-08-29T12:50:00.000Z"
  }, connection());
  assert.equal(result.providerEventId, "evt_test_1");
  assert.equal(result.eventType, "PAYMENT_SUCCEEDED");
  assert.equal(result.status, "GUARANTEE_SATISFIED");
  assert.deepEqual(result.amount, { amountMinor: 2500, currency: "EUR" });
  const call = subject.factory.client.calls[0];
  assert.strictEqual(call.rawBody, rawBody);
  assert.equal(call.signature, "t=1787994000,v1=opaque-test-signature");
});

test("RBL05-D08 transaction status distinguishes SetupIntent and PaymentIntent references", async () => {
  const subject = adapter();
  const setup = await subject.adapter.getTransactionStatus(operationContext(), "seti_test_status");
  const payment = await subject.adapter.getTransactionStatus(operationContext(), "pi_test_status");
  assert.equal(setup.providerReference, "seti_test_status");
  assert.equal(payment.providerReference, "pi_test_status");
  assert.deepEqual(payment.amount, { amountMinor: 2500, currency: "EUR" });
  assert.deepEqual(subject.factory.client.calls.map((entry) => entry.method), ["retrieveSetupIntent", "retrievePaymentIntent"]);
});
