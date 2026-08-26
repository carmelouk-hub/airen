import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spec = JSON.parse(fs.readFileSync(new URL('../../machine-context/golden-g0-bootstrap-exact-spec.v0.1.json', import.meta.url), 'utf8'));

test('spec remains non-runtime and non-production',()=>{assert.equal(spec.authorizations.runtime,false);assert.equal(spec.authorizations.production,false);assert.equal(spec.authorizations.base44_runtime,false);assert.equal(spec.authorizations.corte_fixture_use,false);});
test('Golden uses conceptual DEMO_CERTIFICATION but existing DB class DEMO',()=>{assert.equal(spec.environment.governance_class,'DEMO_CERTIFICATION');assert.equal(spec.environment.booking_persistence_class,'DEMO');});
test('no purchased domain is consumed by certification',()=>assert.equal(spec.environment.purchased_domains_used,false));
test('topology is exactly one tenant and two locations',()=>{assert.equal(spec.tenant.slug,'golden-g0');assert.equal(spec.locations.length,2);assert.equal(spec.locations.filter(x=>x.primary).length,1);});
test('physical UUIDs remain Foundation-generated, not direct-SQL fixtures',()=>{assert.equal(spec.tenant.physical_uuid,'FOUNDATION_GENERATED_AND_FROZEN_AT_BOOTSTRAP');assert.equal(spec.provisioning.direct_sql_platform_topology_insert,false);});
test('second location uses canonical createLocation and TenantDomain lifecycle',()=>{assert.equal(spec.provisioning.second_location,'createLocation');assert.deepEqual(spec.provisioning.second_location_domain_lifecycle,['register','start_verification','verify','activate']);});
test('manager is multi-location and responsabile remains least privilege',()=>{assert.deepEqual(spec.actors.golden_manager.locations,['G01','G02']);assert.ok(spec.actors.golden_responsabile.forbidden_permissions.includes('booking.create'));assert.ok(spec.actors.golden_responsabile.forbidden_permissions.includes('booking.update'));});
test('service identity has no Tenant or Location authority',()=>assert.equal(spec.actors['golden-g0-experience'].tenant_location_authority,false));
test('Booking environment class is server-owned and keeps T20 semantics',()=>{assert.equal(spec.booking_environment_correction.g0_value,'DEMO');assert.equal(spec.booking_environment_correction.client_selectable,false);assert.equal(spec.booking_environment_correction.t20_semantics_preserved,true);});
test('G0 reuses private dispatcher but does not publish server.ts',()=>{assert.equal(spec.ingress.reuse_existing_private_booking_dispatcher,true);assert.equal(spec.ingress.publish_server_ts,false);assert.equal(spec.ingress.public_guest_booking_claimed,false);});
test('scope remains route plus membership and never client authority',()=>{assert.equal(spec.ingress.trusted_scope_source,'route_plus_membership');assert.equal(spec.ingress.client_scope_authority,false);});
test('reset is exact-tenant guarded and fail closed',()=>{assert.equal(spec.reset.foundation_owned,true);assert.equal(spec.reset.fail_closed,true);assert.equal(spec.reset.guard_tenant_slug,'golden-g0');assert.equal(spec.reset.wildcard_tenant_delete,false);});
test('reset terminal residue is zero for all G0 Booking state',()=>assert.deepEqual(spec.reset.terminal_residue,{bookings:0,idempotency:0,booking_outbox:0,booking_audit:0}));
test('all 25 G0 acceptance IDs are mandatory and unique',()=>{assert.equal(spec.acceptance_count,25);assert.equal(spec.acceptance_ids.length,25);assert.equal(new Set(spec.acceptance_ids).size,25);assert.equal(spec.acceptance_ids[0],'G0-T01');assert.equal(spec.acceptance_ids[24],'G0-T25');});
test('server.ts, Base44, platform-core, R3, main and Corte stay protected',()=>{for(const p of ['apps/api/src/server.ts','base44-apps/**','packages/platform-core/**','r3/control-plane-20260822','main','corte-production'])assert.ok(spec.bounded_write_manifest.protected.includes(p));});
test('T20 destructive migration rollback is forbidden with DEMO rows',()=>assert.equal(spec.rollback.t20_migration_rollback_with_demo_rows,'FORBIDDEN'));
test('terminal gate authorizes no runtime',()=>{assert.equal(spec.terminal.golden_g0_exact_spec,'FROZEN');assert.equal(spec.terminal.golden_g0_runtime,'NOT_AUTHORIZED');assert.equal(spec.terminal.full_golden,'NOT_READY');assert.equal(spec.terminal.production,'BLOCKED');});
