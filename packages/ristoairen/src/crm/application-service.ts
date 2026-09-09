import type { SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { ConsentFactInputV1, CrmApplicationRepository, CrmProductAccessGuard, CustomerFactInputV1, CustomerFeedbackInputV1, LoyaltyMutationInputV1, VoucherMutationInputV1 } from "./contracts.ts";
import { requireCrmWrite, validateConsentFact, validateCustomerFact, validateCustomerFeedback, validateLoyaltyMutation, validateVoucherMutation } from "./policy.ts";

function requireIdempotencyKey(value: string): string {
  const key = value?.trim();
  if (!key) throw new Error("MISSING_IDEMPOTENCY_KEY");
  return key;
}

export class CrmApplicationService {
  constructor(private readonly repo: CrmApplicationRepository, private readonly access: CrmProductAccessGuard) {}

  async upsertParty(context: SecurityContext, input: Readonly<{ displayName: string; phone?: string; email?: string; sourceReference: string }>, idempotencyKey: string) {
    requireCrmWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.upsertPartyFromServiceInteraction(context, Object.freeze({ ...input }), requireIdempotencyKey(idempotencyKey));
  }

  async recordConsent(context: SecurityContext, input: ConsentFactInputV1, idempotencyKey: string) {
    requireCrmWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.recordConsentFact(context, validateConsentFact(input), requireIdempotencyKey(idempotencyKey));
  }

  async recordFact(context: SecurityContext, input: CustomerFactInputV1, idempotencyKey: string) {
    requireCrmWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.recordCustomerFact(context, validateCustomerFact(input), requireIdempotencyKey(idempotencyKey));
  }

  async earnLoyalty(context: SecurityContext, input: LoyaltyMutationInputV1, idempotencyKey: string) {
    requireCrmWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.appendLoyaltyEntry(context, validateLoyaltyMutation(input), "EARN", requireIdempotencyKey(idempotencyKey));
  }

  async redeemLoyalty(context: SecurityContext, input: LoyaltyMutationInputV1, idempotencyKey: string) {
    requireCrmWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.appendLoyaltyEntry(context, validateLoyaltyMutation(input), "REDEEM", requireIdempotencyKey(idempotencyKey));
  }

  async issueVoucher(context: SecurityContext, input: VoucherMutationInputV1, idempotencyKey: string) {
    requireCrmWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.mutateVoucher(context, validateVoucherMutation(input), "ISSUE", requireIdempotencyKey(idempotencyKey));
  }

  async redeemVoucher(context: SecurityContext, input: VoucherMutationInputV1, idempotencyKey: string) {
    requireCrmWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.mutateVoucher(context, validateVoucherMutation(input), "REDEEM", requireIdempotencyKey(idempotencyKey));
  }

  async submitFeedback(context: SecurityContext | null, input: CustomerFeedbackInputV1, idempotencyKey: string) {
    if (context) await this.access.assertRistoAirenAccess(context);
    return this.repo.submitFeedback(context, validateCustomerFeedback(input), requireIdempotencyKey(idempotencyKey));
  }
}
