import { AppError } from "../packages/shared-contracts/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import { StripeAirenPayTestHttpClientFactory } from "../packages/integrations/src/stripe-airenpay-test-http-client.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../packages/ristoairen/src/airenpay/index.ts";

const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_REFUND_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SANDBOX_ACCOUNT_REFERENCE = "acct_1U9k1nP5zjpreN16";
const D4C_CAPTURED_PAYMENT_INTENT = "pi_3UA5bpP5zjpreN160czIgndr";
const TEST_AMOUNT_MINOR = 100;
const TEST_CURRENCY = "EUR";

function requireExplicitOptIn(): void {
  if (process.env[ENABLE_FLAG] !== "true") {
    throw new AppError("PERMISSION_DENIED", `Stripe TEST refund proof requires ${ENABLE_FLAG}=true`);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  const now = new Date().toISOString();
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000001210",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    capabilities: ["REFUND_PAYMENT", "TRANSACTION_STATUS"],
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
    orchestrationId: "00000000-0000-4000-8000-000000001221",
    correlationId: "rbl12-stripe-test-refund-proof-v1",
    idempotencyKey: "rbl12-stripe-test-refund-proof-v1",
    connection: activeConnection
  });
}

function safeProviderMetadata(value: Readonly<Record<string, string | number | boolean | null>> | undefined) {
  if (!value) return undefined;
  return Object.freeze({
    stripeObject: value.stripeObject,
    stripeStatus: value.stripeStatus,
    stripeRefundReference: value.stripeRefundReference,
    livemode: value.livemode
  });
}

function safeFailure(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof AppError) {
    return Object.freeze({
      event: "airenpay.stripe.test.refund.failed",
      code: error.code,
      provider: error.details?.provider,
      httpStatus: error.details?.httpStatus,
      providerErrorType: error.details?.providerErrorType,
      providerErrorCode: error.details?.providerErrorCode,
      providerDeclineCode: error.details?.providerDeclineCode
    });
  }
  return Object.freeze({ event: "airenpay.stripe.test.refund.failed", code: "UNEXPECTED_ERROR" });
}

function assertExpectedMoney(amount: Readonly<{ amountMinor: number; currency: string }> | undefined): void {
  if (amount?.amountMinor !== TEST_AMOUNT_MINOR || amount.currency !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", "Stripe TEST refund preflight amount/currency mismatch");
  }
}

async function main(): Promise<void> {
  requireExplicitOptIn();

  const secretProvider = new EnvironmentSecretProvider(process.env, [SECRET_ENV_KEY]);
  const clientFactory = new StripeAirenPayTestHttpClientFactory({ secretProvider });
  const adapter = new StripeAirenPayTestAdapter(clientFactory);
  const activeConnection = connection();
  const context = operationContext(activeConnection);

  const beforeRefund = await adapter.getTransactionStatus(context, D4C_CAPTURED_PAYMENT_INTENT);
  if (beforeRefund.providerReference !== D4C_CAPTURED_PAYMENT_INTENT || beforeRefund.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST refund preflight did not match the governed D4-C sandbox payment");
  }
  if (beforeRefund.providerMetadata?.stripeStatus !== "succeeded" || beforeRefund.status !== "GUARANTEE_SATISFIED") {
    throw new AppError("CONFLICT", "Stripe TEST refund preflight requires succeeded / GUARANTEE_SATISFIED D4-C state");
  }
  assertExpectedMoney(beforeRefund.amount);

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.refund.preflight",
    providerReference: beforeRefund.providerReference,
    status: beforeRefund.status,
    providerMetadata: safeProviderMetadata(beforeRefund.providerMetadata),
    amount: beforeRefund.amount,
    boundToD4CCapturedPayment: true,
    authorizationCreatedByRunner: false,
    paymentIntentCreatedByRunner: false,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    testModeOnly: true,
    testProviderMutation: false,
    realMoneyMovement: false
  }));

  const refunded = await adapter.refundPayment(context, D4C_CAPTURED_PAYMENT_INTENT, {
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY
  });

  if (refunded.providerReference !== D4C_CAPTURED_PAYMENT_INTENT || refunded.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST refund returned an unexpected provider object");
  }
  if (refunded.providerMetadata?.stripeStatus !== "succeeded" || refunded.status !== "REFUNDED") {
    throw new AppError("CONFLICT", "Stripe TEST refund did not reach succeeded / REFUNDED");
  }
  const refundReference = refunded.providerMetadata?.stripeRefundReference;
  if (typeof refundReference !== "string" || !refundReference.startsWith("re_")) {
    throw new AppError("CONFLICT", "Stripe TEST refund did not return a governed refund reference");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.refund.executed",
    providerReference: refunded.providerReference,
    status: refunded.status,
    providerMetadata: safeProviderMetadata(refunded.providerMetadata),
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    boundToD4CCapturedPayment: true,
    authorizationCreatedByRunner: false,
    paymentIntentCreatedByRunner: false,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: true,
    testModeOnly: true,
    testProviderMutation: true,
    realMoneyMovement: false
  }));

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.refund.runner_complete",
    result: "PASS",
    providerReference: refunded.providerReference,
    refundReference,
    livemode: false,
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    boundToD4CCapturedPayment: true,
    refundExecuted: true,
    testModeOnly: true,
    testProviderMutation: true,
    realMoneyMovement: false,
    independentProviderRefundReadbackRequired: true,
    gateClosureEligible: false
  }));
}

main().catch(error => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
