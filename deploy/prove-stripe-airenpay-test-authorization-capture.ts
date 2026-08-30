import { AppError } from "../packages/shared-contracts/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import { StripeAirenPayTestHttpClientFactory } from "../packages/integrations/src/stripe-airenpay-test-http-client.ts";
import { confirmStripeTestAuthorizationForProof } from "./stripe-airenpay-test-authorization-proof-client.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../packages/ristoairen/src/airenpay/index.ts";

const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_AUTHORIZATION_CAPTURE_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SANDBOX_ACCOUNT_REFERENCE = "acct_1U9k1nP5zjpreN16";
const TEST_PAYMENT_METHOD_FIXTURE = "pm_card_visa" as const;
const TEST_AMOUNT_MINOR = 100;
const TEST_CURRENCY = "EUR";

function requireExplicitOptIn(): void {
  if (process.env[ENABLE_FLAG] !== "true") {
    throw new AppError("PERMISSION_DENIED", `Stripe TEST authorization-capture proof requires ${ENABLE_FLAG}=true`);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  const now = new Date().toISOString();
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000001110",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    capabilities: ["AUTHORIZATION_HOLD", "CAPTURE_AUTHORIZATION", "TRANSACTION_STATUS"],
    mode: "TEST",
    credentialSecretRef: Object.freeze({ provider: "env", key: SECRET_ENV_KEY }),
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    rowVersion: 1
  });
}

function operationContext(activeConnection: TenantPaymentGatewayConnectionProjectionV1): AirenPayGatewayOperationContextV1 {
  return Object.freeze({
    orchestrationId: "00000000-0000-4000-8000-000000001121",
    correlationId: "rbl11-stripe-test-authorization-capture-proof-v1",
    idempotencyKey: "rbl11-stripe-test-authorization-capture-proof-v1",
    connection: activeConnection
  });
}

function safeProviderMetadata(value: Readonly<Record<string, string | number | boolean | null>> | undefined) {
  if (!value) return undefined;
  return Object.freeze({
    stripeObject: value.stripeObject,
    stripeStatus: value.stripeStatus,
    livemode: value.livemode
  });
}

function safeFailure(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof AppError) {
    return Object.freeze({
      event: "airenpay.stripe.test.authorization_capture.failed",
      code: error.code,
      provider: error.details?.provider,
      httpStatus: error.details?.httpStatus,
      providerErrorType: error.details?.providerErrorType,
      providerErrorCode: error.details?.providerErrorCode,
      providerDeclineCode: error.details?.providerDeclineCode
    });
  }
  return Object.freeze({ event: "airenpay.stripe.test.authorization_capture.failed", code: "UNEXPECTED_ERROR" });
}

function assertExpectedMoney(amount: Readonly<{ amountMinor: number; currency: string }> | undefined, phase: string): void {
  if (amount?.amountMinor !== TEST_AMOUNT_MINOR || amount.currency !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", `Stripe TEST authorization-capture ${phase} amount/currency mismatch`);
  }
}

