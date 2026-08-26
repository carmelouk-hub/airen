import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spec = JSON.parse(
  fs.readFileSync(new URL('../../machine-context/t20-booking-exact-implementation-spec.v0.1.json', import.meta.url), 'utf8')
);

test('specification authorizes design only, not runtime/schema/Base44/production', () => {
  assert.equal(spec.artifact_class, 'EXACT_IMPLEMENTATION_SPEC_NOT_RUNTIME_AUTHORIZATION');
  assert.equal(spec.authorizations.implementation_spec, true);
  assert.equal(spec.authorizations.runtime_implementation, false);
  assert.equal(spec.authorizations.schema_migration_execution, false);
  assert.equal(spec.authorizations.base44_runtime_change, false);
  assert.equal(spec.authorizations.production_publication, false);
});

test('Foundation remains authoritative and SecurityContext remains server-derived', () => {
  assert.equal(spec.authority.foundation_authoritative, true);
  assert.equal(spec.authority.security_context, 'SERVER_DERIVED');
  assert.equal(spec.authority.client_tenant_location_authoritative, false);
  assert.equal(spec.authority.base44_authoritative, false);
  assert.equal(spec.authority.stella_direct_booking_write, false);
  assert.equal(spec.authority.default_authorization, 'DENY');
});

test('technology baseline extends the existing Foundation stack', () => {
  assert.equal(spec.technology_baseline.language, 'TypeScript');
  assert.equal(spec.technology_baseline.runtime, 'Node.js');
  assert.equal(spec.technology_baseline.database, 'PostgreSQL');
  assert.equal(spec.technology_baseline.database_driver, 'pg');
  assert.equal(spec.technology_baseline.foundation_security_context, 'apps/api/src/security-context.ts');
});

test('private API paths, methods and least-privilege permissions are frozen', () => {
  const routes = spec.private_api.routes;
  const byName = new Map(routes.map((route) => [`${route.method} ${route.path}`, route]));
  assert.equal(byName.get('GET /v1/ristoairen/bookings').function_id, 'RST-F-BKG-007');
  assert.equal(byName.get('GET /v1/ristoairen/bookings').permission, 'booking.read');
  assert.equal(byName.get('POST /v1/ristoairen/bookings').function_id, 'RST-F-BKG-001');
  assert.equal(byName.get('POST /v1/ristoairen/bookings').permission, 'booking.create');
  assert.equal(byName.get('PATCH /v1/ristoairen/bookings/{booking_id}').function_id, 'RST-F-BKG-002');
  assert.equal(byName.get('PATCH /v1/ristoairen/bookings/{booking_id}').permission, 'booking.update');
  assert.equal(byName.get('POST /v1/ristoairen/bookings/{booking_id}/status-transitions').function_id, 'RST-F-BKG-003');
  assert.equal(byName.get('POST /v1/ristoairen/bookings/{booking_id}/status-transitions').permission, 'booking.status.update');
});

test('private projection cannot leak scope authority or credential material', () => {
  const forbidden = spec.dto.BookingPrivateProjectionV1_forbidden;
  for (const field of ['tenant_id', 'location_id', 'service_credentials', 'authorization_tokens']) {
    assert.ok(forbidden.includes(field));
  }
});

test('Booking update cannot bypass dedicated status-transition authority', () => {
  const route = spec.private_api.routes.find((item) => item.canonical_name === 'booking.update');
  assert.equal(route.status_mutation_allowed, false);
  assert.ok(spec.dto.BookingUpdateInputV1.forbidden.includes('status'));
});

