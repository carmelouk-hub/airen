import { AppError } from "../packages/shared-contracts/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import { StripeAirenPayTestHttpClientFactory } from "../packages/integrations/src/stripe-airenpay-test-http-client.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../packages/ristoairen/src/airenpay/index.ts";

const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_PAYMENT_INTENT_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SANDBOX_ACCOUNT_REFERENCE = "acct_1U9k1nP5zjpreN16";
const TEST_AMOUNT_MINOR = 100;
const TEST_CURRENCY = "EUR";

function requireExplicitOptIn(): void {
  if (process.env[ENABLE_FLAG] !== "true") {
    throw new AppError("PERMISSION_DENIED", `Stripe TEST PaymentIntent proof requires ${ENABLE_FLAG}=true`);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  const now = new Date().toISOString();
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000810",
    tenantId: "00000000-0000-4000-8000-000000000802",
    locationId: "00000000-0000-4000-8000-000000000803",
    providerType: "STRIPE",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    capabilities: ["DEPOSIT_PAYMENT", "TRANSACTION_STATUS"],
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
    orchestrationId: "00000000-0000-4000-8000-000000000820",
    correlationId: "rbl08-stripe-test-payment-intent-proof-v1",
    idempotencyKey: "rbl08-stripe-test-payment-intent-proof-v1",
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
      event: "airenpay.stripe.test.payment_intent.failed",
      code: error.code,
      provider: error.details?.provider,
      httpStatus: error.details?.httpStatus,
      providerErrorType: error.details?.providerErrorType,
      providerErrorCode: error.details?.providerErrorCode
    });
  }
  return Object.freeze({ event: "airenpay.stripe.test.payment_intent.failed", code: "UNEXPECTED_ERROR" });
}

async function main(): Promise<void> {
  requireExplicitOptIn();

  const secretProvider = new EnvironmentSecretProvider(process.env, [SECRET_ENV_KEY]);
  const clientFactory = new StripeAirenPayTestHttpClientFactory({ secretProvider });
  const adapter = new StripeAirenPayTestAdapter(clientFactory);
  const activeConnection = connection();
  const context = operationContext(activeConnection);

  const created = await adapter.createDepositPayment(context, {
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY
  });

  if (!created.providerReference.startsWith("pi_")) {
    throw new AppError("INTERNAL_ERROR", "Stripe TEST PaymentIntent proof returned an unexpected provider reference");
  }
  if (created.providerMetadata?.livemode !== false) {
    throw new AppError("PERMISSION_DENIED", "Stripe TEST PaymentIntent proof rejected non-TEST provider response");
  }
  if (created.providerMetadata?.stripeStatus !== "requires_payment_method") {
    throw new AppError("CONFLICT", "Stripe TEST PaymentIntent proof unexpectedly advanced beyond unconfirmed requires_payment_method state");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.payment_intent.created",
    providerReference: created.providerReference,
    status: created.status,
    providerMetadata: safeProviderMetadata(created.providerMetadata),
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    clientActionPresent: Boolean(created.clientAction),
    clientSecretLogged: false,
    customerProvidedByRunner: false,
    paymentMethodProvidedByRunner: false,
    confirmRequestedByRunner: false,
    captureRequestedByRunner: false,
    chargeCreatedByRunner: false,
    authorizationCreatedByRunner: false,
    realMoneyMovement: false
  }));

  const readBack = await adapter.getTransactionStatus(context, created.providerReference);
  if (readBack.providerReference !== created.providerReference || readBack.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST PaymentIntent provider read-back did not match the created TEST object");
  }
  if (readBack.providerMetadata?.stripeStatus !== "requires_payment_method") {
    throw new AppError("CONFLICT", "Stripe TEST PaymentIntent provider read-back unexpectedly advanced state");
  }
  if (readBack.amount?.amountMinor !== TEST_AMOUNT_MINOR || readBack.amount.currency !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", "Stripe TEST PaymentIntent provider read-back amount/currency mismatch");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.payment_intent.readback",
    providerReference: readBack.providerReference,
    status: readBack.status,
    providerMetadata: safeProviderMetadata(readBack.providerMetadata),
    amount: readBack.amount,
    matchedCreatedReference: true,
    livemode: false,
    customerProvidedByRunner: false,
    paymentMethodProvidedByRunner: false,
    confirmRequestedByRunner: false,
    captureRequestedByRunner: false,
    chargeCreatedByRunner: false,
    authorizationCreatedByRunner: false,
    realMoneyMovement: false
  }));

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.payment_intent.proof_complete",
    result: "PASS",
    providerReference: readBack.providerReference,
    livemode: false,
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    unconfirmedPaymentIntent: true,
    realMoneyMovement: false
  }));
}

main().catch(error => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
