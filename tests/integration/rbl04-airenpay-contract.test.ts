import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  AIRENPAY_CAPABILITY_BY_GUARANTEE_MODE,
  type PaymentGatewayPort,
  assertGateCTestPaymentConnection,
  requiredAirenPayCapability,
  selectTenantPaymentGatewayConnection,
  validateAirenPayGatewayOperationContext,
  validateAirenPayGuaranteeRequest,
  validateAirenPayNormalizedWebhookEvent,
  validateAirenPayOrchestrationTransition,
  validateAirenPayWebhookRequest,
  validateTenantPaymentGatewayConnection,
  type TenantPaymentGatewayConnectionProjectionV1
} from "../../packages/ristoairen/src/airenpay/index.ts";

function context(overrides: Partial<SecurityContext> = {}): SecurityContext {
  return Object.freeze({
    correlationId: "rbl04-correlation",
    actorIdentityId: "00000000-0000-4000-8000-000000000401",
    platformRoles: [],
    platformPermissions: [],
    tenantId: "00000000-0000-4000-8000-000000000402",
    locationId: "00000000-0000-4000-8000-000000000403",
    tenantMembershipId: "00000000-0000-4000-8000-000000000404",
    locationMembershipId: "00000000-0000-4000-8000-000000000405",
    tenantRole: "manager",
    locationRole: "manager",
    permissions: ["booking.read", "booking.create", "booking.update", "booking.status.update"],
    entitlements: ["rbl01c2.booking.external"],
    ...overrides
  });
}

function connection(overrides: Partial<TenantPaymentGatewayConnectionProjectionV1> = {}): TenantPaymentGatewayConnectionProjectionV1 {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000410",
    tenantId: "00000000-0000-4000-8000-000000000402",
    providerType: "STRIPE",
    providerAccountReference: "acct_test_reference",
    capabilities: ["PAYMENT_METHOD_SETUP", "DEPOSIT_PAYMENT", "FULL_PREPAYMENT", "AUTHORIZATION_HOLD", "TRANSACTION_STATUS", "WEBHOOK_VERIFICATION"],
    mode: "TEST",
    credentialSecretRef: Object.freeze({ provider: "env", key: "AIRENPAY_STRIPE_TEST_CREDENTIAL" }),
    webhookSecretRef: Object.freeze({ provider: "env", key: "AIRENPAY_STRIPE_TEST_WEBHOOK" }),
    status: "ACTIVE",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    rowVersion: 1,
    ...overrides
  });
}

