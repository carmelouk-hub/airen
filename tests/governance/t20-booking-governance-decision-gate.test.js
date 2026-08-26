import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spec = JSON.parse(
  fs.readFileSync(new URL('../../machine-context/t20-booking-governance-decision-gate.v0.1.json', import.meta.url), 'utf8')
);

test('gate authorizes only implementation specification', () => {
  assert.equal(spec.state, 'ACCEPTED_FOR_IMPLEMENTATION_SPEC_ONLY');
  assert.equal(spec.authorizations.implementation_spec, true);
  assert.equal(spec.authorizations.runtime_implementation, false);
  assert.equal(spec.authorizations.schema_migration_execution, false);
  assert.equal(spec.authorizations.production_publication, false);
});

test('Foundation authority remains intact', () => {
  assert.equal(spec.authority.foundation_authoritative, true);
  assert.equal(spec.authority.client_tenant_location_authoritative, false);
  assert.equal(spec.authority.base44_authoritative, false);
  assert.equal(spec.authority.stella_direct_booking_write, false);
  assert.equal(spec.authority.security_context, 'SERVER_DERIVED');
});

test('private Booking query uses a non-colliding canonical candidate id', () => {
  const gap = spec.decisions['GAP-001'];
  assert.equal(gap.function_id, 'RST-F-BKG-007');
  assert.equal(gap.canonical_name, 'booking.private.query');
  assert.equal(gap.permission, 'booking.read');
  assert.equal(gap.raw_persistence_output, false);
});

test('status transition uses least-privilege booking.status.update', () => {
  const gap = spec.decisions['GAP-002'];
  assert.equal(gap.permission, 'booking.status.update');
  assert.equal(gap.generic_update_permission_implies_status, false);
});

test('responsabile is canonical for Slice-01 and implicit aliasing is forbidden', () => {
  const gap = spec.decisions['GAP-003'];
  assert.equal(gap.canonical_role_key, 'responsabile');
  assert.equal(gap.implicit_alias_responsabile_cucina, false);
  assert.deepEqual(gap.grants.responsabile, ['booking.read', 'booking.status.update']);
});

test('Slice-01 has no invented Booking feature entitlement', () => {
  const gap = spec.decisions['GAP-004'];
  assert.equal(gap.booking_feature_entitlement, 'NOT_APPLICABLE_FOR_SLICE_01');
  assert.equal(gap.ristoairen_product_access_required, true);
  assert.equal(gap.risto_booking_example_is_authority, false);
});

test('SecurityContext is accepted without inventing TenantContext', () => {
  const gap = spec.decisions['GAP-005'];
  assert.equal(gap.application_context, 'SecurityContext');
  assert.equal(gap.separate_tenant_context_required, false);
});

test('schema and RLS remain design-only until exact implementation specification', () => {
  assert.equal(spec.decisions['GAP-006'].schema_execution_authorized, false);
  assert.equal(spec.decisions['GAP-009'].server_authorization_required, true);
  assert.equal(spec.decisions['GAP-009'].rls_defense_in_depth_required, true);
  assert.equal(spec.decisions['GAP-009'].rls_replaces_application_authorization, false);
});

test('Booking idempotency is durable and Foundation-owned in semantics', () => {
  const gap = spec.decisions['GAP-007'];
  assert.deepEqual(gap.foundation_owned_durable_idempotency_functions, ['RST-F-BKG-001', 'RST-F-BKG-002', 'RST-F-BKG-003']);
  assert.equal(gap.same_key_different_semantic_payload, 'IDEMPOTENCY_CONFLICT');
  assert.equal(gap.timestamp_alone_replay_protection, false);
});

test('audit and outbox names are typed and secret-free', () => {
  const gap = spec.decisions['GAP-008'];
  assert.deepEqual(gap.audit_events, ['BOOKING_CREATED', 'BOOKING_UPDATED', 'BOOKING_STATUS_CHANGED']);
  assert.deepEqual(gap.outbox_events, ['booking.created.v1', 'booking.updated.v1', 'booking.status_changed.v1']);
  assert.equal(gap.secret_material_allowed, false);
  assert.equal(gap.cross_tenant_payload_allowed, false);
});

test('fixtures remain synthetic and cleanable', () => {
  const gap = spec.decisions['GAP-011'];
  assert.equal(gap.role_key, 'responsabile');
  assert.equal(gap.production_fixture_data_allowed, false);
  assert.equal(gap.deterministic_cleanup_required, true);
  assert.equal(gap.residue_orphan_checks_required, true);
});

test('Base44 forensic evidence does not become implementation authority', () => {
  assert.equal(spec.decisions['GAP-012'].implementation_prerequisite, false);
  assert.equal(spec.decisions['GAP-013'].base44_forensic_paths_authoritative, false);
  assert.equal(spec.decisions['GAP-013'].bounded_write_manifest_required, true);
});

test('T20 remains incomplete with zero runtime tests after governance gate', () => {
  assert.equal(spec.post_gate.implementation_spec_authorized, true);
  assert.equal(spec.post_gate.runtime_implementation_authorized, false);
  assert.equal(spec.post_gate.schema_execution_authorized, false);
  assert.equal(spec.post_gate.t20_runtime_tests_executed, 0);
  assert.equal(spec.post_gate.t20_certification, 'INCOMPLETE');
  assert.equal(spec.post_gate.production_publication, 'BLOCKED');
});
