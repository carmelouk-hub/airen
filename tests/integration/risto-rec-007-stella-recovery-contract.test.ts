import test from "node:test";
import assert from "node:assert/strict";
import {
  REC007_STELLA_RECOVERY_EVIDENCE,
  STELLA_AUTHORITY_RULES,
  STELLA_DONOR_FORBIDDEN_FIELDS,
  recoverPortableStellaPattern,
  validateCreateDecisionProposal,
  validateProposalApply,
  validateProposalReview,
} from "../../packages/ristoairen/src/intelligence/index.ts";

test("REC-007 recovers STELLA semantics without donor records or authority", () => {
  const recovered = recoverPortableStellaPattern({ supports_intelligence: true });
  assert.equal(recovered.tenantScopedContext, true);
  assert.equal(recovered.proposalLifecycleRequired, true);
  assert.equal(recovered.directCoreWriteAllowed, false);
  assert.equal(recovered.donorRecordsMigrated, false);
});

test("REC-007 rejects donor tenant, identity, provider and STELLA record authority", () => {
  for (const field of STELLA_DONOR_FORBIDDEN_FIELDS) {
    assert.throws(() => recoverPortableStellaPattern({ [field]: "legacy-value" }), new RegExp(`REC007_FORBIDDEN_DONOR_DATA:${field}`));
  }
});

test("REC-007 requires evidence-backed decision proposals", () => {
  const proposal = validateCreateDecisionProposal({
    subjectDomain: "C013",
    subjectReference: "register-1",
    recommendation: "Review settlement variance",
    rationale: "Observed variance exceeds threshold",
    evidence: [{ sourceDomain: "C013", sourceReference: "zreport-1", evidenceHash: "sha256:test", observedAt: "2026-09-09T23:30:00+02:00" }],
    targetRowVersion: 4,
  });
  assert.equal(proposal.subjectDomain, "C013");
  assert.throws(() => validateCreateDecisionProposal({ subjectDomain: "C013", subjectReference: "x", recommendation: "r", rationale: "why", evidence: [] }));
});

test("REC-007 approval and apply require optimistic concurrency", () => {
  assert.equal(validateProposalReview({ proposalId: "p-1", decision: "APPROVE", expectedRowVersion: 2 }).decision, "APPROVE");
  assert.throws(() => validateProposalReview({ proposalId: "p-1", decision: "APPROVE", expectedRowVersion: -1 }));
  assert.equal(validateProposalApply({ proposalId: "p-1", expectedProposalRowVersion: 3, expectedTargetRowVersion: 8 }).expectedTargetRowVersion, 8);
  assert.throws(() => validateProposalApply({ proposalId: "p-1", expectedProposalRowVersion: 3, expectedTargetRowVersion: -1 }));
});

test("REC-007 freezes STELLA as advisory-only", () => {
  assert.equal(STELLA_AUTHORITY_RULES.directCoreWriteAllowed, false);
  assert.equal(STELLA_AUTHORITY_RULES.selfApprovalAllowed, false);
  assert.equal(STELLA_AUTHORITY_RULES.selfApplyAllowed, false);
  assert.equal(STELLA_AUTHORITY_RULES.targetServiceReauthorizationRequired, true);
  assert.deepEqual(STELLA_AUTHORITY_RULES.highRiskHumanApprovalDomains, ["C002", "C013", "C017", "C018"]);
});

test("REC-007 acceptance obligations remain runtime-pending", () => {
  assert.deepEqual(REC007_STELLA_RECOVERY_EVIDENCE.acceptanceTests, ["GJ2-026", "GJ2-027", "GJ2-039"]);
  assert.equal(REC007_STELLA_RECOVERY_EVIDENCE.runtimeState, "RUNTIME_PENDING");
});
