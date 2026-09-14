import type { UUID } from "../../shared-contracts/src/index.ts";

export const AIRENPAY_RECONCILIATION_STATUSES = [
  "PENDING",
  "IN_SYNC",
  "DIVERGED",
  "PROVIDER_UNAVAILABLE",
  "MANUAL_REVIEW_REQUIRED"
] as const;
export type AirenPayReconciliationStatus = (typeof AIRENPAY_RECONCILIATION_STATUSES)[number];

export const AIRENPAY_RECONCILIATION_EVIDENCE_CHANNELS = [
  "SYNCHRONOUS_API",
  "VERIFIED_WEBHOOK",
  "PROVIDER_READ_BACK"
] as const;
export type AirenPayReconciliationEvidenceChannel = (typeof AIRENPAY_RECONCILIATION_EVIDENCE_CHANNELS)[number];

export type AirenPayReconciliationEvidenceV1 = Readonly<{
  channel: AirenPayReconciliationEvidenceChannel;
  providerReference: string;
  observedStatus: string;
  observedAt: string;
  correlationId: string;
}>;

export type AirenPayReconciliationCaseV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId?: UUID;
  providerConnectionId: UUID;
  orchestrationId?: UUID;
  providerReference: string;
  status: AirenPayReconciliationStatus;
  evidence: readonly AirenPayReconciliationEvidenceV1[];
  reason?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type AirenPayReconciliationDecisionV1 = Readonly<{
  status: AirenPayReconciliationStatus;
  reason?: string;
}>;

export function decideAirenPayReconciliationV1(
  evidence: readonly AirenPayReconciliationEvidenceV1[]
): AirenPayReconciliationDecisionV1 {
  if (evidence.length === 0) return { status: "PENDING" };

  const readBack = evidence.find((item) => item.channel === "PROVIDER_READ_BACK");
  if (!readBack) return { status: "PENDING", reason: "PROVIDER_READ_BACK_REQUIRED" };

  const statuses = new Set(evidence.map((item) => item.observedStatus));
  if (statuses.size === 1) return { status: "IN_SYNC" };

  return {
    status: "DIVERGED",
    reason: "EVIDENCE_STATUS_MISMATCH"
  };
}

export interface AirenPayReconciliationPort {
  reconcileProviderObject(input: Readonly<{
    tenantId: UUID;
    locationId?: UUID;
    providerConnectionId: UUID;
    orchestrationId?: UUID;
    providerReference: string;
    correlationId: string;
  }>): Promise<AirenPayReconciliationCaseV1>;
}
