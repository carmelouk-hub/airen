import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext } from "../../packages/authorization/src/index.ts";
import { provisionTenant } from "../../packages/tenant/src/commands/provision-tenant.ts";
import { activateTenantDomain, disableTenantDomain, getTenantDomainAdmin, listTenantDomainsAdmin, recordTenantDomainVerificationFailed, recordTenantDomainVerificationPassed, registerTenantDomain, retryTenantDomainVerification, setTenantDomainLocation, startTenantDomainVerification } from "../../packages/tenant/src/commands/manage-tenant-domain.ts";
import { resolveTenantRoute } from "../../packages/tenant/src/index.ts";
import { PostgresPublicRouteLookup, PostgresTenantDomainControlPlaneStore } from "../../packages/persistence-postgres/src/tenant-domain-control-plane.ts";
import { PostgresTenantProvisioningUnitOfWork } from "../../packages/persistence-postgres/src/tenant-provisioning.ts";
import { PostgresFoundationReadStore, PostgresLocationRepositoryAdapter, PostgresTenantRepositoryAdapter, createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const reads = new PostgresFoundationReadStore(pool);
const tenantRepo = new PostgresTenantRepositoryAdapter(reads);
const locationRepo = new PostgresLocationRepositoryAdapter(reads);
const lifecycle = new PostgresTenantDomainControlPlaneStore(pool);
const publicRoutes = new PostgresPublicRouteLookup(pool);
const provisioning = new PostgresTenantProvisioningUnitOfWork(pool);
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000001";

async function seedPermissions() {
  for (const permission of [
    "platform.tenants.provision",
    "platform.domains.read",
    "platform.domains.register",
    "platform.domains.verify",
    "platform.domains.activate",
    "platform.domains.disable",
    "platform.domains.bind_location"
  ]) {
    await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ($1,$1,'high') ON CONFLICT DO NOTHING",[permission]);
    await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('platform','platform_admin',$1,'allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'",[permission]);
  }
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active'",[ALICE]);
}

test.before(seedPermissions);
test.after(async()=>{ await pool.end(); });

test("R3-C TenantDomain lifecycle preserves hostname ownership, verification, public resolution and rollback",async()=>{
  const platform = await buildPlatformSecurityContext({ principal:{identityId:ALICE,providerKey:"synthetic",providerSubject:"alice-platform",platformRoles:["platform_admin"]}, roles:reads, correlationId:"r3c-platform" });
  const first = await provisionTenant({ idempotencyKey:"r3c-provision-one-v1", slug:"r3c-domain-one", name:"R3C Domain One", timezone:"Europe/Rome", primaryLocation:{slug:"main",name:"R3C One Main"} },{ context:{...platform,correlationId:"r3c-provision-one"}, unitOfWork:provisioning });
  const second = await provisionTenant({ idempotencyKey:"r3c-provision-two-v1", slug:"r3c-domain-two", name:"R3C Domain Two", timezone:"Europe/Rome", primaryLocation:{slug:"main",name:"R3C Two Main"} },{ context:{...platform,correlationId:"r3c-provision-two"}, unitOfWork:provisioning });
  const tenantId = first.tenant.id;
  const primaryId = String((await pool.query("SELECT id FROM platform.locations WHERE tenant_id=$1 AND is_primary=true",[tenantId])).rows[0].id);
  const secondTenantPrimaryId = String((await pool.query("SELECT id FROM platform.locations WHERE tenant_id=$1 AND is_primary=true",[second.tenant.id])).rows[0].id);

  const registered = await registerTenantDomain({ idempotencyKey:"r3c-register-main-v1", tenantId, hostname:"R3C-ONE.EXAMPLE.TEST.", locationId:primaryId },{ context:{...platform,correlationId:"r3c-register-main"}, unitOfWork:lifecycle });
  assert.equal(registered.domain.hostname,"r3c-one.example.test");
  assert.equal(registered.domain.status,"pending");
  assert.equal(registered.domain.verificationState,"unverified");
  assert.equal(registered.domain.tenantId,tenantId);

  const registerReplay = await registerTenantDomain({ idempotencyKey:"r3c-register-main-v1", tenantId, hostname:"r3c-one.example.test", locationId:primaryId },{ context:{...platform,correlationId:"r3c-register-replay"}, unitOfWork:lifecycle });
  assert.equal(registerReplay.replayed,true);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3c-register-replay'")).rows[0].c),0);
  await assert.rejects(()=>registerTenantDomain({ idempotencyKey:"r3c-register-main-v1", tenantId, hostname:"changed.example.test", locationId:primaryId },{ context:{...platform,correlationId:"r3c-register-conflict"}, unitOfWork:lifecycle }),(e:unknown)=>e instanceof AppError&&e.code==="IDEMPOTENCY_CONFLICT");

  await assert.rejects(()=>registerTenantDomain({ idempotencyKey:"r3c-reserved-host-v1", tenantId, hostname:"r3c-domain-one.ristoairen.com", locationId:primaryId },{ context:{...platform,correlationId:"r3c-reserved-host"}, unitOfWork:lifecycle }),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  await assert.rejects(()=>registerTenantDomain({ idempotencyKey:"r3c-collision-host-v1", tenantId:second.tenant.id, hostname:"r3c-one.example.test", locationId:secondTenantPrimaryId },{ context:{...platform,correlationId:"r3c-collision-host"}, unitOfWork:lifecycle }),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");

  const started = await startTenantDomainVerification({ idempotencyKey:"r3c-verify-start-v1", domainId:registered.domain.id },{ context:{...platform,correlationId:"r3c-verify-start"}, unitOfWork:lifecycle });
  assert.equal(started.domain.verificationState,"pending");
  const verified = await recordTenantDomainVerificationPassed({ idempotencyKey:"r3c-verify-pass-v1", domainId:registered.domain.id, verificationEvidenceRef:"dns-fixture:r3c-one:verified" },{ context:{...platform,correlationId:"r3c-verify-pass"}, unitOfWork:lifecycle });
  assert.equal(verified.domain.status,"verified");
  assert.equal(verified.domain.verificationState,"verified");
  const active = await activateTenantDomain({ idempotencyKey:"r3c-activate-main-v1", domainId:registered.domain.id },{ context:{...platform,correlationId:"r3c-activate-main"}, unitOfWork:lifecycle });
  assert.equal(active.domain.status,"active");

  const customRoute = await resolveTenantRoute({ hostname:"r3c-one.example.test", trustedBaseDomain:"ristoairen.com", tenants:tenantRepo, locations:locationRepo, domains:reads, publicRoutes });
  assert.equal(customRoute.tenant.id,tenantId);
  assert.equal(customRoute.location.id,primaryId);
  assert.equal(customRoute.source,"custom-domain");
  const trustedRoute = await resolveTenantRoute({ hostname:"r3c-domain-one.ristoairen.com", trustedBaseDomain:"ristoairen.com", tenants:tenantRepo, locations:locationRepo, domains:reads, publicRoutes });
  assert.equal(trustedRoute.tenant.id,tenantId);
  assert.equal(trustedRoute.location.id,primaryId);
  assert.equal(trustedRoute.source,"trusted-platform-subdomain");
  await assert.rejects(()=>resolveTenantRoute({ hostname:"unknown-r3c.example.test", trustedBaseDomain:"ristoairen.com", tenants:tenantRepo, locations:locationRepo, domains:reads, publicRoutes }),(e:unknown)=>e instanceof AppError&&e.code==="TENANT_RESOLUTION_FAILED");

  const detail = await getTenantDomainAdmin(registered.domain.id,{context:{...platform,correlationId:"r3c-detail"},queries:lifecycle});
  assert.equal(detail?.hostname,"r3c-one.example.test");
  const list = await listTenantDomainsAdmin({tenantId,limit:100},{context:{...platform,correlationId:"r3c-list"},queries:lifecycle});
  assert.ok(list.some((domain)=>domain.id===registered.domain.id));

  const annexId = "33333333-3333-4333-8333-333333333333";
  await pool.query("INSERT INTO platform.locations(id,tenant_id,slug,name,status,timezone,is_primary) VALUES ($1,$2,'domain-annex','Domain Annex','active','Europe/Rome',false)",[annexId,tenantId]);
  const rebound = await setTenantDomainLocation({ idempotencyKey:"r3c-rebind-annex-v1", domainId:registered.domain.id, locationId:annexId, reasonCode:"domain.location_rebind" },{ context:{...platform,correlationId:"r3c-rebind-annex"}, unitOfWork:lifecycle });
  assert.equal(rebound.domain.locationId,annexId);
  const reboundRoute = await resolveTenantRoute({ hostname:"r3c-one.example.test", trustedBaseDomain:"ristoairen.com", tenants:tenantRepo, locations:locationRepo, domains:reads, publicRoutes });
  assert.equal(reboundRoute.location.id,annexId);
  await assert.rejects(()=>setTenantDomainLocation({ idempotencyKey:"r3c-cross-tenant-bind-v1", domainId:registered.domain.id, locationId:secondTenantPrimaryId, reasonCode:"invalid.cross_tenant" },{ context:{...platform,correlationId:"r3c-cross-tenant-bind"}, unitOfWork:lifecycle }),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  const detached = await setTenantDomainLocation({ idempotencyKey:"r3c-detach-location-v1", domainId:registered.domain.id, locationId:null, reasonCode:"domain.use_primary" },{ context:{...platform,correlationId:"r3c-detach-location"}, unitOfWork:lifecycle });
  assert.equal(detached.domain.locationId,undefined);
  const detachedRoute = await resolveTenantRoute({ hostname:"r3c-one.example.test", trustedBaseDomain:"ristoairen.com", tenants:tenantRepo, locations:locationRepo, domains:reads, publicRoutes });
  assert.equal(detachedRoute.location.id,primaryId);

  const failedDomain = await registerTenantDomain({ idempotencyKey:"r3c-register-fail-v1", tenantId, hostname:"r3c-fail.example.test" },{ context:{...platform,correlationId:"r3c-register-fail"}, unitOfWork:lifecycle });
  await startTenantDomainVerification({ idempotencyKey:"r3c-fail-start-v1", domainId:failedDomain.domain.id },{ context:{...platform,correlationId:"r3c-fail-start"}, unitOfWork:lifecycle });
  const failed = await recordTenantDomainVerificationFailed({ idempotencyKey:"r3c-fail-result-v1", domainId:failedDomain.domain.id, verificationEvidenceRef:"dns-fixture:r3c-fail:failed", reasonCode:"dns.ownership_failed" },{ context:{...platform,correlationId:"r3c-fail-result"}, unitOfWork:lifecycle });
  assert.equal(failed.domain.status,"error");
  assert.equal(failed.domain.verificationState,"failed");
  await assert.rejects(()=>startTenantDomainVerification({ idempotencyKey:"r3c-invalid-restart-v1", domainId:failedDomain.domain.id },{ context:{...platform,correlationId:"r3c-invalid-restart"}, unitOfWork:lifecycle }),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  const retried = await retryTenantDomainVerification({ idempotencyKey:"r3c-retry-verification-v1", domainId:failedDomain.domain.id },{ context:{...platform,correlationId:"r3c-retry-verification"}, unitOfWork:lifecycle });
  assert.equal(retried.domain.status,"pending");
  assert.equal(retried.domain.verificationState,"pending");

  const beforeRollbackStatus = String((await pool.query("SELECT status FROM platform.tenant_domains WHERE id=$1",[registered.domain.id])).rows[0].status);
  const beforeRollbackTransitions = Number((await pool.query("SELECT count(*)::int AS c FROM platform.tenant_domain_transitions WHERE domain_id=$1",[registered.domain.id])).rows[0].c);
  await pool.query("CREATE OR REPLACE FUNCTION public.r3c_force_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id='r3c-rollback' THEN RAISE EXCEPTION 'R3C_FORCED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$");
  await pool.query("CREATE TRIGGER r3c_force_audit_failure BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.r3c_force_audit_failure()");
  try {
    await assert.rejects(()=>disableTenantDomain({ idempotencyKey:"r3c-rollback-disable-v1", domainId:registered.domain.id, reasonCode:"domain.rollback_probe" },{ context:{...platform,correlationId:"r3c-rollback"}, unitOfWork:lifecycle }));
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS r3c_force_audit_failure ON audit.audit_events");
    await pool.query("DROP FUNCTION IF EXISTS public.r3c_force_audit_failure()");
  }
  assert.equal(String((await pool.query("SELECT status FROM platform.tenant_domains WHERE id=$1",[registered.domain.id])).rows[0].status),beforeRollbackStatus);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.tenant_domain_lifecycle_idempotency WHERE idempotency_key='r3c-rollback-disable-v1'")).rows[0].c),0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.tenant_domain_transitions WHERE domain_id=$1",[registered.domain.id])).rows[0].c),beforeRollbackTransitions);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3c-rollback'")).rows[0].c),0);

  const disabled = await disableTenantDomain({ idempotencyKey:"r3c-disable-main-v1", domainId:registered.domain.id, reasonCode:"domain.manual_disable" },{ context:{...platform,correlationId:"r3c-disable-main"}, unitOfWork:lifecycle });
  assert.equal(disabled.domain.status,"disabled");
  await assert.rejects(()=>resolveTenantRoute({ hostname:"r3c-one.example.test", trustedBaseDomain:"ristoairen.com", tenants:tenantRepo, locations:locationRepo, domains:reads, publicRoutes }),(e:unknown)=>e instanceof AppError&&e.code==="TENANT_RESOLUTION_FAILED");
  const reactivated = await activateTenantDomain({ idempotencyKey:"r3c-reactivate-main-v1", domainId:registered.domain.id },{ context:{...platform,correlationId:"r3c-reactivate-main"}, unitOfWork:lifecycle });
  assert.equal(reactivated.domain.status,"active");

  await pool.query("UPDATE platform.tenants SET status='suspended' WHERE id=$1",[tenantId]);
  await assert.rejects(()=>resolveTenantRoute({ hostname:"r3c-one.example.test", trustedBaseDomain:"ristoairen.com", tenants:tenantRepo, locations:locationRepo, domains:reads, publicRoutes }),(e:unknown)=>e instanceof AppError&&e.code==="TENANT_RESOLUTION_FAILED");
  await pool.query("UPDATE platform.tenants SET status='active' WHERE id=$1",[tenantId]);

  const bobContext = await buildPlatformSecurityContext({ principal:{identityId:BOB,providerKey:"synthetic",providerSubject:"bob-tenant-only",platformRoles:[]}, roles:reads, correlationId:"r3c-bob" });
  await assert.rejects(()=>getTenantDomainAdmin(registered.domain.id,{context:bobContext,queries:lifecycle}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
  await assert.rejects(()=>registerTenantDomain({ idempotencyKey:"r3c-bob-register-v1", tenantId, hostname:"bob-r3c.example.test" },{ context:bobContext,unitOfWork:lifecycle }),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  const direct = await pool.connect();
  try {
    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_control_plane");
    await direct.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.correlation_id','r3c-db-bob-denied',true)",[BOB]);
    await assert.rejects(()=>direct.query("SELECT * FROM security.platform_get_tenant_domain($1)",[registered.domain.id]),(e:unknown)=>(e as {code?:string}).code==="42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_app");
    await assert.rejects(()=>direct.query("UPDATE platform.tenant_domains SET status='disabled' WHERE id=$1",[registered.domain.id]),(e:unknown)=>(e as {code?:string}).code==="42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_app");
    await assert.rejects(()=>direct.query("INSERT INTO platform.tenant_domains(tenant_id,hostname) VALUES ($1,'direct-r3c.example.test')",[tenantId]),(e:unknown)=>(e as {code?:string}).code==="42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_app");
    await assert.rejects(()=>direct.query("SELECT * FROM security.platform_mutate_tenant_domain('disable','r3c-app-denied-v1',$1,NULL,'domain.invalid',NULL)",[registered.domain.id]),(e:unknown)=>(e as {code?:string}).code==="42501");
    await direct.query("ROLLBACK");
  } finally { direct.release(); }

  assert.ok(Number((await pool.query("SELECT count(*)::int AS c FROM platform.tenant_domain_transitions WHERE domain_id=$1",[registered.domain.id])).rows[0].c)>=8);
  assert.ok(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE resource_type='TenantDomain' AND resource_id=$1",[registered.domain.id])).rows[0].c)>=8);
  assert.ok(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE aggregate_type='TenantDomain' AND aggregate_id=$1",[registered.domain.id])).rows[0].c)>=8);
});
