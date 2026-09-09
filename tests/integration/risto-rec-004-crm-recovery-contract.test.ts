import test from "node:test";
import assert from "node:assert/strict";
import {
  CRM_DONOR_FORBIDDEN_FIELDS,
  REC004_CRM_RECOVERY_EVIDENCE,
  recoverPortableCrmPattern,
  validateConsentFact,
  validateCustomerFact,
  validateCustomerFeedback,
  validateLoyaltyMutation,
} from "../../packages/ristoairen/src/crm/index.ts";

test("REC-004 recovers CRM behavior without donor records", () => {
  const recovered = recoverPortableCrmPattern({ supports_tags: true, supports_loyalty: true });
  assert.equal(recovered.customerProfileLookup, true);
  assert.equal(recovered.loyaltyLedgerRequired, true);
  assert.equal(recovered.consentLedgerRequired, true);
  assert.equal(recovered.donorRecordsMigrated, false);
});

test("REC-004 rejects donor PII, tenant and record authority", () => {
  for (const field of CRM_DONOR_FORBIDDEN_FIELDS) {
    assert.throws(() => recoverPortableCrmPattern({ [field]: "legacy-value" }), new RegExp(`REC004_FORBIDDEN_DONOR_DATA:${field}`));
  }
});

test("REC-004 requires append-oriented consent and safety provenance", () => {
  const consent = validateConsentFact({ partyId: "party-1", purpose: "MARKETING", status: "GRANTED", provenance: "booking-form", expectedPartyRowVersion: 3 });
  assert.equal(consent.provenance, "booking-form");
  const fact = validateCustomerFact({ partyId: "party-1", kind: "ALLERGY", value: "nuts", provenance: "guest-declaration", expectedPartyRowVersion: 3 });
  assert.equal(fact.kind, "ALLERGY");
  assert.throws(() => validateCustomerFact({ partyId: "party-1", kind: "ALLERGY", value: "nuts", provenance: "", expectedPartyRowVersion: 3 }));
});

test("REC-004 validates loyalty ledger mutation rather than balance overwrite", () => {
  const input = validateLoyaltyMutation({ partyId: "party-1", points: 25, sourceReference: "payment-123", expectedPartyRowVersion: 4 });
  assert.equal(input.points, 25);
  assert.throws(() => validateLoyaltyMutation({ partyId: "party-1", points: 0, sourceReference: "payment-123", expectedPartyRowVersion: 4 }));
});

test("REC-004 feedback contract requires single-use token shape and bounded rating", () => {
  const feedback = validateCustomerFeedback({ token: "feedback-token", rating: 5, comment: "Great" });
  assert.equal(feedback.rating, 5);
  assert.throws(() => validateCustomerFeedback({ token: "feedback-token", rating: 6 }));
});

test("REC-004 acceptance obligations remain runtime-pending", () => {
  assert.deepEqual(REC004_CRM_RECOVERY_EVIDENCE.acceptanceTests, ["GJ2-006", "GJ2-007", "GJ2-011", "GJ2-032"]);
  assert.equal(REC004_CRM_RECOVERY_EVIDENCE.runtimeState, "RUNTIME_PENDING");
});
