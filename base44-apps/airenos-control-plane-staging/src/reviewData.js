export const governanceState = Object.freeze({
  artifactClass: "WORKING_FUTURE_PROPOSAL_NOT_CANONICAL",
  state: "DESIGNING",
  implementationAuthorized: false,
  promotionAuthorized: false,
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
