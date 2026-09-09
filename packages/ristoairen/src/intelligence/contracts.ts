import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";

export const INTELLIGENCE_KINDS = ["DECISION_PROPOSAL", "FORECAST", "ANOMALY"] as const;
export type IntelligenceKind = (typeof INTELLIGENCE_KINDS)[number];

export const PROPOSAL_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "INVALIDATED", "APPLIED"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type IntelligenceEvidenceV1 = Readonly<{
  sourceDomain: string;
  sourceReference: string;
  sourceRowVersion?: number;
  evidenceHash: string;
  observedAt: string;
}>;

export type DecisionProposalV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId?: UUID;
  subjectDomain: string;
  subjectReference: string;
  recommendation: string;
  rationale: string;
  status: ProposalStatus;
  evidence: readonly IntelligenceEvidenceV1[];
  targetRowVersion?: number;
  rowVersion: number;
}>;

export type CreateDecisionProposalInputV1 = Readonly<{
  subjectDomain: string;
  subjectReference: string;
  recommendation: string;
  rationale: string;
  evidence: readonly IntelligenceEvidenceV1[];
  targetRowVersion?: number;
}>;

export type ReviewDecisionProposalInputV1 = Readonly<{
  proposalId: UUID;
  decision: "APPROVE" | "REJECT";
  expectedRowVersion: number;
}>;

export type ApplyDecisionProposalInputV1 = Readonly<{
  proposalId: UUID;
  expectedProposalRowVersion: number;
  expectedTargetRowVersion?: number;
}>;

export type ForecastProjectionV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId?: UUID;
  subjectDomain: string;
  subjectReference: string;
  horizon: string;
  value: number;
  confidence: number;
  evidenceHash: string;
  generatedAt: string;
}>;

export type AnomalyProjectionV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId?: UUID;
  subjectDomain: string;
  subjectReference: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  summary: string;
  evidenceHash: string;
  detectedAt: string;
}>;

export interface IntelligenceProductAccessGuard {
  assertRistoAirenAccess(context: SecurityContext): void | Promise<void>;
  assertIntelligenceAccess(context: SecurityContext): void | Promise<void>;
}

export interface IntelligenceEvidenceRepository {
  createDecisionProposal(context: SecurityContext, input: CreateDecisionProposalInputV1, idempotencyKey: string): Promise<{ proposalId: UUID; replayed: boolean }>;
  reviewDecisionProposal(context: SecurityContext, input: ReviewDecisionProposalInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
  markProposalApplied(context: SecurityContext, input: ApplyDecisionProposalInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
  recordForecast(context: SecurityContext, input: Omit<ForecastProjectionV1, "id" | "tenantId">, idempotencyKey: string): Promise<{ forecastId: UUID; replayed: boolean }>;
  recordAnomaly(context: SecurityContext, input: Omit<AnomalyProjectionV1, "id" | "tenantId">, idempotencyKey: string): Promise<{ anomalyId: UUID; replayed: boolean }>;
}

export interface GovernedProposalTargetService {
  applyApprovedProposal(context: SecurityContext, input: ApplyDecisionProposalInputV1, idempotencyKey: string): Promise<void>;
}
