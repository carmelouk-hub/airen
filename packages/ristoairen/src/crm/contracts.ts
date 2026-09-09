import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";

export const CONSENT_PURPOSES = ["SERVICE", "MARKETING", "PROFILING"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_STATUSES = ["GRANTED", "WITHDRAWN"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CUSTOMER_FACT_KINDS = ["PREFERENCE", "ALLERGY", "SAFETY_NOTE"] as const;
export type CustomerFactKind = (typeof CUSTOMER_FACT_KINDS)[number];

export const LOYALTY_ENTRY_KINDS = ["EARN", "REDEEM", "REVERSAL", "ADJUSTMENT"] as const;
export type LoyaltyEntryKind = (typeof LOYALTY_ENTRY_KINDS)[number];

export type PartyProjectionV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  displayName: string;
  phoneMasked?: string;
  emailMasked?: string;
  tags: readonly string[];
  firstVisitAt?: string;
  lastVisitAt?: string;
  visitCount: number;
  rowVersion: number;
}>;

export type ConsentFactInputV1 = Readonly<{
  partyId: UUID;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  provenance: string;
  expectedPartyRowVersion: number;
}>;

export type CustomerFactInputV1 = Readonly<{
  partyId: UUID;
  kind: CustomerFactKind;
  value: string;
  provenance: string;
  expectedPartyRowVersion: number;
}>;

export type LoyaltyLedgerEntryV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  partyId: UUID;
  kind: LoyaltyEntryKind;
  pointsDelta: number;
  sourceReference: string;
  occurredAt: string;
}>;

export type LoyaltyMutationInputV1 = Readonly<{
  partyId: UUID;
  points: number;
  sourceReference: string;
  expectedPartyRowVersion: number;
}>;

export type VoucherMutationInputV1 = Readonly<{
  voucherId: UUID;
  partyId?: UUID;
  valueMinor: number;
  currency: string;
  expectedRowVersion: number;
}>;

export type CustomerFeedbackInputV1 = Readonly<{
  partyId?: UUID;
  token: string;
  rating: number;
  comment?: string;
}>;

export interface CrmProductAccessGuard {
  assertRistoAirenAccess(context: SecurityContext): void | Promise<void>;
}

export interface CrmApplicationRepository {
  upsertPartyFromServiceInteraction(context: SecurityContext, input: Readonly<{ displayName: string; phone?: string; email?: string; sourceReference: string }>, idempotencyKey: string): Promise<{ partyId: UUID; replayed: boolean }>;
  recordConsentFact(context: SecurityContext, input: ConsentFactInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
  recordCustomerFact(context: SecurityContext, input: CustomerFactInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
  appendLoyaltyEntry(context: SecurityContext, input: LoyaltyMutationInputV1, kind: LoyaltyEntryKind, idempotencyKey: string): Promise<{ entryId: UUID; replayed: boolean }>;
  mutateVoucher(context: SecurityContext, input: VoucherMutationInputV1, action: "ISSUE" | "REDEEM", idempotencyKey: string): Promise<{ replayed: boolean }>;
  submitFeedback(context: SecurityContext | null, input: CustomerFeedbackInputV1, idempotencyKey: string): Promise<{ feedbackId: UUID; replayed: boolean }>;
}
