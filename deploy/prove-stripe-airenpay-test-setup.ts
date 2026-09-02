import { AppError } from "../packages/shared-contracts/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { StripeAirenPayTestAdapter } from "../packages/integrations/src/stripe-airenpay-test-adapter.ts";
import { StripeAirenPayTestHttpClientFactory } from "../packages/integrations/src/stripe-airenpay-test-http-client.ts";
import type {
  AirenPayGatewayOperationContextV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../packages/airenpay/src/index.ts";

const ENABLE_FLAG = "AIRENPAY_STRIPE_TEST_SETUP_PROOF_ENABLED";
const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SANDBOX_ACCOUNT_REFERENCE = "acct_1U9k1nP5zjpreN16";

function requireExplicitOptIn(): void {
  if (process.env[ENABLE_FLAG] !== "true") {
    throw new AppError("PERMISSION_DENIED", `Stripe TEST SetupIntent proof requires ${ENABLE_FLAG}=true`);
  }
}

function connection(): TenantPaymentGatewayConnectionProjectionV1 {
  const now = new Date().toISOString();
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000710",
    tenantId: "00000000-0000-4000-8000-000000000702",
    locationId: "00000000-0000-4000-8000-000000000703",
    providerType: "STRIPE",
    providerAccountReference: SANDBOX_ACCOUNT_REFERENCE,
    capabilities: ["PAYMENT_METHOD_SETUP", "TRANSACTION_STATUS"],
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
    orchestrationId: "00000000-0000-4000-8000-000000000720",
    correlationId: "rbl06-stripe-test-setup-proof-v1",
    idempotencyKey: "rbl06-stripe-test-setup-proof-v1",
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
      event: "airenpay.stripe.test.setup.failed",
      code: error.code,
      provider: error.details?.provider,
      httpStatus: error.details?.httpStatus,
      providerErrorType: error.details?.providerErrorType,
      providerErrorCode: error.details?.providerErrorCode
    });
  }
  return Object.freeze({ event: "airenpay.stripe.test.setup.failed", code: "UNEXPECTED_ERROR" });
}

async function main(): Promise<void> {
  requireExplicitOptIn();

  const secretProvider = new EnvironmentSecretProvider(process.env, [SECRET_ENV_KEY]);
  const clientFactory = new StripeAirenPayTestHttpClientFactory({ secretProvider });
  const adapter = new StripeAirenPayTestAdapter(clientFactory);
  const activeConnection = connection();
  const context = operationContext(activeConnection);

  const created = await adapter.createPaymentMethodSetup(context);
  if (!created.providerReference.startsWith("seti_")) {
    throw new AppError("INTERNAL_ERROR", "Stripe TEST SetupIntent proof returned an unexpected provider reference");
  }
  if (created.providerMetadata?.livemode !== false) {
    throw new AppError("PERMISSION_DENIED", "Stripe TEST SetupIntent proof rejected non-TEST provider response");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.setup.created",
    providerReference: created.providerReference,
    status: created.status,
    providerMetadata: safeProviderMetadata(created.providerMetadata),
    clientActionPresent: Boolean(created.clientAction),
    clientSecretLogged: false,
    realMoneyMovement: false
  }));

  const readBack = await adapter.getTransactionStatus(context, created.providerReference);
  if (readBack.providerReference !== created.providerReference || readBack.providerMetadata?.livemode !== false) {
    throw new AppError("CONFLICT", "Stripe TEST SetupIntent provider read-back did not match the created TEST object");
  }

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.setup.readback",
    providerReference: readBack.providerReference,
    status: readBack.status,
    providerMetadata: safeProviderMetadata(readBack.providerMetadata),
    matchedCreatedReference: true,
    livemode: false,
    paymentMethodAttachedByRunner: false,
    chargeCreatedByRunner: false,
    realMoneyMovement: false
  }));

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.setup.proof_complete",
    result: "PASS",
    providerReference: readBack.providerReference,
    livemode: false,
    nonChargingSetupIntent: true
  }));
}

main().catch(error => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
