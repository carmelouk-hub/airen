import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { ConsentFactInputV1, CustomerFactInputV1, CustomerFeedbackInputV1, LoyaltyMutationInputV1, VoucherMutationInputV1 } from "./contracts.ts";

export function requireCrmWrite(context: SecurityContext): void {
  if (!context.tenantId || !context.actorIdentityId) throw new AppError("FORBIDDEN", "MISSING_SECURITY_SCOPE");
}

export function validateConsentFact(input: ConsentFactInputV1): ConsentFactInputV1 {
  if (!input.partyId || !input.provenance?.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_CONSENT_FACT");
  if (!Number.isInteger(input.expectedPartyRowVersion) || input.expectedPartyRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_PARTY_ROW_VERSION");
  return Object.freeze({ ...input, provenance: input.provenance.trim() });
}

export function validateCustomerFact(input: CustomerFactInputV1): CustomerFactInputV1 {
  if (!input.partyId || !input.value?.trim() || !input.provenance?.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_CUSTOMER_FACT");
  if (!Number.isInteger(input.expectedPartyRowVersion) || input.expectedPartyRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_PARTY_ROW_VERSION");
  return Object.freeze({ ...input, value: input.value.trim(), provenance: input.provenance.trim() });
}

export function validateLoyaltyMutation(input: LoyaltyMutationInputV1): LoyaltyMutationInputV1 {
  if (!input.partyId || !input.sourceReference?.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_LOYALTY_REFERENCE");
  if (!Number.isInteger(input.points) || input.points <= 0) throw new AppError("VALIDATION_FAILED", "INVALID_LOYALTY_POINTS");
  if (!Number.isInteger(input.expectedPartyRowVersion) || input.expectedPartyRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_PARTY_ROW_VERSION");
  return Object.freeze({ ...input, sourceReference: input.sourceReference.trim() });
}

export function validateVoucherMutation(input: VoucherMutationInputV1): VoucherMutationInputV1 {
  if (!input.voucherId || !Number.isInteger(input.valueMinor) || input.valueMinor <= 0) throw new AppError("VALIDATION_FAILED", "INVALID_VOUCHER_VALUE");
  if (!input.currency || input.currency.length !== 3) throw new AppError("VALIDATION_FAILED", "INVALID_CURRENCY");
  if (!Number.isInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_VOUCHER_ROW_VERSION");
  return Object.freeze({ ...input });
}

export function validateCustomerFeedback(input: CustomerFeedbackInputV1): CustomerFeedbackInputV1 {
  if (!input.token?.trim()) throw new AppError("VALIDATION_FAILED", "MISSING_FEEDBACK_TOKEN");
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new AppError("VALIDATION_FAILED", "INVALID_FEEDBACK_RATING");
  return Object.freeze({ ...input, token: input.token.trim(), comment: input.comment?.trim() || undefined });
}