test('canonical Booking lifecycle and terminal states are exact', () => {
  assert.deepEqual(spec.booking_lifecycle.states, ['REQUESTED', 'PENDING', 'CONFIRMED', 'ARRIVED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
  assert.deepEqual(spec.booking_lifecycle.allowed_transitions.SEATED, ['COMPLETED']);
  assert.deepEqual(spec.booking_lifecycle.allowed_transitions.COMPLETED, []);
  assert.deepEqual(spec.booking_lifecycle.allowed_transitions.CANCELLED, []);
  assert.deepEqual(spec.booking_lifecycle.allowed_transitions.NO_SHOW, []);
});

test('PostgreSQL schema is Location-scoped, optimistic-concurrency aware and non-hard-deleting', () => {
  const columns = spec.schema_design.columns;
  assert.equal(spec.schema_design.table, 'risto_bookings');
  assert.match(columns.tenant_id, /not null/);
  assert.match(columns.location_id, /not null/);
  assert.match(columns.row_version, /bigint not null/);
  assert.equal(spec.schema_design.hard_delete, false);
  assert.ok(spec.schema_design.indexes.some((entry) => entry.includes('tenant_id, location_id, status')));
});

test('RLS is enabled, forced and scoped by trusted Tenant and Location', () => {
  assert.equal(spec.rls_design.enabled, true);
  assert.equal(spec.rls_design.forced, true);
  assert.match(spec.rls_design.policy, /app\.tenant_id/);
  assert.match(spec.rls_design.policy, /app\.location_id/);
  assert.equal(spec.rls_design.admin_bypass_via_client, false);
  assert.equal(spec.rls_design.service_role_unscoped_access, false);
});

test('service identity is short-lived asymmetric authentication, never user authority', () => {
  const service = spec.authentication.experience_service;
  assert.equal(service.mechanism, 'short-lived asymmetric JWT service assertion');
  assert.equal(service.algorithm, 'EdDSA');
  assert.ok(service.max_ttl_seconds <= 300);
  assert.equal(service.public_key_registry_owner, 'AIRenOS Foundation');
  assert.equal(service.service_assertion_is_user_authority, false);
});

test('idempotency is durable, Foundation-owned in scope and semantic-conflict safe', () => {
  assert.equal(spec.idempotency.table, 'foundation_idempotency_keys');
  assert.ok(spec.idempotency.scope.includes('tenant_id'));
  assert.ok(spec.idempotency.scope.includes('location_id'));
  assert.equal(spec.idempotency.retention_hours, 72);
  assert.equal(spec.idempotency.duplicate_different_payload, 'IDEMPOTENCY_CONFLICT');
  assert.equal(spec.idempotency.timestamp_only_replay_protection, false);
});

test('timeouts and retries cannot manufacture mutation success', () => {
  assert.equal(spec.timeouts_and_retries.timeout_implies_success, false);
  assert.match(spec.timeouts_and_retries.retry.mutations, /identical idempotency key/);
  assert.ok(spec.timeouts_and_retries.retry.never_retry.includes('409'));
});

test('rate limits are bounded and explicitly not authorization', () => {
  assert.equal(spec.rate_limits.query_per_minute, 120);
  assert.equal(spec.rate_limits.mutation_per_minute, 60);
  assert.equal(spec.rate_limits.burst, 20);
  assert.equal(spec.rate_limits.rate_limit_is_authorization, false);
});

test('audit/outbox and observability exclude sensitive payloads and secret material', () => {
  for (const field of ['phone_snapshot', 'email_snapshot', 'notes', 'special_requests', 'tokens', 'secrets']) {
    assert.ok(spec.audit_outbox.forbidden_payload.includes(field));
  }
  for (const field of ['phone_snapshot', 'email_snapshot', 'notes', 'special_requests', 'authorization_header', 'service_assertion', 'raw_body']) {
    assert.ok(spec.observability.forbidden_fields.includes(field));
  }
});

test('all Booking adapter kill switches default OFF', () => {
  assert.equal(spec.kill_switch.default, false);
  assert.equal(spec.kill_switch.all_default, false);
  assert.equal(spec.kill_switch.disabled_behavior.includes('never local-success fallback'), true);
});

test('environment separation protects production and Corte from T20 fixtures', () => {
  assert.equal(spec.environment_separation.credentials_not_shared, true);
  assert.equal(spec.environment_separation.database_not_shared, true);
  assert.equal(spec.environment_separation.service_key_registry_not_shared, true);
  assert.equal(spec.environment_separation.test_fixture_environment_class, 'TEST_TEMPORARY');
  assert.equal(spec.environment_separation.corte_delle_stelle_as_test_fixture, false);
});

test('bounded write manifest excludes Base44, platform-core, certified R3 and main', () => {
  const forbidden = spec.bounded_write_manifest.forbidden_paths.join('\n');
  assert.match(forbidden, /base44-apps/);
  assert.match(forbidden, /packages\/platform-core/);
  assert.match(forbidden, /r3\/control-plane-20260822/);
  assert.match(forbidden, /main/);
  assert.ok(spec.bounded_write_manifest.new_files.includes('packages/ristoairen/src/booking/contracts.ts'));
  assert.ok(spec.bounded_write_manifest.existing_files_allowed_to_modify.includes('apps/api/src/server.ts'));
});

test('T20 remains a 66-test future certification and runtime remains blocked after spec pass', () => {
  assert.equal(spec.t20_required_evidence.runtime_test_count_contract, 66);
  assert.equal(spec.promotion_gate.spec_acceptance_required, true);
  assert.equal(spec.promotion_gate.runtime_implementation_authorized, false);
  assert.equal(spec.promotion_gate.schema_execution_authorized, false);
  assert.equal(spec.promotion_gate.production_publication_authorized, false);
  assert.equal(spec.promotion_gate.next_action_after_spec_pass, 'EXPLICIT_BOUNDED_T20_RUNTIME_IMPLEMENTATION_AUTHORIZATION');
});
