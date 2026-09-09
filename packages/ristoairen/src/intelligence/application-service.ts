import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { ApplyDecisionProposalInputV1, CreateDecisionProposalInputV1, GovernedProposalTargetService, IntelligenceEvidenceRepository, IntelligenceProductAccessGuard, ReviewDecisionProposalInputV1 } from "./contracts.ts";
import { requireIntelligenceWrite, validateCreateDecisionProposal, validateProposalApply, validateProposalReview } from "./policy.ts";

function requireIdempotencyKey(idempotencyKey: string): string {
  const key = idempotencyKey?.trim();
  if (!key) throw new AppError("VALIDATION_FAILED", "IDEMPOTENCY_KEY_REQUIRED");
  return key;
}

export class StellaDecisionIntelligenceService {
  constructor(
    private readonly repository: IntelligenceEvidenceRepository,
    private readonly access: IntelligenceProductAccessGuard,
    private readonly targetService: GovernedProposalTargetService,
  ) {}

  async propose(context: SecurityContext, input: CreateDecisionProposalInputV1, idempotencyKey: string) {
    requireIntelligenceWrite(context);
    await this.access.assertRistoAirenAccess(context);
    await this.access.assertIntelligenceAccess(context);
    return this.repository.createDecisionProposal(context, validateCreateDecisionProposal(input), requireIdempotencyKey(idempotencyKey));
  }

  async review(context: SecurityContext, input: ReviewDecisionProposalInputV1, idempotencyKey: string) {
    requireIntelligenceWrite(context);
    await this.access.assertRistoAirenAccess(context);
    await this.access.assertIntelligenceAccess(context);
    return this.repository.reviewDecisionProposal(context, validateProposalReview(input), requireIdempotencyKey(idempotencyKey));
  }

  async applyApproved(context: SecurityContext, input: ApplyDecisionProposalInputV1, idempotencyKey: string) {
    requireIntelligenceWrite(context);
    await this.access.assertRistoAirenAccess(context);
    await this.access.assertIntelligenceAccess(context);
    const validated = validateProposalApply(input);
    const key = requireIdempotencyKey(idempotencyKey);
    // The target domain service owns final authorization and Core mutation.
    await this.targetService.applyApprovedProposal(context, validated, key);
    return this.repository.markProposalApplied(context, validated, key);
  }
}
