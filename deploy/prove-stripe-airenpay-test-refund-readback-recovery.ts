import { AppError } from "../packages/shared-contracts/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { StripeAirenPayTestHttpClientFactory } from "../packages/integrations/src/stripe-airenpay-test-http-client.ts";
import type { TenantPaymentGatewayConnectionProjectionV1 } from "../packages/airenpay/src/index.ts";

const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_REFUND_READBACK_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SANDBOX_ACCOUNT_REFERENCE = "acct_1U9k1nP5zjpreN16";
const D4C_PAYMENT_INTENT = "pi_3UA5bpP5zjpreN160czIgndr";
const D4C_CHARGE = "ch_3UA5bpP5zjpreN160c7cip0Y";
const D4D_REFUND = "re_3UA5bpP5zjpreN160ZI14ePG";
const TEST_AMOUNT_MINOR = 100;
const TEST_CURRENCY = "EUR";

function requireExplicitOptIn(): void {
  if (process.env[ENABLE_FLAG] !== "true") {
    throw new AppError("PERMISSION_DENIED", `Stripe TEST refund read-back proof requires ${ENABLE_FLAG}=true`);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  const now = new Date().toISOString();
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000001310",
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
      event: "airenpay.stripe.test.refund.readback.failed",
      code: error.code,
      provider: error.details?.provider,
      httpStatus: error.details?.httpStatus,
      providerErrorType: error.details?.providerErrorType,
      providerErrorCode: error.details?.providerErrorCode
    });
  }
  return Object.freeze({ event: "airenpay.stripe.test.refund.readback.failed", code: "UNEXPECTED_ERROR" });
}

async function main(): Promise<void> {
  requireExplicitOptIn();

  const activeConnection = connection();
  const secretProvider = new EnvironmentSecretProvider(process.env, [SECRET_ENV_KEY]);
  const factory = new StripeAirenPayTestHttpClientFactory({ secretProvider });
  const client = await factory.forConnection(activeConnection);

  const payment = await client.retrievePaymentIntent(D4C_PAYMENT_INTENT);
  if (payment.id !== D4C_PAYMENT_INTENT || payment.livemode !== false || payment.status !== "succeeded") {
    throw new AppError("CONFLICT", "Stripe TEST refund recovery PaymentIntent does not match governed D4-C state");
  }
  if (payment.amount !== TEST_AMOUNT_MINOR || payment.currency.toUpperCase() !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", "Stripe TEST refund recovery PaymentIntent amount/currency mismatch");
  }

  const refund = await factory.retrieveRefundForProof(activeConnection, D4D_REFUND);
  if (refund.id !== D4D_REFUND || refund.livemode !== false || refund.status !== "succeeded") {
    throw new AppError("CONFLICT", "Stripe TEST refund recovery did not match the governed succeeded refund");
  }
  if (refund.paymentIntentId !== D4C_PAYMENT_INTENT || refund.chargeId !== D4C_CHARGE) {
    throw new AppError("CONFLICT", "Stripe TEST refund recovery provider lineage mismatch");
  }
  if (refund.amount !== TEST_AMOUNT_MINOR || refund.currency.toUpperCase() !== TEST_CURRENCY) {
    throw new AppError("CONFLICT", "Stripe TEST refund recovery amount/currency mismatch");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.refund.readback.recovery_complete",
    result: "PASS",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    paymentIntentReference: payment.id,
    chargeReference: refund.chargeId,
    refundReference: refund.id,
    refundStatus: refund.status,
    livemode: false,
    amountMinor: refund.amount,
    currency: refund.currency.toUpperCase(),
    readOnly: true,
    httpMutation: false,
    refundCreatedByRunner: false,
    postRefundEndpointUsed: false,
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
