import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const c = JSON.parse(fs.readFileSync(new URL('../contracts/foundation-experience-typed-exchange.design.json', import.meta.url)));

const pipeline = [
  'validate input','resolve actor','resolve trusted Tenant/Location','permission','entitlement','purpose authorization','transaction','domain validation','idempotency','audit','outbox','typed result'
];

test('typed exchange remains design-only and provider-neutral', () => {
  assert.equal(c.artifact_class, 'DESIGN_ONLY_NOT_RUNTIME');
  assert.equal(c.provider_neutral, true);
  assert.equal(c.runtime_implementation_authorized, false);
  assert.equal(c.schema_authorized, false);
  assert.equal(c.production_publication_authorized, false);
});

test('Foundation remains the only authority boundary', () => {
  assert.equal(c.authority.foundation_remains_authoritative, true);
  assert.equal(c.authority.experience_layer_is_authority, false);
  assert.equal(c.authority.provider_identity_is_authority, false);
  assert.equal(c.authority.client_supplied_tenant_authority, false);
  assert.equal(c.authority.client_supplied_location_authority, false);
});

test('governed projection is read-only, bounded and expiring', () => {
  assert.equal(c.projection_envelope.direction, 'FOUNDATION_TO_EXPERIENCE');
  assert.equal(c.projection_envelope.mode, 'READ_ONLY_GOVERNED_PROJECTION');
  assert.equal(c.projection_envelope.direct_source_table_reads_allowed, false);
  assert.equal(c.projection_envelope.direct_domain_writes_allowed, false);
  assert.equal(c.projection_envelope.unbounded_payload_allowed, false);
  assert.equal(c.projection_envelope.expired_projection_usable, false);
  for (const f of ['tenant_ref','purpose_ref','authorization_ref','source_event_refs','expires_at','allowed_fields','payload_classification','correlation_id','integrity_ref']) assert.ok(c.projection_envelope.required_fields.includes(f));
});

test('action proposal cannot execute or assert trusted scope', () => {
  assert.equal(c.action_proposal_envelope.direction, 'EXPERIENCE_TO_FOUNDATION');
  assert.equal(c.action_proposal_envelope.mode, 'ACTION_PROPOSAL_ONLY');
  assert.equal(c.action_proposal_envelope.direct_execution_authority, false);
  assert.equal(c.action_proposal_envelope.trusted_tenant_or_location_may_be_asserted_by_client, false);
  assert.equal(c.action_proposal_envelope.must_reenter_foundation_pipeline, true);
  assert.equal(c.action_proposal_envelope.proposal_is_authorization_decision, false);
  assert.equal(c.action_proposal_envelope.proposal_is_domain_fact, false);
});

test('denial remains typed, default-deny and non-secret', () => {
  assert.equal(c.typed_denial_result.default_decision, 'DENY');
  assert.equal(c.typed_denial_result.secret_details_allowed, false);
  for (const f of ['decision','reason_code','correlation_id','policy_version','audit_ref']) assert.ok(c.typed_denial_result.required_fields.includes(f));
});

test('full Foundation pipeline is preserved exactly', () => assert.deepEqual(c.foundation_pipeline, pipeline));

test('dangerous shortcuts are explicitly forbidden', () => {
  for (const x of ['direct source-domain table read','direct domain write','provider SDK in Foundation core','client-supplied Tenant authority','client-supplied Location authority','unknown-host fallback','proposal self-authorization','STELLA direct operational write']) assert.ok(c.forbidden_shortcuts.includes(x));
});

test('RistoAIRen runtime gates remain closed', () => {
  assert.equal(c.ristoairen_gate.booking_contract_expansion_authorized, false);
  assert.equal(c.ristoairen_gate.t20_state, 'INCOMPLETE');
  assert.equal(c.ristoairen_gate.t20_implementation_authorized, false);
  assert.equal(c.ristoairen_gate.golden_restaurant_e2e_promotion_authorized, false);
  assert.equal(c.ristoairen_gate.stella_direct_operational_writes_allowed, false);
});
