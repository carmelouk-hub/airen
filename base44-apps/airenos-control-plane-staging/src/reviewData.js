export const governanceState = Object.freeze({
  artifactClass: "WORKING_FUTURE_PROPOSAL_NOT_CANONICAL",
  state: "GOVERNED_DESIGN",
  designPhaseAuthorized: true,
  implementationAuthorized: false,
  canonicalPromotionAuthorized: false,
  fixtureClass: "SYNTHETIC_REVIEW_ONLY",
});

export const customerReviewClaims = Object.freeze([
  {
    subject: "Declared service preference",
    state: "CONFIRMED",
    evidence: "Synthetic direct declaration",
    guardrail: "Illustrative purpose only; purpose catalog remains unapproved",
  },
  {
    subject: "Observed operational pattern",
    state: "PROPOSED",
    evidence: "Synthetic certified-event sequence",
    guardrail: "Must remain an expiring hypothesis and cannot trigger an action",
  },
  {
    subject: "Corrected communication preference",
    state: "SUPERSEDED",
    evidence: "Synthetic correction event",
    guardrail: "History is preserved; the previous claim is not silently overwritten",
  },
]);

export const supplierReviewClaims = Object.freeze([
  {
    subject: "Delivery timeliness hypothesis",
    state: "PROPOSED",
    evidence: "Synthetic typed delivery events",
    guardrail: "No universal score and no automatic supplier penalty",
  },
  {
    subject: "Documented certification validity",
    state: "CONFIRMED",
    evidence: "Synthetic verifiable document",
    guardrail: "Validity and expiry must remain visible and contestable",
  },
  {
    subject: "Price-history stability hypothesis",
    state: "PROPOSED",
    evidence: "Synthetic versioned price observations",
    guardrail: "No silent overwrite and no autonomous procurement decision",
  },
]);

export const purposeReviewCatalog = Object.freeze([
  {
    id: "PUR-CUST-SERVICE-CONTINUITY-v0",
    label: "Service continuity",
    subject: "Customer · trusted Tenant/Location workflow",
    operation: "Minimized read · action proposal",
    legalBasis: "TBD legal review",
    reviewState: "NOT STARTED",
    status: "DISABLED",
  },
  {
    id: "PUR-CUST-DECLARED-PREFERENCE-v0",
    label: "Declared preference",
    subject: "Verified customer · same-Tenant relationship",
    operation: "Declare · read own · correct",
    legalBasis: "TBD legal review",
    reviewState: "PACKET READY",
    decisionFormState: "FORM READY",
    qualifiedDecision: "NOT RECORDED",
    status: "DISABLED",
  },
  {
    id: "PUR-CUST-FEEDBACK-CORRECTION-v0",
    label: "Feedback & correction",
    subject: "Verified customer · governed case",
    operation: "Feedback · contest · revoke",
    legalBasis: "TBD legal review",
    reviewState: "NOT STARTED",
    status: "DISABLED",
  },
  {
    id: "PUR-SUP-DELIVERY-QUALITY-v0",
    label: "Delivery quality",
    subject: "Supplier · same-Tenant evidence",
    operation: "Read evidence · propose claim",
    legalBasis: "TBD where personal data applies",
    reviewState: "NOT STARTED",
    status: "DISABLED",
  },
  {
    id: "PUR-SUP-DOCUMENT-VALIDITY-v0",
    label: "Document validity",
    subject: "Supplier · verified document context",
    operation: "Read validity · propose alert",
    legalBasis: "TBD where personal data applies",
    reviewState: "NOT STARTED",
    status: "DISABLED",
  },
  {
    id: "PUR-SUP-PROCUREMENT-SCENARIO-v0",
    label: "Procurement scenario",
    subject: "Supplier · minimized organizational data",
    operation: "Read Twin · explain proposal",
    legalBasis: "TBD where personal data applies",
    reviewState: "NOT STARTED",
    status: "DISABLED",
  },
]);

export const declaredPreferenceEvidenceStatus = Object.freeze({
  indexState: "INDEX v0.2 READY",
  required: 12,
  ready: 0,
  partial: 4,
  missing: 8,
  r01CaptureState: "CAPTURE READY",
  r01RequirementState: "PARTIAL",
  exactJourneyVerified: false,
  factualOwnerState: "UNASSIGNED",
  qualifiedDecision: "NOT RECORDED",
  purposeState: "DISABLED",
});

export const acceptanceChecks = Object.freeze([
  "Every claim is traceable to evidence and method/version",
  "An AI claim is never returned as a confirmed fact",
  "Revocation applies fail-closed to future governed uses",
  "Cross-Tenant data remains invisible, including to STELLA",
  "Purpose changes invalidate derived cursors and caches",
  "Sensitive data uses a dedicated contract and permission",
  "Correction and contestation preserve audit and supersede evidence",
  "Customer and supplier actions use governed application services",
  "No significant decision executes only from a score",
  "A Relationship Passport shares selected revocable claims only",
  "Retention, anonymization and export remain testable",
  "All tests use synthetic fixtures only",
]);

export const openDecisions = Object.freeze([
  "Shared AIRenOS primitives versus vertical logic",
  "Purpose catalog and lawful-basis matrix",
  "Identity, deduplication and subject-rights model",
  "Field classification and forbidden-inference catalog",
  "Retention, expiry, revocation and anonymization",
  "Relationship Passport trust and portability protocol",
  "Human-approval thresholds and significant decisions",
  "Supplier correction and contestation policy",
  "Entitlements, quotas, plans and commercial ownership",
  "DPIA, legal review and threat model",
]);
