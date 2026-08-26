import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(
  readFileSync(new URL("../contracts/foundation-experience-adapter.design.json", import.meta.url), "utf8")
);

const expectedPipeline = [
  "validate input",
  "resolve actor",
  "resolve trusted Tenant/Location",
  "permission",
  "entitlement",
  "purpose authorization",
  "transaction",
  "domain validation",
  "idempotency",
  "audit",
  "outbox",
  "typed result",
];

test("adapter contract remains design-only and provider-neutral", () => {
  assert.equal(contract.artifact_class, "DESIGN_ONLY_NOT_RUNTIME");
  assert.equal(contract.provider_neutral, true);
  assert.equal(contract.runtime_implementation_authorized, false);
  assert.equal(contract.schema_authorized, false);
  assert.equal(contract.production_publication_authorized, false);
});

test("AIRenOS Foundation remains the sole authority boundary", () => {
  assert.equal(contract.authority.foundation_remains_authoritative, true);
  assert.equal(contract.authority.base44_is_foundation_authority, false);
  assert.equal(contract.authority.client_supplied_tenant_authority, false);
  assert.equal(contract.authority.client_supplied_location_authority, false);
  assert.equal(contract.authority.default_tenant_allowed, false);
  assert.equal(contract.authority.default_location_allowed, false);
  assert.equal(contract.authority.unknown_host_fallback_allowed, false);
});

test("the full Foundation mutation pipeline is preserved exactly", () => {
  assert.deepEqual(contract.foundation_pipeline, expectedPipeline);
});

test("Foundation to experience direction is governed read-only projection", () => {
  assert.equal(contract.foundation_to_experience.mode, "READ_ONLY_GOVERNED_PROJECTION");
  assert.equal(contract.foundation_to_experience.direct_source_table_reads_allowed, false);
  assert.equal(contract.foundation_to_experience.direct_domain_writes_allowed, false);
});

test("experience proposals must re-enter Foundation before execution", () => {
  assert.equal(contract.experience_to_foundation.mode, "ACTION_PROPOSAL_ONLY");
  assert.equal(contract.experience_to_foundation.direct_execution_authority, false);
  assert.equal(contract.experience_to_foundation.must_reenter_foundation_pipeline, true);
  assert.equal(contract.experience_to_foundation.provider_identity_is_authority, false);
});

test("Base44 remains replaceable and gains no operational resources", () => {
  assert.equal(contract.base44_boundary.role, "REVIEW_OR_REPLACEABLE_EXPERIENCE_ADAPTER");
  assert.equal(contract.base44_boundary.provider_sdk_allowed_in_foundation_core, false);
  assert.equal(contract.base44_boundary.custom_domain_entities_authorized, false);
  assert.equal(contract.base44_boundary.backend_functions_authorized, false);
  assert.equal(contract.base44_boundary.connectors_authorized, false);
  assert.equal(contract.base44_boundary.secrets_authorized, false);
});

test("RistoAIRen Booking, T20, Golden and STELLA remain gated", () => {
  assert.equal(contract.ristoairen_boundary.booking_contract_expansion_authorized, false);
  assert.equal(contract.ristoairen_boundary.t20_state, "INCOMPLETE");
  assert.equal(contract.ristoairen_boundary.t20_implementation_authorized, false);
  assert.equal(contract.ristoairen_boundary.golden_restaurant_e2e_promotion_authorized, false);
  assert.equal(contract.ristoairen_boundary.stella_direct_operational_writes_allowed, false);
});

test("direct source-domain coupling remains explicitly forbidden", () => {
  assert.deepEqual(contract.forbidden_direct_domains, [
    "Booking", "Order", "Feedback", "PurchaseOrder", "GoodsReceipt", "customer", "supplier", "STELLA"
  ]);
});
