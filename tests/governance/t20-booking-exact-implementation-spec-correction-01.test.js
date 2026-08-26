import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const correction = JSON.parse(
  fs.readFileSync(new URL('../../machine-context/t20-booking-exact-implementation-spec-correction-01.v0.1.json', import.meta.url), 'utf8')
);

test('correction is governance-only and preserves production/schema blocks', () => {
  assert.equal(correction.artifact_class, 'GOVERNANCE_CORRECTION_NOT_RUNTIME_EVIDENCE');
  assert.equal(correction.preservation.production_publication_authorized, false);
  assert.equal(correction.preservation.schema_execution_authorized, false);
});

test('canonical PostgreSQL context namespace is airen.*', () => {
  const settings = correction.corrected_rls_design.session_settings;
  assert.equal(settings.identity, 'airen.identity_id');
  assert.equal(settings.tenant, 'airen.tenant_id');
  assert.equal(settings.location, 'airen.location_id');
  assert.equal(settings.correlation, 'airen.correlation_id');
});

test('parallel app.* authority namespace is forbidden', () => {
  assert.equal(correction.corrected_rls_design.forbidden_namespace, 'app.*');
  assert.doesNotMatch(correction.corrected_rls_design.policy, /app\./);
  assert.match(correction.corrected_rls_design.policy, /airen\.tenant_id/);
  assert.match(correction.corrected_rls_design.policy, /airen\.location_id/);
});

test('Foundation authority invariants are preserved', () => {
  assert.equal(correction.preservation.foundation_authority_unchanged, true);
  assert.equal(correction.preservation.security_context_server_derived, true);
  assert.equal(correction.preservation.base44_authoritative, false);
  assert.equal(correction.preservation.stella_direct_booking_write, false);
});