async function main(): Promise<void> {
  requireExplicitOptIn();

  const secretProvider = new EnvironmentSecretProvider(process.env, [SECRET_ENV_KEY]);
  const clientFactory = new StripeAirenPayTestHttpClientFactory({ secretProvider });
  const adapter = new StripeAirenPayTestAdapter(clientFactory);
  const activeConnection = connection();
  const context = operationContext(activeConnection);

  const created = await adapter.createAuthorizationHold(context, {
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY
  });

  if (!created.providerReference.startsWith("pi_")) {
    throw new AppError("INTERNAL_ERROR", "Stripe TEST authorization-capture proof returned an unexpected provider reference");
  }
  if (created.providerMetadata?.livemode !== false) {
    throw new AppError("PERMISSION_DENIED", "Stripe TEST authorization-capture proof rejected non-TEST provider response");
  }
  if (created.providerMetadata?.stripeStatus !== "requires_payment_method") {
    throw new AppError("CONFLICT", "Stripe TEST authorization-capture proof expected requires_payment_method before TEST fixture confirmation");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_capture.created",
    providerReference: created.providerReference,
    status: created.status,
    providerMetadata: safeProviderMetadata(created.providerMetadata),
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    captureMethod: "manual",
    testPaymentMethodFixture: TEST_PAYMENT_METHOD_FIXTURE,
    clientSecretLogged: false,
    authorizationCreatedByRunner: false,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    realMoneyMovement: false
  }));

  const authorized = await confirmStripeTestAuthorizationForProof({
    connection: activeConnection,
    providerReference: created.providerReference,
    paymentMethodFixture: TEST_PAYMENT_METHOD_FIXTURE,
    idempotencyKey: `${context.idempotencyKey}:stripe:test-confirm-authorization`,
    secretProvider
  });

  if (authorized.amount !== TEST_AMOUNT_MINOR || authorized.currency.toUpperCase() !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-capture proof amount/currency mismatch after authorization");
  }
  if (authorized.status !== "requires_capture" || authorized.amountCapturable !== TEST_AMOUNT_MINOR || authorized.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-capture proof did not reach the exact uncaptured TEST authorization state");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_capture.authorized",
    providerReference: authorized.id,
    stripeStatus: authorized.status,
    livemode: authorized.livemode,
    amountMinor: authorized.amount,
    currency: authorized.currency.toUpperCase(),
    amountCapturable: authorized.amountCapturable,
    authorizationCreatedByRunner: true,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    realMoneyMovement: false
  }));

  const beforeCapture = await adapter.getTransactionStatus(context, created.providerReference);
  if (beforeCapture.providerReference !== created.providerReference || beforeCapture.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-capture preflight did not match the fresh TEST authorization");
  }
  if (beforeCapture.providerMetadata?.stripeStatus !== "requires_capture" || beforeCapture.status !== "GUARANTEE_SATISFIED") {
    throw new AppError("CONFLICT", "Stripe TEST authorization-capture preflight requires requires_capture / GUARANTEE_SATISFIED");
  }
  assertExpectedMoney(beforeCapture.amount, "preflight");

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_capture.preflight",
    providerReference: beforeCapture.providerReference,
    status: beforeCapture.status,
    providerMetadata: safeProviderMetadata(beforeCapture.providerMetadata),
    amount: beforeCapture.amount,
    authorizationCreatedByRunner: true,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    realMoneyMovement: false
  }));

  const captured = await adapter.captureAuthorization(context, created.providerReference, {
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY
  });

  if (captured.providerReference !== created.providerReference || captured.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST authorization capture returned an unexpected provider object");
  }
  if (captured.providerMetadata?.stripeStatus !== "succeeded" || captured.status !== "CAPTURED") {
    throw new AppError("CONFLICT", "Stripe TEST authorization capture did not reach succeeded / CAPTURED");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_capture.captured",
    providerReference: captured.providerReference,
    status: captured.status,
    providerMetadata: safeProviderMetadata(captured.providerMetadata),
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    authorizationCreatedByRunner: true,
    testCaptureExecutedByRunner: true,
    captureExecutedByRunner: true,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    testModeOnly: true,
    realMoneyMovement: false
  }));

  const afterCapture = await adapter.getTransactionStatus(context, created.providerReference);
  if (afterCapture.providerReference !== created.providerReference || afterCapture.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-capture post-readback did not match the captured TEST object");
  }
  if (afterCapture.providerMetadata?.stripeStatus !== "succeeded" || afterCapture.status !== "GUARANTEE_SATISFIED") {
    throw new AppError("CONFLICT", "Stripe TEST authorization-capture post-readback did not preserve provider succeeded state");
  }
  assertExpectedMoney(afterCapture.amount, "post-capture");

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_capture.readback",
    providerReference: afterCapture.providerReference,
    status: afterCapture.status,
    providerMetadata: safeProviderMetadata(afterCapture.providerMetadata),
    amount: afterCapture.amount,
    matchedCapturedReference: true,
    authorizationCreatedByRunner: true,
    testCaptureExecutedByRunner: true,
    captureExecutedByRunner: true,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    testModeOnly: true,
    realMoneyMovement: false
  }));

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_capture.proof_complete",
    result: "PASS",
    providerReference: afterCapture.providerReference,
    livemode: false,
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    authorizationCreated: true,
    testCaptureExecuted: true,
    captureExecuted: true,
    releaseExecuted: false,
    refundExecuted: false,
    testModeOnly: true,
    realMoneyMovement: false
  }));
}

main().catch(error => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
