import {
  assertTrustedProviderConnectionV1,
  decideAirenPayReconciliationV1,
  type AirenPayReconciliationDecisionV1,
  type AirenPayReconciliationEvidenceV1,
  type AirenPayTrustedProviderConnectionV1
} from "../../airenpay/src/index.ts";
import type { VerifiedProviderWebhookEvent } from "./webhook-replay.ts";

export interface AirenPayStripeConnectTenantResolver {
  resolveByProviderAccountReference(
    providerAccountReference: string
  ): Promise<AirenPayTrustedProviderConnectionV1 | null>;
}

export type AirenPayRoutedStripeConnectWebhookV1 = Readonly<{
  tenantId: string;
  locationId?: string;
  providerConnectionId: string;
  providerAccountReference: string;
  providerEventId: string;
  eventType: string;
  providerReference: string;
  observedStatus: string;
  evidence: AirenPayReconciliationEvidenceV1;
}>;

type StripeConnectWebhookPayload = Readonly<{
  account: string;
  livemode: boolean;
  data: Readonly<{
    object: Readonly<{
      id: string;
      status: string;
    }>;
  }>;
}>;

function requireObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
}

function parseStripeConnectWebhookPayload(payload: unknown): StripeConnectWebhookPayload {
  const root = requireObject(payload, "AIRENPAY_CONNECT_WEBHOOK_PAYLOAD_INVALID");
  const account = requireString(root.account, "AIRENPAY_CONNECT_WEBHOOK_ACCOUNT_REQUIRED");
  if (typeof root.livemode !== "boolean") throw new Error("AIRENPAY_CONNECT_WEBHOOK_LIVEMODE_REQUIRED");
  if (root.livemode) throw new Error("AIRENPAY_CONNECT_WEBHOOK_LIVE_FORBIDDEN");

  const data = requireObject(root.data, "AIRENPAY_CONNECT_WEBHOOK_DATA_REQUIRED");
  const object = requireObject(data.object, "AIRENPAY_CONNECT_WEBHOOK_OBJECT_REQUIRED");
  const id = requireString(object.id, "AIRENPAY_CONNECT_WEBHOOK_OBJECT_ID_REQUIRED");
  const status = requireString(object.status, "AIRENPAY_CONNECT_WEBHOOK_STATUS_REQUIRED");

  return Object.freeze({
    account,
    livemode: false,
    data: Object.freeze({ object: Object.freeze({ id, status }) })
  });
}

function assertWebhookConnection(
  connection: AirenPayTrustedProviderConnectionV1,
  providerAccountReference: string
): void {
  assertTrustedProviderConnectionV1(connection);
  if (connection.gateway.providerType !== "stripe") throw new Error("AIRENPAY_CONNECT_WEBHOOK_STRIPE_REQUIRED");
  if (connection.gateway.mode !== "TEST" || connection.profile.environmentClass !== "TEST") {
    throw new Error("AIRENPAY_CONNECT_WEBHOOK_TEST_ONLY");
  }
  if (connection.gateway.status !== "ACTIVE") throw new Error("AIRENPAY_CONNECT_WEBHOOK_CONNECTION_INACTIVE");
  if (connection.gateway.providerAccountReference !== providerAccountReference) {
    throw new Error("AIRENPAY_CONNECT_WEBHOOK_ACCOUNT_SCOPE_MISMATCH");
  }
}

export async function routeVerifiedStripeConnectWebhookV1(input: Readonly<{
  event: VerifiedProviderWebhookEvent;
  resolver: AirenPayStripeConnectTenantResolver;
  observedAt: string;
  correlationId: string;
}>): Promise<AirenPayRoutedStripeConnectWebhookV1> {
  if (!input.observedAt.trim()) throw new Error("AIRENPAY_CONNECT_WEBHOOK_OBSERVED_AT_REQUIRED");
  if (!input.correlationId.trim()) throw new Error("AIRENPAY_CONNECT_WEBHOOK_CORRELATION_REQUIRED");

  const payload = parseStripeConnectWebhookPayload(input.event.providerPayload);
  const connection = await input.resolver.resolveByProviderAccountReference(payload.account);
  if (!connection) throw new Error("AIRENPAY_CONNECT_WEBHOOK_PROVIDER_ACCOUNT_UNMAPPED");
  assertWebhookConnection(connection, payload.account);

  const providerReference = payload.data.object.id;
  const evidence: AirenPayReconciliationEvidenceV1 = Object.freeze({
    channel: "VERIFIED_WEBHOOK",
    providerReference,
    observedStatus: payload.data.object.status,
    observedAt: input.observedAt,
    correlationId: input.correlationId
  });

  return Object.freeze({
    tenantId: connection.gateway.tenantId,
    ...(connection.gateway.locationId ? { locationId: connection.gateway.locationId } : {}),
    providerConnectionId: connection.gateway.id,
    providerAccountReference: connection.gateway.providerAccountReference,
    providerEventId: input.event.providerEventId,
    eventType: input.event.eventType,
    providerReference,
    observedStatus: payload.data.object.status,
    evidence
  });
}

export function reconcileStripeConnectThreeChannelEvidenceV1(input: Readonly<{
  routedWebhook: AirenPayRoutedStripeConnectWebhookV1;
  synchronous: AirenPayReconciliationEvidenceV1;
  readBack: AirenPayReconciliationEvidenceV1;
}>): Readonly<{
  evidence: readonly AirenPayReconciliationEvidenceV1[];
  decision: AirenPayReconciliationDecisionV1;
}> {
  if (input.synchronous.channel !== "SYNCHRONOUS_API") {
    throw new Error("AIRENPAY_CONNECT_RECON_SYNCHRONOUS_CHANNEL_REQUIRED");
  }
  if (input.readBack.channel !== "PROVIDER_READ_BACK") {
    throw new Error("AIRENPAY_CONNECT_RECON_READBACK_CHANNEL_REQUIRED");
  }

  const providerReference = input.routedWebhook.providerReference;
  if (
    input.synchronous.providerReference !== providerReference ||
    input.readBack.providerReference !== providerReference ||
    input.routedWebhook.evidence.providerReference !== providerReference
  ) {
    throw new Error("AIRENPAY_CONNECT_RECON_PROVIDER_REFERENCE_MISMATCH");
  }

  const evidence = Object.freeze([
    input.synchronous,
    input.routedWebhook.evidence,
    input.readBack
  ]);
  return Object.freeze({ evidence, decision: Object.freeze(decideAirenPayReconciliationV1(evidence)) });
}
