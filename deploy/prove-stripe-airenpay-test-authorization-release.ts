import { AppError } from "../packages/shared-contracts/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import { StripeAirenPayTestHttpClientFactory } from "../packages/integrations/src/stripe-airenpay-test-http-client.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../packages/ristoairen/src/airenpay/index.ts";

const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_AUTHORIZATION_RELEASE_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SANDBOX_ACCOUNT_REFERENCE = "acct_1U9k1nP5zjpreN16";
const D4A_PROVIDER_REFERENCE = "pi_3U9w04P5zjpreN161pyxan3o";
const TEST_AMOUNT_MINOR = 100;
const TEST_CURRENCY = "EUR";

function requireExplicitOptIn(): void {
  if (process.env[ENABLE_FLAG] !== "true") {
    throw new AppError("PERMISSION_DENIED", `Stripe TEST authorization-release proof requires ${ENABLE_FLAG}=true`);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  const now = new Date().toISOString();
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000001010",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    capabilities: ["RELEASE_AUTHORIZATION", "TRANSACTION_STATUS"],
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
    orchestrationId: "00000000-0000-4000-8000-000000001031",
    correlationId: "rbl10-stripe-test-authorization-release-proof-v1",
    idempotencyKey: "rbl10-stripe-test-authorization-release-proof-v1",
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
      event: "airenpay.stripe.test.authorization_release.failed",
      code: error.code,
      provider: error.details?.provider,
      httpStatus: error.details?.httpStatus,
      providerErrorType: error.details?.providerErrorType,
      providerErrorCode: error.details?.providerErrorCode,
      providerDeclineCode: error.details?.providerDeclineCode
    });
  }
  return Object.freeze({ event: "airenpay.stripe.test.authorization_release.failed", code: "UNEXPECTED_ERROR" });
}

function assertExpectedMoney(amount: Readonly<{ amountMinor: number; currency: string }> | undefined, phase: string): void {
  if (amount?.amountMinor !== TEST_AMOUNT_MINOR || amount.currency !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", `Stripe TEST authorization-release ${phase} amount/currency mismatch`);
  }
}

async function main(): Promise<void> {
  requireExplicitOptIn();

  const secretProvider = new EnvironmentSecretProvider(process.env, [SECRET_ENV_KEY]);
  const clientFactory = new StripeAirenPayTestHttpClientFactory({ secretProvider });
  const adapter = new StripeAirenPayTestAdapter(clientFactory);
  const activeConnection = connection();
  const context = operationContext(activeConnection);

  const before = await adapter.getTransactionStatus(context, D4A_PROVIDER_REFERENCE);
  if (before.providerReference !== D4A_PROVIDER_REFERENCE || before.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-release preflight did not match the fixed D4-A TEST object");
  }
  if (before.providerMetadata?.stripeStatus !== "requires_capture" || before.status !== "GUARANTEE_SATISFIED") {
    throw new AppError("CONFLICT", "Stripe TEST authorization-release preflight requires the D4-A object to remain authorized/requires_capture");
  }
  assertExpectedMoney(before.amount, "preflight");

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_release.preflight",
    providerReference: before.providerReference,
    status: before.status,
    providerMetadata: safeProviderMetadata(before.providerMetadata),
    amount: before.amount,
    matchedD4AProviderReference: true,
    livemode: false,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: false,
    refundExecutedByRunner: false,
    realMoneyMovement: false
  }));

  const released = await adapter.releaseAuthorization(context, D4A_PROVIDER_REFERENCE);
  if (released.providerReference !== D4A_PROVIDER_REFERENCE || released.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST authorization release did not return the fixed D4-A TEST object");
  }
  if (released.providerMetadata?.stripeStatus !== "canceled" || released.status !== "RELEASED") {
    throw new AppError("CONFLICT", "Stripe TEST authorization release did not reach canceled / RELEASED");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_release.released",
    providerReference: released.providerReference,
    status: released.status,
    providerMetadata: safeProviderMetadata(released.providerMetadata),
    matchedD4AProviderReference: true,
    livemode: false,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: true,
    refundExecutedByRunner: false,
    realMoneyMovement: false
  }));

  const after = await adapter.getTransactionStatus(context, D4A_PROVIDER_REFERENCE);
  if (after.providerReference !== D4A_PROVIDER_REFERENCE || after.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-release post-readback did not match the fixed D4-A TEST object");
  }
  if (after.providerMetadata?.stripeStatus !== "canceled" || after.status !== "CANCELLED") {
    throw new AppError("CONFLICT", "Stripe TEST authorization-release post-readback did not preserve canceled / CANCELLED");
  }
  assertExpectedMoney(after.amount, "post-release");

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_release.readback",
    providerReference: after.providerReference,
    status: after.status,
    providerMetadata: safeProviderMetadata(after.providerMetadata),
    amount: after.amount,
    matchedReleasedReference: true,
    livemode: false,
    captureExecutedByRunner: false,
    releaseExecutedByRunner: true,
    refundExecutedByRunner: false,
    realMoneyMovement: false
  }));

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_release.proof_complete",
    result: "PASS",
    providerReference: after.providerReference,
    livemode: false,
    amountMinor: TEST_AMOUNT_MINOR,
    currency: TEST_CURRENCY,
    authorizationHoldPreviouslyActive: true,
    releaseExecuted: true,
    captureExecuted: false,
    refundExecuted: false,
    realMoneyMovement: false
  }));
}

main().catch(error => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
