import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptanceChecks,
  customerReviewClaims,
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
