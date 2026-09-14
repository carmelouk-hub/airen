import type {
  AirenPayReconciliationEvidenceV1,
  AirenPayTrustedProviderConnectionV1
} from "../../airenpay/src/index.ts";
import type { VerifiedProviderWebhookEvent } from "./webhook-replay.ts";
import {
  AirenPayStripeConnectDirectChargeAdapter,
  type AirenPayApplicationFeePolicyV1,
  type StripeConnectDirectChargeEvidence
} from "./airenpay-stripe-connect-direct-charge.ts";
import {
  reconcileStripeConnectThreeChannelEvidenceV1,
  routeVerifiedStripeConnectWebhookV1,
  type AirenPayRoutedStripeConnectWebhookV1,
  type AirenPayStripeConnectTenantResolver
} from "./airenpay-stripe-connect-webhook-reconciliation.ts";

export type AirenPayStripeConnectInternalE2EInput = Readonly<{
  expectedTenantId: string;
  trustedConnection: AirenPayTrustedProviderConnectionV1;
  directChargeAdapter: AirenPayStripeConnectDirectChargeAdapter;
  resolver: AirenPayStripeConnectTenantResolver;
  verifiedWebhookEvent: VerifiedProviderWebhookEvent;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  observedAt: string;
  applicationFee: AirenPayApplicationFeePolicyV1;
}>;

export type AirenPayStripeConnectInternalE2EResult = Readonly<{
  tenantId: string;
  providerConnectionId: string;
  providerAccountReference: string;
  directCharge: StripeConnectDirectChargeEvidence;
  routedWebhook: AirenPayRoutedStripeConnectWebhookV1;
  reconciliation: ReturnType<typeof reconcileStripeConnectThreeChannelEvidenceV1>;
}>;

function evidence(
  channel: "SYNCHRONOUS_API" | "PROVIDER_READ_BACK",
  providerReference: string,
  observedStatus: string,
  observedAt: string,
  correlationId: string
): AirenPayReconciliationEvidenceV1 {
  return Object.freeze({ channel, providerReference, observedStatus, observedAt, correlationId });
}

export async function executeAirenPayStripeConnectInternalE2EV1(
  input: AirenPayStripeConnectInternalE2EInput
): Promise<AirenPayStripeConnectInternalE2EResult> {
  if (!input.expectedTenantId.trim()) throw new Error("AIRENPAY_CONNECT_INTERNAL_E2E_TENANT_REQUIRED");
  if (input.trustedConnection.gateway.tenantId !== input.expectedTenantId) {
    throw new Error("AIRENPAY_CONNECT_INTERNAL_E2E_TRUSTED_TENANT_MISMATCH");
  }

  const directCharge = await input.directChargeAdapter.createSandboxDirectCharge({
    trustedConnection: input.trustedConnection,
    amountMinor: input.amountMinor,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    applicationFee: input.applicationFee
  });

  const routedWebhook = await routeVerifiedStripeConnectWebhookV1({
    event: input.verifiedWebhookEvent,
    resolver: input.resolver,
    observedAt: input.observedAt,
    correlationId: input.correlationId
  });

  if (routedWebhook.tenantId !== input.expectedTenantId) {
    throw new Error("AIRENPAY_CONNECT_INTERNAL_E2E_WEBHOOK_TENANT_MISMATCH");
  }
  if (routedWebhook.providerConnectionId !== input.trustedConnection.gateway.id) {
    throw new Error("AIRENPAY_CONNECT_INTERNAL_E2E_CONNECTION_MISMATCH");
  }
  if (routedWebhook.providerAccountReference !== input.trustedConnection.gateway.providerAccountReference) {
    throw new Error("AIRENPAY_CONNECT_INTERNAL_E2E_ACCOUNT_MISMATCH");
  }

  const synchronous = evidence(
    "SYNCHRONOUS_API",
    directCharge.synchronous.paymentIntentId,
    directCharge.synchronous.status,
    input.observedAt,
    input.correlationId
  );
  const readBack = evidence(
    "PROVIDER_READ_BACK",
    directCharge.readBack.paymentIntentId,
    directCharge.readBack.status,
    input.observedAt,
    input.correlationId
  );

  const reconciliation = reconcileStripeConnectThreeChannelEvidenceV1({
    routedWebhook,
    synchronous,
    readBack
  });

  return Object.freeze({
    tenantId: input.expectedTenantId,
    providerConnectionId: input.trustedConnection.gateway.id,
    providerAccountReference: input.trustedConnection.gateway.providerAccountReference,
    directCharge,
    routedWebhook,
    reconciliation
  });
}
