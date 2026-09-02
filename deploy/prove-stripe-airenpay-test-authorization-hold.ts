import { AppError } from "../packages/shared-contracts/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import { StripeAirenPayTestHttpClientFactory } from "../packages/integrations/src/stripe-airenpay-test-http-client.ts";
import { confirmStripeTestAuthorizationForProof } from "./stripe-airenpay-test-authorization-proof-client.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../packages/airenpay/src/index.ts";

const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_AUTHORIZATION_HOLD_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SANDBOX_ACCOUNT_REFERENCE = "acct_1U9k1nP5zjpreN16";
const TEST_PAYMENT_METHOD_FIXTURE = "pm_card_visa" as const;
const TEST_AMOUNT_MINOR = 100;
const TEST_CURRENCY = "EUR";

function requireExplicitOptIn(): void {
  if (process.env[ENABLE_FLAG] !== "true") {
    throw new AppError("PERMISSION_DENIED", `Stripe TEST authorization-hold proof requires ${ENABLE_FLAG}=true`);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  const now = new Date().toISOString();
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000910",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    capabilities: ["AUTHORIZATION_HOLD", "TRANSACTION_STATUS"],
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
    orchestrationId: "00000000-0000-4000-8000-000000000921",
    correlationId: "rbl09-stripe-test-authorization-hold-proof-v2",
    idempotencyKey: "rbl09-stripe-test-authorization-hold-proof-v2",
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
      event: "airenpay.stripe.test.authorization_hold.failed",
      code: error.code,
      provider: error.details?.provider,
      httpStatus: error.details?.httpStatus,
      providerErrorType: error.details?.providerErrorType,
      providerErrorCode: error.details?.providerErrorCode,
      providerDeclineCode: error.details?.providerDeclineCode
    });
  }
  return Object.freeze({ event: "airenpay.stripe.test.authorization_hold.failed", code: "UNEXPECTED_ERROR" });
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
    throw new AppError("INTERNAL_ERROR", "Stripe TEST authorization-hold proof returned an unexpected provider reference");
  }
  if (created.providerMetadata?.livemode !== false) {
    throw new AppError("PERMISSION_DENIED", "Stripe TEST authorization-hold proof rejected non-TEST provider response");
  }
  if (created.providerMetadata?.stripeStatus !== "requires_payment_method") {
    throw new AppError("CONFLICT", "Stripe TEST authorization-hold proof expected an unconfirmed requires_payment_method PaymentIntent before customer-fixture confirmation");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_hold.created",
    providerReference: created.providerReference,
    status: created.status,
    providerMetadata: safeProviderMetadata(created.providerMetadata),
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    captureMethod: "manual",
    testPaymentMethodFixture: TEST_PAYMENT_METHOD_FIXTURE,
    clientSecretLogged: false,
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
    throw new AppError("CONFLICT", "Stripe TEST authorization-hold proof amount/currency mismatch after confirmation");
  }
  if (authorized.amountCapturable !== TEST_AMOUNT_MINOR) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-hold proof did not authorize the exact TEST amount");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_hold.authorized",
    providerReference: authorized.id,
    stripeStatus: authorized.status,
    livemode: authorized.livemode,
    amountMinor: authorized.amount,
    currency: authorized.currency.toUpperCase(),
    amountCapturable: authorized.amountCapturable,
    testPaymentMethodFixture: TEST_PAYMENT_METHOD_FIXTURE,
    authorizationCreatedByRunner: true,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    realMoneyMovement: false
  }));

  const readBack = await adapter.getTransactionStatus(context, created.providerReference);
  if (readBack.providerReference !== created.providerReference || readBack.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-hold provider read-back did not match the authorized TEST object");
  }
  if (readBack.providerMetadata?.stripeStatus !== "requires_capture" || readBack.status !== "GUARANTEE_SATISFIED") {
    throw new AppError("CONFLICT", "Stripe TEST authorization-hold read-back did not preserve requires_capture / GUARANTEE_SATISFIED");
  }
  if (readBack.amount?.amountMinor !== TEST_AMOUNT_MINOR || readBack.amount.currency !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-hold read-back amount/currency mismatch");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_hold.readback",
    providerReference: readBack.providerReference,
    status: readBack.status,
    providerMetadata: safeProviderMetadata(readBack.providerMetadata),
    amount: readBack.amount,
    matchedAuthorizedReference: true,
    livemode: false,
    authorizationCreatedByRunner: true,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    realMoneyMovement: false
  }));

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_hold.proof_complete",
    result: "PASS",
    providerReference: readBack.providerReference,
    livemode: false,
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    amountCapturable: authorized.amountCapturable,
    authorizationHoldCreated: true,
    captureExecuted: false,
    releaseExecuted: false,
    refundExecuted: false,
    realMoneyMovement: false
  }));
}

main().catch(error => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
