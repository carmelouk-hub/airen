import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptanceChecks,
  customerReviewClaims,
  declaredPreferenceEvidenceStatus,
  governanceState,
  openDecisions,
  purposeReviewCatalog,
  supplierReviewClaims,
} from "../src/reviewData.js";

test("governed design never implies runtime or canonical authority", () => {
  assert.equal(governanceState.state, "GOVERNED_DESIGN");
  assert.equal(governanceState.designPhaseAuthorized, true);
  assert.equal(governanceState.implementationAuthorized, false);
  assert.equal(governanceState.canonicalPromotionAuthorized, false);
});

test("review fixtures remain explicitly synthetic", () => {
  assert.equal(governanceState.fixtureClass, "SYNTHETIC_REVIEW_ONLY");

  for (const claim of [...customerReviewClaims, ...supplierReviewClaims]) {
    assert.match(claim.evidence, /Synthetic/);
  }
});

test("the complete acceptance and open-decision surfaces remain visible", () => {
  assert.equal(acceptanceChecks.length, 12);
  assert.equal(openDecisions.length, 10);
  assert.ok(acceptanceChecks.includes("An AI claim is never returned as a confirmed fact"));
  assert.ok(openDecisions.includes("DPIA, legal review and threat model"));
});

test("derived review examples are proposals, not confirmed facts", () => {
  const derivedClaims = [...customerReviewClaims, ...supplierReviewClaims].filter(
    (claim) => claim.subject.toLowerCase().includes("hypothesis") || claim.subject.toLowerCase().includes("pattern"),
  );

  assert.ok(derivedClaims.length > 0);
  assert.ok(derivedClaims.every((claim) => claim.state === "PROPOSED"));
});

test("candidate purposes remain disabled until legal and governance review", () => {
  assert.equal(purposeReviewCatalog.length, 6);
  assert.ok(purposeReviewCatalog.every((purpose) => purpose.status === "DISABLED"));
  assert.ok(purposeReviewCatalog.every((purpose) => purpose.legalBasis.toLowerCase().includes("tbd")));
});

test("a ready review packet does not activate the declared-preference purpose", () => {
  const packetReadyPurposes = purposeReviewCatalog.filter((purpose) => purpose.reviewState === "PACKET READY");

  assert.equal(packetReadyPurposes.length, 1);
  assert.equal(packetReadyPurposes[0].id, "PUR-CUST-DECLARED-PREFERENCE-v0");
  assert.equal(packetReadyPurposes[0].status, "DISABLED");
  assert.match(packetReadyPurposes[0].legalBasis, /TBD/i);
});

test("a ready decision form is not a qualified decision or an activation", () => {
  const declaredPreference = purposeReviewCatalog.find(
    (purpose) => purpose.id === "PUR-CUST-DECLARED-PREFERENCE-v0",
  );

  assert.equal(declaredPreference.decisionFormState, "FORM READY");
  assert.equal(declaredPreference.qualifiedDecision, "NOT RECORDED");
  assert.equal(declaredPreference.status, "DISABLED");
  assert.notEqual(declaredPreference.qualifiedDecision, "APPROVED");
});

test("an indexed evidence bundle remains incomplete and fail-closed", () => {
  assert.equal(declaredPreferenceEvidenceStatus.indexState, "INDEX READY");
  assert.equal(declaredPreferenceEvidenceStatus.required, 12);
  assert.equal(
    declaredPreferenceEvidenceStatus.ready + declaredPreferenceEvidenceStatus.partial + declaredPreferenceEvidenceStatus.missing,
    declaredPreferenceEvidenceStatus.required,
  );
  assert.equal(declaredPreferenceEvidenceStatus.ready, 0);
  assert.equal(declaredPreferenceEvidenceStatus.partial, 4);
  assert.equal(declaredPreferenceEvidenceStatus.missing, 8);
  assert.equal(declaredPreferenceEvidenceStatus.qualifiedDecision, "NOT RECORDED");
  assert.equal(declaredPreferenceEvidenceStatus.purposeState, "DISABLED");
});
