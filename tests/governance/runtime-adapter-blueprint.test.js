import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spec = JSON.parse(
  fs.readFileSync(new URL('../../machine-context/runtime-adapter-blueprint.v0.1.json', import.meta.url), 'utf8')
);

test('blueprint remains design-only and blocks runtime/schema/production', () => {
  assert.equal(spec.artifact_class, 'GOVERNED_DESIGN_NOT_CANONICAL');
  assert.equal(spec.authorizations.runtime_implementation, false);
  assert.equal(spec.authorizations.schema, false);
  assert.equal(spec.authorizations.production_publication, false);
  assert.equal(spec.gate.runtime_adapter_implementation, 'BLOCKED');
  assert.equal(spec.gate.schema_change, 'BLOCKED');
  assert.equal(spec.gate.production_publication, 'BLOCKED');
});

test('Foundation remains the only authority boundary', () => {
  assert.ok(spec.authority.foundation_is_authoritative_for.includes('tenant'));
  assert.ok(spec.authority.foundation_is_authoritative_for.includes('location'));
  assert.ok(spec.authority.foundation_is_authoritative_for.includes('permissions'));
  assert.ok(spec.authority.foundation_is_authoritative_for.includes('entitlements'));
  assert.deepEqual(spec.authority.experience_provider_is_authoritative_for, []);
});

test('exchange direction preserves governed projection and action proposal semantics', () => {
  assert.equal(spec.exchange_modes.foundation_to_experience, 'READ_ONLY_GOVERNED_PROJECTION');
  assert.equal(spec.exchange_modes.experience_to_foundation, 'ACTION_PROPOSAL_ONLY');
});

test('candidate transport cannot couple provider to Foundation database or mutation authority', () => {
  assert.equal(spec.candidate_transport.direct_database_connectivity, false);
  assert.equal(spec.candidate_transport.provider_webhook_direct_domain_mutation, false);
  assert.equal(spec.candidate_transport.replaceable, true);
});

test('Foundation mutation pipeline preserves exact governed ordering', () => {
  assert.deepEqual(spec.mutation_pipeline, [
    'validate_input',
    'resolve_actor',
    'resolve_trusted_tenant_location',
    'permission',
    'entitlement',
    'purpose_authorization',
    'transaction',
    'domain_validation',
    'idempotency',
    'audit',
    'outbox',
    'typed_result'
  ]);
});

test('proposal cannot claim trusted Tenant or Location authority', () => {
  assert.ok(spec.proposal_forbidden_authority_claims.includes('trusted_tenant_id'));
  assert.ok(spec.proposal_forbidden_authority_claims.includes('trusted_location_id'));
  assert.ok(spec.proposal_forbidden_authority_claims.includes('authorization_decision'));
});

test('mutation idempotency is Foundation-owned and conflict-safe', () => {
  assert.equal(spec.idempotency.required_for_mutations, true);
  assert.equal(spec.idempotency.foundation_owned_decision, true);
  assert.equal(spec.idempotency.same_key_different_semantic_payload, 'IDEMPOTENCY_CONFLICT');
  assert.equal(spec.idempotency.timestamp_alone_is_replay_protection, false);
});

test('timeouts and retries never manufacture success', () => {
  assert.equal(spec.retry_rules.timeout_implies_success, false);
  assert.equal(spec.retry_rules.same_mutation_retry_reuses_idempotency_key, true);
  assert.equal(spec.retry_rules.offline_mutation_queue_authorized, false);
});

test('default authorization result remains DENY', () => {
  assert.equal(spec.default_authorization_result, 'DENY');
  assert.ok(spec.typed_result_states.includes('DENIED'));
});

test('observability cannot become a secret or personal payload store', () => {
  assert.equal(spec.observability.raw_personal_payloads_allowed, false);
  assert.equal(spec.observability.secrets_allowed, false);
  assert.equal(spec.observability.authorization_tokens_allowed, false);
  assert.equal(spec.observability.raw_prompts_allowed, false);
});

test('sensitive compartment and prohibited raw data remain blocked', () => {
  assert.equal(spec.data_boundary.sensitive_compartment_authorized, false);
  for (const forbidden of ['raw_database_rows', 'credentials', 'secrets', 'tokens', 'cross_tenant_enrichment_payloads']) {
    assert.ok(spec.data_boundary.always_forbidden.includes(forbidden));
  }
});

test('rollback and provider replacement are mandatory before promotion', () => {
  assert.equal(spec.rollback.foundation_owned_disable_path_required, true);
  assert.equal(spec.rollback.default_before_promotion, 'OFF');
  assert.equal(spec.rollback.provider_fallback_when_disabled, 'FAIL_CLOSED_READ_ONLY');
  assert.equal(spec.provider_replacement.base44_replaceable_without_foundation_domain_contract_change, true);
  assert.equal(spec.provider_replacement.provider_sdk_in_foundation_core, false);
});
