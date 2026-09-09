import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { ApplyDecisionProposalInputV1, CreateDecisionProposalInputV1, ReviewDecisionProposalInputV1 } from "./contracts.ts";

export function requireIntelligenceWrite(context: SecurityContext): void {
  if (!context.tenantId || !context.actorIdentityId) throw new AppError("FORBIDDEN", "MISSING_SECURITY_SCOPE");
}

export function validateCreateDecisionProposal(input: CreateDecisionProposalInputV1): CreateDecisionProposalInputV1 {
  if (!input.subjectDomain?.trim() || !input.subjectReference?.trim() || !input.recommendation?.trim() || !input.rationale?.trim()) {
    throw new AppError("VALIDATION_FAILED", "INVALID_DECISION_PROPOSAL");
  }
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw new AppError("VALIDATION_FAILED", "EVIDENCE_REQUIRED");
  for (const evidence of input.evidence) {
    if (!evidence.sourceDomain?.trim() || !evidence.sourceReference?.trim() || !evidence.evidenceHash?.trim() || !evidence.observedAt?.trim()) {
      throw new AppError("VALIDATION_FAILED", "INVALID_EVIDENCE");
    }
  }
  return Object.freeze({ ...input, subjectDomain: input.subjectDomain.trim(), subjectReference: input.subjectReference.trim(), recommendation: input.recommendation.trim(), rationale: input.rationale.trim() });
}

export function validateProposalReview(input: ReviewDecisionProposalInputV1): ReviewDecisionProposalInputV1 {
  if (!input.proposalId || !["APPROVE", "REJECT"].includes(input.decision)) throw new AppError("VALIDATION_FAILED", "INVALID_PROPOSAL_REVIEW");
  if (!Number.isInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_PROPOSAL_ROW_VERSION");
  return Object.freeze({ ...input });
}

export function validateProposalApply(input: ApplyDecisionProposalInputV1): ApplyDecisionProposalInputV1 {
  if (!input.proposalId) throw new AppError("VALIDATION_FAILED", "MISSING_PROPOSAL_ID");
  if (!Number.isInteger(input.expectedProposalRowVersion) || input.expectedProposalRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_PROPOSAL_ROW_VERSION");
  if (input.expectedTargetRowVersion !== undefined && (!Number.isInteger(input.expectedTargetRowVersion) || input.expectedTargetRowVersion < 0)) {
    throw new AppError("VALIDATION_FAILED", "INVALID_TARGET_ROW_VERSION");
  }
  return Object.freeze({ ...input });
}

export const STELLA_AUTHORITY_RULES = Object.freeze({
  directCoreWriteAllowed: false,
  selfApprovalAllowed: false,
  selfApplyAllowed: false,
  targetServiceReauthorizationRequired: true,
  staleTargetInvalidatesProposal: true,
  highRiskHumanApprovalDomains: Object.freeze(["C002", "C013", "C017", "C018"]),
});
