import { AppError } from "../packages/shared-contracts/src/index.ts";
import {
  assertAirenPayAuthorizationWindowCompatible,
  type TenantPaymentGatewayConnectionProjectionV1
} from "../packages/ristoairen/src/airenpay/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import { StripeAirenPayTestHttpClientFactory } from "../packages/integrations/src/stripe-airenpay-test-http-client.ts";

const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_AUTHORIZATION_EXPIRY_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SANDBOX_ACCOUNT_REFERENCE = "acct_1U9k1nP5zjpreN16";
const D4C_PAYMENT_INTENT = "pi_3UA5bpP5zjpreN160czIgndr";
const EXPECTED_AUTHORIZATION_EXPIRY = "2026-09-06T10:05:06.000Z";
const SAFE_SERVICE_START = "2026-09-06T09:00:00.000Z";
const UNSAFE_SERVICE_START = "2026-09-06T10:05:06.000Z";
const TEST_AMOUNT_MINOR = 100;
const TEST_CURRENCY = "EUR";

function requireExplicitOptIn(): void {
  if (process.env[ENABLE_FLAG] !== "true") {
    throw new AppError("PERMISSION_DENIED", `Stripe TEST authorization-expiry proof requires ${ENABLE_FLAG}=true`);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  const now = new Date().toISOString();
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000001410",
    tenantId: "00000000-0000-4000-8000-000000000902",
    locationId: "00000000-0000-4000-8000-000000000903",
    providerType: "STRIPE",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    capabilities: ["TRANSACTION_STATUS"],
    mode: "TEST",
    credentialSecretRef: Object.freeze({ provider: "env", key: SECRET_ENV_KEY }),
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    rowVersion: 1
  });
}

function safeFailure(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof AppError) {
    return Object.freeze({
      event: "airenpay.stripe.test.authorization_expiry.readback.failed",
      code: error.code,
      provider: error.details?.provider,
      httpStatus: error.details?.httpStatus,
      providerErrorType: error.details?.providerErrorType,
      providerErrorCode: error.details?.providerErrorCode
    });
  }
  return Object.freeze({ event: "airenpay.stripe.test.authorization_expiry.readback.failed", code: "UNEXPECTED_ERROR" });
}

async function main(): Promise<void> {
  requireExplicitOptIn();

  const activeConnection = connection();
  const secretProvider = new EnvironmentSecretProvider(process.env, [SECRET_ENV_KEY]);
  const factory = new StripeAirenPayTestHttpClientFactory({ secretProvider });
  const adapter = new StripeAirenPayTestAdapter(factory);
  const result = await adapter.getTransactionStatus(Object.freeze({
    orchestrationId: "00000000-0000-4000-8000-000000001411",
    correlationId: "rbl14-stripe-test-authorization-expiry-readback-v1",
    idempotencyKey: "rbl14-stripe-test-authorization-expiry-readback-v1",
    connection: activeConnection
  }), D4C_PAYMENT_INTENT);

  if (result.providerReference !== D4C_PAYMENT_INTENT) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-expiry PaymentIntent reference mismatch");
  }
  if (result.amount?.amountMinor !== TEST_AMOUNT_MINOR || result.amount.currency !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-expiry amount/currency mismatch");
  }
  if (result.providerMetadata?.livemode !== false) {
    throw new AppError("PERMISSION_DENIED", "Stripe TEST authorization-expiry read-back did not prove livemode=false");
  }
  if (result.authorizationExpiresAt !== EXPECTED_AUTHORIZATION_EXPIRY) {
    throw new AppError("CONFLICT", "Stripe TEST authorization-expiry provider value mismatch");
  }

  assertAirenPayAuthorizationWindowCompatible(result.authorizationExpiresAt, SAFE_SERVICE_START);

  let eligibilityFailClosed = false;
  try {
    assertAirenPayAuthorizationWindowCompatible(result.authorizationExpiresAt, UNSAFE_SERVICE_START);
  } catch (error) {
    if (error instanceof AppError && error.code === "CONFLICT" && error.message === "AUTHORIZATION_EXPIRES_BEFORE_SERVICE") {
      eligibilityFailClosed = true;
    } else {
      throw error;
    }
  }
  if (!eligibilityFailClosed) {
    throw new AppError("INTERNAL_ERROR", "Authorization-expiry policy failed to reject an incompatible service start");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.authorization_expiry.readback_complete",
    result: "PASS",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    paymentIntentReference: result.providerReference,
    authorizationExpiresAt: result.authorizationExpiresAt,
    eligibleServiceStartsAt: SAFE_SERVICE_START,
    ineligibleServiceStartsAt: UNSAFE_SERVICE_START,
    eligibilityFailClosed,
    livemode: false,
    amountMinor: result.amount.amountMinor,
    currency: result.amount.currency,
    readOnly: true,
    httpMutation: false,
    postEndpointUsed: false,
    newPaymentIntentCreated: false,
    newAuthorizationCreated: false,
    captureExecuted: false,
    releaseExecuted: false,
    refundCreated: false,
    testModeOnly: true,
    realMoneyMovement: false,
    independentProviderReadbackStillRequired: true,
    gateClosureEligible: false
  }));
}

main().catch(error => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
