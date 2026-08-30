import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTHORITY_WEIGHT,
  assertKnowledgeCoordinate,
  assertSecretExclusionAttested,
  assertSha256,
  authorityWeight,
  normalizeKnowledgeSearchRequest,
} from "../../packages/kairos/src/index.ts";

test("K3-A authority ranking preserves governed precedence", () => {
  assert.equal(authorityWeight("GOVERNANCE_BINDING"), 120);
  assert.equal(authorityWeight("CURRENT_CANONICAL"), 115);
  assert.ok(AUTHORITY_WEIGHT.CERTIFIED > AUTHORITY_WEIGHT.EVIDENCE);
  assert.ok(AUTHORITY_WEIGHT.EVIDENCE > AUTHORITY_WEIGHT.HISTORICAL);
  assert.ok(AUTHORITY_WEIGHT.HISTORICAL > AUTHORITY_WEIGHT.SUPERSEDED);
  assert.ok(AUTHORITY_WEIGHT.SUPERSEDED > AUTHORITY_WEIGHT.DRAFT);
});

test("K3-A stable AIRenOS coordinate validation is provider independent", () => {
  assert.equal(assertKnowledgeCoordinate(" aos.risto.booking.airenpay.d4c "), "AOS.RISTO.BOOKING.AIRENPAY.D4C");
  assert.throws(() => assertKnowledgeCoordinate("drive://some-file"), /Invalid Kairos knowledge coordinate/);
  assert.throws(() => assertKnowledgeCoordinate("AOS"), /Invalid Kairos knowledge coordinate/);
});

test("K3-A source revision requires secret-exclusion attestation", () => {
  assert.doesNotThrow(() => assertSecretExclusionAttested({ secretScanStatus: "PASS", containsSecretValues: false }));
  assert.throws(
    () => assertSecretExclusionAttested({ secretScanStatus: "PASS", containsSecretValues: true as false }),
    /not eligible for ingestion/,
  );
  assert.throws(
    () => assertSecretExclusionAttested({ secretScanStatus: "REJECTED" as "PASS", containsSecretValues: false }),
    /not eligible for ingestion/,
  );
});

test("K3-A search request is normalized and bounded before retrieval", () => {
  assert.deepEqual(normalizeKnowledgeSearchRequest({ query: "  AIRenPay capture  " }), { query: "AIRenPay capture", limit: 20 });
  assert.deepEqual(normalizeKnowledgeSearchRequest({ query: "Booking", limit: 7 }), { query: "Booking", limit: 7 });
  assert.throws(() => normalizeKnowledgeSearchRequest({ query: "x" }), /between 2 and 512/);
  assert.throws(() => normalizeKnowledgeSearchRequest({ query: "Booking", limit: 0 }), /between 1 and 50/);
  assert.throws(() => normalizeKnowledgeSearchRequest({ query: "Booking", limit: 51 }), /between 1 and 50/);
});

test("K3-A SHA-256 source revision fingerprint is exact", () => {
  const digest = "a".repeat(64);
  assert.equal(assertSha256(digest.toUpperCase()), digest);
  assert.throws(() => assertSha256("abc"), /Invalid SHA-256/);
});
