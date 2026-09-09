export const CRM_DONOR_FORBIDDEN_FIELDS = Object.freeze([
  "id", "tenant_id", "location_id", "created_by_id", "qr_token",
  "phone_raw", "phone", "email", "name", "promoter_id", "promoter_code",
  "source_event_id", "source_event_title", "stripe_customer_id", "payment_method_id",
] as const);

export type PortableCrmRecoveryPattern = Readonly<{
  customerProfileLookup: true;
  tags: true;
  visitMetrics: true;
  loyaltyLedgerRequired: true;
  consentLedgerRequired: true;
  feedbackTokenSingleUseRequired: true;
  donorRecordsMigrated: false;
}>;

export const REC004_CRM_RECOVERY_EVIDENCE = Object.freeze({
  donor: "ex-corte",
  donorMode: "RECOVERY_DONOR_ONLY",
  recoveredPatterns: Object.freeze([
    "customer-profile-lookup",
    "tags-and-visit-concepts",
    "customer-pass-loyalty-ux",
    "voucher-lifecycle-concept",
    "feedback-workflow-concept",
  ]),
  rejectedAuthority: CRM_DONOR_FORBIDDEN_FIELDS,
  canonicalRefactors: Object.freeze([
    "party-relationship-projection",
    "append-oriented-consent-and-safety-facts",
    "loyalty-ledger-not-counter-authority",
    "single-use-feedback-token",
    "airenos-security-context",
    "server-side-mutations",
    "idempotency-and-row-version",
  ]),
  acceptanceTests: Object.freeze(["GJ2-006", "GJ2-007", "GJ2-011", "GJ2-032"]),
  runtimeState: "RUNTIME_PENDING",
});

export function recoverPortableCrmPattern(input: Record<string, unknown>): PortableCrmRecoveryPattern {
  for (const field of CRM_DONOR_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) throw new Error(`REC004_FORBIDDEN_DONOR_DATA:${field}`);
  }
  return Object.freeze({
    customerProfileLookup: true,
    tags: true,
    visitMetrics: true,
    loyaltyLedgerRequired: true,
    consentLedgerRequired: true,
    feedbackTokenSingleUseRequired: true,
    donorRecordsMigrated: false,
  });
}