test("RBL04-C01 guarantee modes map to provider-neutral capabilities", () => {
  assert.deepEqual(AIRENPAY_CAPABILITY_BY_GUARANTEE_MODE, {
    PAYMENT_METHOD_GUARANTEE: "PAYMENT_METHOD_SETUP",
    DEPOSIT: "DEPOSIT_PAYMENT",
    FULL_PREPAYMENT: "FULL_PREPAYMENT",
    AUTHORIZATION_HOLD: "AUTHORIZATION_HOLD"
  });
  assert.equal(requiredAirenPayCapability("DEPOSIT"), "DEPOSIT_PAYMENT");
  assert.throws(() => requiredAirenPayCapability("NONE"), (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED");
});

test("RBL04-C02 payment-method guarantee carries no amount", () => {
  const validated = validateAirenPayGuaranteeRequest({
    bookingHoldId: "00000000-0000-4000-8000-000000000420",
    guaranteeMode: "PAYMENT_METHOD_GUARANTEE"
  });
  assert.equal(validated.financialTerms, undefined);
  assert.throws(
    () => validateAirenPayGuaranteeRequest({
      bookingHoldId: "00000000-0000-4000-8000-000000000420",
      guaranteeMode: "PAYMENT_METHOD_GUARANTEE",
      financialTerms: { amountMinor: 1000, currency: "EUR" }
    }),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
});

test("RBL04-C03 monetary guarantee modes require positive minor units and currency", () => {
  assert.throws(
    () => validateAirenPayGuaranteeRequest({ bookingHoldId: "h", guaranteeMode: "DEPOSIT" } as any),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
  const validated = validateAirenPayGuaranteeRequest({
    bookingHoldId: "00000000-0000-4000-8000-000000000421",
    guaranteeMode: "AUTHORIZATION_HOLD",
    financialTerms: { amountMinor: 5000, currency: "EUR" }
  });
  assert.deepEqual(validated.financialTerms, { amountMinor: 5000, currency: "EUR" });
  assert.throws(
    () => validateAirenPayGuaranteeRequest({
      bookingHoldId: "00000000-0000-4000-8000-000000000421",
      guaranteeMode: "FULL_PREPAYMENT",
      financialTerms: { amountMinor: 0, currency: "eur" }
    }),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
});

test("RBL04-C04 AIRenPay never handles guarantee mode NONE", () => {
  assert.throws(
    () => validateAirenPayGuaranteeRequest({ bookingHoldId: "h", guaranteeMode: "NONE" } as any),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
});

test("RBL04-C05 plaintext gateway credentials are rejected", () => {
  assert.throws(
    () => validateTenantPaymentGatewayConnection({ ...connection(), apiKey: "sk_test_should_never_be_here" } as any),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
  const safe = validateTenantPaymentGatewayConnection(connection());
  assert.deepEqual(safe.credentialSecretRef, { provider: "env", key: "AIRENPAY_STRIPE_TEST_CREDENTIAL", version: undefined });
});

test("RBL04-C06 Gate C rejects LIVE payment gateway connections", () => {
  assert.throws(
    () => assertGateCTestPaymentConnection(connection({ mode: "LIVE" })),
    (error: any) => error instanceof AppError && error.code === "PERMISSION_DENIED"
  );
});

test("RBL04-C07 location-specific TEST connection wins over tenant fallback", () => {
  const global = connection({ id: "00000000-0000-4000-8000-000000000411" });
  const local = connection({ id: "00000000-0000-4000-8000-000000000412", locationId: context().locationId });
  const selected = selectTenantPaymentGatewayConnection([global, local], context(), "DEPOSIT");
  assert.equal(selected.id, local.id);
});

test("RBL04-C08 ambiguous eligible connections fail closed", () => {
  const a = connection({ id: "00000000-0000-4000-8000-000000000413", locationId: context().locationId });
  const b = connection({ id: "00000000-0000-4000-8000-000000000414", locationId: context().locationId });
  assert.throws(
    () => selectTenantPaymentGatewayConnection([a, b], context(), "DEPOSIT"),
    (error: any) => error instanceof AppError && error.code === "CONFLICT"
  );
});

test("RBL04-C09 cross-tenant gateway repository results fail closed", () => {
  const wrongTenant = connection({ tenantId: "00000000-0000-4000-8000-000000000499" });
  assert.throws(
    () => selectTenantPaymentGatewayConnection([wrongTenant], context(), "DEPOSIT"),
    (error: any) => error instanceof AppError && error.code === "TENANT_SCOPE_VIOLATION"
  );
});

test("RBL04-C10 orchestration state machine permits only governed transitions", () => {
  assert.doesNotThrow(() => validateAirenPayOrchestrationTransition("CREATED", "PROVIDER_PENDING"));
  assert.doesNotThrow(() => validateAirenPayOrchestrationTransition("GUARANTEE_SATISFIED", "REFUNDED"));
  assert.throws(
    () => validateAirenPayOrchestrationTransition("REFUNDED", "GUARANTEE_SATISFIED"),
    (error: any) => error instanceof AppError && error.code === "CONFLICT"
  );
});

test("RBL04-C11 webhook ingress requires bounded raw bytes", () => {
  const valid = validateAirenPayWebhookRequest({
    connectionId: connection().id,
    rawBody: new Uint8Array([1, 2, 3]),
    headers: { "provider-signature": "opaque" },
    receivedAt: "2026-08-29T01:00:00.000Z"
  });
  assert.equal(valid.rawBody.byteLength, 3);
  assert.throws(
    () => validateAirenPayWebhookRequest({ connectionId: connection().id, rawBody: new Uint8Array(), headers: {}, receivedAt: "2026-08-29T01:00:00.000Z" }),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
});

test("RBL04-C12 normalized provider events cannot assert scope or leak sensitive metadata", () => {
  const base = {
    providerEventId: "evt_test_1",
    providerReference: "pi_test_1",
    eventType: "PAYMENT_SUCCEEDED" as const,
    status: "GUARANTEE_SATISFIED" as const,
    occurredAt: "2026-08-29T01:00:00.000Z"
  };
  assert.equal(validateAirenPayNormalizedWebhookEvent(base).providerEventId, "evt_test_1");
  assert.throws(
    () => validateAirenPayNormalizedWebhookEvent({ ...base, tenant_id: context().tenantId } as any),
    (error: any) => error instanceof AppError && error.code === "TENANT_SCOPE_VIOLATION"
  );
  assert.throws(
    () => validateAirenPayNormalizedWebhookEvent({ ...base, providerMetadata: { client_secret: "forbidden" } }),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
});

test("RBL04-C13 webhook verification capability requires trusted verification material", () => {
  assert.throws(
    () => validateTenantPaymentGatewayConnection(connection({ webhookSecretRef: undefined, webhookConfigurationReference: undefined })),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
  const asymmetric = validateTenantPaymentGatewayConnection(connection({
    webhookSecretRef: undefined,
    webhookConfigurationReference: "provider-public-key-registry:rbl04"
  }));
  assert.equal(asymmetric.webhookConfigurationReference, "provider-public-key-registry:rbl04");
});

test("RBL04-C14 operation context is idempotent and TEST-only by construction", () => {
  const validated = validateAirenPayGatewayOperationContext({
    orchestrationId: "00000000-0000-4000-8000-000000000430",
    correlationId: "rbl04-correlation",
    idempotencyKey: "rbl04-idem-1",
    connection: connection()
  });
  assert.equal(validated.idempotencyKey, "rbl04-idem-1");
  assert.throws(
    () => validateAirenPayGatewayOperationContext({
      orchestrationId: "00000000-0000-4000-8000-000000000430",
      correlationId: "rbl04-correlation",
      idempotencyKey: "x".repeat(201),
      connection: connection()
    }),
    (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED"
  );
});

test("RBL04-C15 canonical gateway port contains the complete provider-neutral operation set", () => {
  const fake: PaymentGatewayPort = {
    async createPaymentMethodSetup() { return { providerReference: "setup", status: "PROVIDER_PENDING" }; },
    async createDepositPayment() { return { providerReference: "deposit", status: "PROVIDER_PENDING" }; },
    async createFullPrepayment() { return { providerReference: "prepay", status: "PROVIDER_PENDING" }; },
    async createAuthorizationHold() { return { providerReference: "auth", status: "PROVIDER_PENDING" }; },
    async captureAuthorization() { return { providerReference: "capture", status: "CAPTURED" }; },
    async releaseAuthorization() { return { providerReference: "release", status: "RELEASED" }; },
    async refundPayment() { return { providerReference: "refund", status: "REFUNDED" }; },
    async getTransactionStatus() { return { providerReference: "status", status: "PROVIDER_PENDING" }; },
    async verifyAndNormalizeWebhook() {
      return {
        providerEventId: "evt",
        providerReference: "ref",
        eventType: "PAYMENT_SUCCEEDED",
        status: "GUARANTEE_SATISFIED",
        occurredAt: "2026-08-29T01:00:00.000Z"
      };
    }
  };
  assert.deepEqual(Object.keys(fake).sort(), [
    "captureAuthorization",
    "createAuthorizationHold",
    "createDepositPayment",
    "createFullPrepayment",
    "createPaymentMethodSetup",
    "getTransactionStatus",
    "refundPayment",
    "releaseAuthorization",
    "verifyAndNormalizeWebhook"
  ]);
});
