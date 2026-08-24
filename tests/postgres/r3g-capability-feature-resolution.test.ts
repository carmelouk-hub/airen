import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext } from "../../packages/authorization/src/index.ts";
import {
  activateCapability, createCapability, createFeatureFlag, getFeatureFlagAdmin, removeFeatureFlagOverride,
  resolveCurrentCapabilities, retireCapability, retireFeatureFlag, setFeatureFlagDefault, setFeatureFlagOverride,
  updateDraftCapability, updateFeatureFlag
} from "../../packages/capabilities/src/index.ts";
import { PostgresCapabilityControlPlaneStore } from "../../packages/persistence-postgres/src/capability-control-plane.ts";
import { createPostgresPool, PostgresFoundationReadStore } from "../../packages/persistence-postgres/src/index.ts";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";

const connectionString=process.env.DATABASE_URL; if(!connectionString) throw new Error("DATABASE_URL is required");
const pool=createPostgresPool(connectionString); const reads=new PostgresFoundationReadStore(pool); const store=new PostgresCapabilityControlPlaneStore(pool);
const ADMIN="a7000000-0000-4000-8000-000000000001", NOAUTH="a7000000-0000-4000-8000-000000000002";
const TENANT_A="a7100000-0000-4000-8000-000000000001", TENANT_B="a7100000-0000-4000-8000-000000000002";
const LOCATION_A="a7200000-0000-4000-8000-000000000001", LOCATION_B="a7200000-0000-4000-8000-000000000002";
const futureIso=()=>new Date(Date.now()+60_000).toISOString();

async function seed(){
  await pool.query("INSERT INTO identity.identities(id,display_name,primary_email,status) VALUES ($1,'R3G Admin','r3g-admin@example.test','active'),($2,'R3G NoAuth','r3g-noauth@example.test','active') ON CONFLICT (id) DO UPDATE SET status='active'",[ADMIN,NOAUTH]);
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active',updated_at=now()",[ADMIN]);
  await pool.query("INSERT INTO platform.tenants(id,slug,name,status,timezone,currency) VALUES ($1,'r3g-a','R3G A','active','Europe/Rome','EUR'),($2,'r3g-b','R3G B','active','Europe/Rome','EUR') ON CONFLICT (id) DO UPDATE SET status='active',updated_at=now()",[TENANT_A,TENANT_B]);
  await pool.query("INSERT INTO platform.locations(id,tenant_id,slug,name,status,timezone,is_primary) VALUES ($1,$2,'primary','Primary A','active','Europe/Rome',true),($3,$4,'primary','Primary B','active','Europe/Rome',true) ON CONFLICT (id) DO UPDATE SET status='active',is_primary=true,updated_at=now()",[LOCATION_A,TENANT_A,LOCATION_B,TENANT_B]);
  await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ('booking.read','Synthetic R3G permission','medium') ON CONFLICT (permission_key) DO NOTHING");
  await pool.query("INSERT INTO billing.entitlement_catalog(entitlement_key,description,status) VALUES ('booking.enabled','Synthetic R3G booking entitlement','active'),('premium.enabled','Synthetic R3G premium entitlement','active') ON CONFLICT (entitlement_key) DO UPDATE SET status='active',retired_at=NULL");
  await pool.query("INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,enabled,valid_from,valid_until,revoked_at,expired_at) VALUES ($1,'booking.enabled','test',true,NULL,NULL,NULL,NULL) ON CONFLICT (tenant_id,entitlement_key) DO UPDATE SET source_kind='test',enabled=true,valid_from=NULL,valid_until=NULL,revoked_at=NULL,expired_at=NULL,updated_at=now()",[TENANT_A]);
}
test.before(seed); test.after(async()=>{await pool.end();});
async function admin(correlationId:string):Promise<PlatformSecurityContext>{return buildPlatformSecurityContext({principal:{identityId:ADMIN,providerKey:"synthetic",providerSubject:"r3g-admin",platformRoles:["platform_admin"]},roles:reads,correlationId});}
function runtime(correlationId:string,permissions:readonly string[]=[],locationId:string=LOCATION_A):SecurityContext{return {correlationId,actorIdentityId:ADMIN,platformRoles:[],platformPermissions:[],tenantId:TENANT_A,locationId,permissions,entitlements:[]};}
async function stateSnapshot(){const r=await pool.query("SELECT jsonb_build_object('subscriptions',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM billing.subscriptions s),'[]'::jsonb),'entitlements',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.tenant_id,e.entitlement_key) FROM billing.tenant_entitlements e),'[]'::jsonb))::text s");return String(r.rows[0].s);}

async function createCap(ctx:PlatformSecurityContext,key:string,flag:string|null,scope:"tenant"|"location"="tenant",ents:readonly string[]=["booking.enabled"],perms:readonly string[]=["booking.read"]){return createCapability({idempotencyKey:`idem-${key}-create`,capabilityKey:key,name:key,scopeKind:scope,requiredEntitlements:ents,requiredPermissions:perms,featureFlagKey:flag},{context:ctx,unitOfWork:store});}

// R3G-T01 .. R3G-T26 are deliberately explicit markers for the frozen runtime matrix.
test("R3-G Feature/Capability resolution is governed, fail-closed and authority-separated",async()=>{
  const ctx=await admin("r3g-main");
  for(const p of ["platform.capabilities.read","platform.capabilities.create","platform.capabilities.update","platform.capabilities.activate","platform.capabilities.retire","platform.feature_flags.read","platform.feature_flags.create","platform.feature_flags.update","platform.feature_flags.retire","platform.feature_flags.set_default","platform.feature_flags.set_override","platform.feature_flags.remove_override"]) assert.ok(ctx.platformPermissions.includes(p),`missing ${p}`);

  // R3G-T01 create capability draft.
  const draft=await createCap({...ctx,correlationId:"r3g-t01"},"booking.dashboard","booking.rollout"); assert.equal(draft.capability.status,"draft");
  // R3G-T02 duplicate capability_key denied.
  await assert.rejects(()=>createCapability({idempotencyKey:"r3g-duplicate-0001",capabilityKey:"booking.dashboard",name:"Duplicate",scopeKind:"tenant"},{context:{...ctx,correlationId:"r3g-t02"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  // R3G-T03 update draft capability.
  const updated=await updateDraftCapability({idempotencyKey:"r3g-update-dashboard-01",capabilityKey:"booking.dashboard",name:"Booking Dashboard",scopeKind:"tenant",requiredEntitlements:["booking.enabled"],requiredPermissions:["booking.read"],featureFlagKey:"booking.rollout",auditLevel:"elevated"},{context:{...ctx,correlationId:"r3g-t03"},unitOfWork:store}); assert.equal(updated.capability.auditLevel,"elevated");

  // R3G-T07 create feature flag with explicit default.
  const flag=await createFeatureFlag({idempotencyKey:"r3g-flag-rollout-001",featureFlagKey:"booking.rollout",enabledDefault:false},{context:{...ctx,correlationId:"r3g-t07"},unitOfWork:store}); assert.equal(flag.featureFlag.enabledDefault,false);
  // R3G-T08 feature flag update preserves separate default-change command.
  await updateFeatureFlag({idempotencyKey:"r3g-flag-update-001",featureFlagKey:"booking.rollout",description:"Window update"},{context:{...ctx,correlationId:"r3g-t08"},unitOfWork:store}); assert.equal((await getFeatureFlagAdmin("booking.rollout",{context:{...ctx,correlationId:"r3g-t08-read"},queries:store}))?.enabledDefault,false);
  // R3G-T09 set_default audited/idempotent.
  const d1=await setFeatureFlagDefault({idempotencyKey:"r3g-set-default-001",featureFlagKey:"booking.rollout",enabledDefault:true,reasonCode:"rollout.enable"},{context:{...ctx,correlationId:"r3g-t09"},unitOfWork:store}); const d2=await setFeatureFlagDefault({idempotencyKey:"r3g-set-default-001",featureFlagKey:"booking.rollout",enabledDefault:true,reasonCode:"rollout.enable"},{context:{...ctx,correlationId:"r3g-t09-replay"},unitOfWork:store}); assert.equal(d1.featureFlag.enabledDefault,true); assert.equal(d2.replayed,true);

  // R3G-T04 activate capability.
  assert.equal((await activateCapability({idempotencyKey:"r3g-activate-dashboard",capabilityKey:"booking.dashboard"},{context:{...ctx,correlationId:"r3g-t04"},unitOfWork:store})).capability.status,"active");
  // R3G-T05 active gating semantics immutable.
  await assert.rejects(()=>updateDraftCapability({idempotencyKey:"r3g-active-update-01",capabilityKey:"booking.dashboard",name:"Mutated",scopeKind:"tenant",requiredEntitlements:[],requiredPermissions:[],featureFlagKey:null},{context:{...ctx,correlationId:"r3g-t05"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  // R3G-T06 retire capability and terminal lifecycle denial.
  await createCap({...ctx,correlationId:"r3g-t06-create"},"booking.retireme",null,"tenant",[],[]); await activateCapability({idempotencyKey:"r3g-retireme-activate",capabilityKey:"booking.retireme"},{context:{...ctx,correlationId:"r3g-t06-activate"},unitOfWork:store}); assert.equal((await retireCapability({idempotencyKey:"r3g-retireme-retire",capabilityKey:"booking.retireme"},{context:{...ctx,correlationId:"r3g-t06-retire"},unitOfWork:store})).capability.status,"retired"); await assert.rejects(()=>activateCapability({idempotencyKey:"r3g-retireme-reactivate",capabilityKey:"booking.retireme"},{context:{...ctx,correlationId:"r3g-t06-terminal"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");

  // R3G-T10 retire feature flag causes fail-closed disabled evaluation.
  await createFeatureFlag({idempotencyKey:"r3g-retired-flag-create",featureFlagKey:"retired.rollout",enabledDefault:true},{context:{...ctx,correlationId:"r3g-t10-create"},unitOfWork:store}); await createCap({...ctx,correlationId:"r3g-t10-cap"},"booking.retiredflag","retired.rollout","tenant",["booking.enabled"],[]); await activateCapability({idempotencyKey:"r3g-retired-cap-activate",capabilityKey:"booking.retiredflag"},{context:{...ctx,correlationId:"r3g-t10-activate"},unitOfWork:store}); await retireFeatureFlag({idempotencyKey:"r3g-retired-flag-final",featureFlagKey:"retired.rollout",reasonCode:"rollout.retire"},{context:{...ctx,correlationId:"r3g-t10-retire"},unitOfWork:store}); assert.equal((await resolveCurrentCapabilities({context:runtime("r3g-t10-resolve"),resolver:store})).find(x=>x.capabilityKey==="booking.retiredflag")?.available,false);

  // R3G-T11 set tenant override.
  const tenantOverride=await setFeatureFlagOverride({idempotencyKey:"r3g-tenant-override-01",featureFlagKey:"booking.rollout",subjectKind:"tenant",tenantId:TENANT_A,enabled:true,reasonCode:"rollout.tenant"},{context:{...ctx,correlationId:"r3g-t11"},unitOfWork:store}); assert.equal(tenantOverride.override.status,"active");
  // R3G-T12 set location override with parent-Tenant validation.
  const locOverride=await setFeatureFlagOverride({idempotencyKey:"r3g-location-override1",featureFlagKey:"booking.rollout",subjectKind:"location",tenantId:TENANT_A,locationId:LOCATION_A,enabled:false,reasonCode:"rollout.location"},{context:{...ctx,correlationId:"r3g-t12"},unitOfWork:store}); assert.equal(locOverride.override.locationId,LOCATION_A); await assert.rejects(()=>setFeatureFlagOverride({idempotencyKey:"r3g-location-spoof-01",featureFlagKey:"booking.rollout",subjectKind:"location",tenantId:TENANT_A,locationId:LOCATION_B,enabled:true,reasonCode:"rollout.spoof"},{context:{...ctx,correlationId:"r3g-t12-spoof"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  // Prepare a location-scoped capability for precedence/scope tests.
  await createCap({...ctx,correlationId:"r3g-location-cap-create"},"booking.location","booking.rollout","location"); await activateCapability({idempotencyKey:"r3g-location-cap-activate",capabilityKey:"booking.location"},{context:{...ctx,correlationId:"r3g-location-cap-activate"},unitOfWork:store});
  // R3G-T15 location override precedence over tenant override over default.
  let resolved=await resolveCurrentCapabilities({context:runtime("r3g-t15-location",["booking.read"]),resolver:store}); assert.equal(resolved.find(x=>x.capabilityKey==="booking.location")?.available,false);
  // R3G-T13 remove override and restore precedence.
  await removeFeatureFlagOverride({idempotencyKey:"r3g-location-remove-01",featureFlagKey:"booking.rollout",subjectKind:"location",tenantId:TENANT_A,locationId:LOCATION_A,reasonCode:"rollout.remove"},{context:{...ctx,correlationId:"r3g-t13"},unitOfWork:store}); resolved=await resolveCurrentCapabilities({context:runtime("r3g-t13-resolve",["booking.read"]),resolver:store}); assert.equal(resolved.find(x=>x.capabilityKey==="booking.location")?.available,true);

  // R3G-T14 override validity uses trusted time.
  await createFeatureFlag({idempotencyKey:"r3g-timed-flag-create",featureFlagKey:"timed.rollout",enabledDefault:false},{context:{...ctx,correlationId:"r3g-t14-flag"},unitOfWork:store}); await createCap({...ctx,correlationId:"r3g-t14-cap"},"booking.timed","timed.rollout","tenant",["booking.enabled"],[]); await activateCapability({idempotencyKey:"r3g-timed-cap-active",capabilityKey:"booking.timed"},{context:{...ctx,correlationId:"r3g-t14-active"},unitOfWork:store}); await setFeatureFlagOverride({idempotencyKey:"r3g-timed-override1",featureFlagKey:"timed.rollout",subjectKind:"tenant",tenantId:TENANT_A,enabled:true,validFrom:futureIso(),reasonCode:"rollout.future"},{context:{...ctx,correlationId:"r3g-t14-override"},unitOfWork:store}); assert.equal((await resolveCurrentCapabilities({context:runtime("r3g-t14-resolve"),resolver:store})).find(x=>x.capabilityKey==="booking.timed")?.available,false);

  // R3G-T16 enabled Feature Flag does not bypass missing Entitlement.
  await createFeatureFlag({idempotencyKey:"r3g-premium-flag-01",featureFlagKey:"premium.rollout",enabledDefault:true},{context:{...ctx,correlationId:"r3g-t16-flag"},unitOfWork:store}); await createCap({...ctx,correlationId:"r3g-t16-cap"},"booking.noent","premium.rollout","tenant",["premium.enabled"],[]); await activateCapability({idempotencyKey:"r3g-noent-active-01",capabilityKey:"booking.noent"},{context:{...ctx,correlationId:"r3g-t16-active"},unitOfWork:store}); assert.equal((await resolveCurrentCapabilities({context:runtime("r3g-t16-resolve"),resolver:store})).find(x=>x.capabilityKey==="booking.noent")?.available,false);
  // R3G-T17 Entitlement present + disabled Feature Flag denies availability.
  await createFeatureFlag({idempotencyKey:"r3g-disabled-flag01",featureFlagKey:"disabled.rollout",enabledDefault:false},{context:{...ctx,correlationId:"r3g-t17-flag"},unitOfWork:store}); await createCap({...ctx,correlationId:"r3g-t17-cap"},"booking.disabled","disabled.rollout","tenant",["booking.enabled"],[]); await activateCapability({idempotencyKey:"r3g-disabled-active1",capabilityKey:"booking.disabled"},{context:{...ctx,correlationId:"r3g-t17-active"},unitOfWork:store}); assert.equal((await resolveCurrentCapabilities({context:runtime("r3g-t17-resolve"),resolver:store})).find(x=>x.capabilityKey==="booking.disabled")?.available,false);
  // R3G-T18 capability available but missing Permission => available=true authorized=false allowed=false.
  const noPerm=(await resolveCurrentCapabilities({context:runtime("r3g-t18",[]),resolver:store})).find(x=>x.capabilityKey==="booking.dashboard")!; assert.equal(noPerm.available,true); assert.equal(noPerm.authorized,false); assert.equal(noPerm.allowed,false); assert.ok(noPerm.denialReasons.includes("permission_missing"));
  // R3G-T19 all Entitlements + flag + Permission => allowed=true.
  const yesPerm=(await resolveCurrentCapabilities({context:runtime("r3g-t19",["booking.read"]),resolver:store})).find(x=>x.capabilityKey==="booking.dashboard")!; assert.equal(yesPerm.allowed,true);
  // R3G-T20 location-scoped capability without location context denied.
  const noLocation=(await resolveCurrentCapabilities({context:runtime("r3g-t20",["booking.read"],""),resolver:store})).find(x=>x.capabilityKey==="booking.location")!; assert.equal(noLocation.available,false); assert.ok(noLocation.denialReasons.includes("location_context_required"));
  // R3G-T21 cross-Tenant/location spoof denied.
  const spoof=(await resolveCurrentCapabilities({context:runtime("r3g-t21",["booking.read"],LOCATION_B),resolver:store})).find(x=>x.capabilityKey==="booking.location")!; assert.equal(spoof.available,false); assert.ok(spoof.denialReasons.includes("invalid_scope"));

  // R3G-T22 direct R3-G table DML denied to airen_control_plane and airen_app.
  const client=await pool.connect(); try{for(const role of ["airen_control_plane","airen_app"]){await client.query("BEGIN");await client.query(`SET LOCAL ROLE ${role}`);await assert.rejects(()=>client.query("UPDATE platform.feature_flags SET enabled_default=false WHERE feature_flag_key='booking.rollout'"),(e:any)=>e?.code==="42501");await client.query("ROLLBACK");}}finally{client.release();}
  // R3G-T23 fake application Platform permission cannot bypass PostgreSQL recheck.
  const forged:PlatformSecurityContext={scopeKind:"platform",correlationId:"r3g-t23",actorIdentityId:NOAUTH,platformRoles:["platform_admin"],platformPermissions:["platform.feature_flags.set_default"]}; await assert.rejects(()=>setFeatureFlagDefault({idempotencyKey:"r3g-forged-default1",featureFlagKey:"booking.rollout",enabledDefault:false,reasonCode:"rollout.forged"},{context:forged,unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  // R3G-T24 idempotency replay/conflict and forced Audit/Outbox rollback are atomic.
  await assert.rejects(()=>setFeatureFlagDefault({idempotencyKey:"r3g-set-default-001",featureFlagKey:"booking.rollout",enabledDefault:false,reasonCode:"rollout.changed"},{context:{...ctx,correlationId:"r3g-t24-conflict"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="IDEMPOTENCY_CONFLICT"); const beforeDefault=(await getFeatureFlagAdmin("booking.rollout",{context:{...ctx,correlationId:"r3g-t24-before"},queries:store}))?.enabledDefault;
  await pool.query("CREATE OR REPLACE FUNCTION public.r3g_force_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id='r3g-rollback' THEN RAISE EXCEPTION 'R3G_FORCED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$"); await pool.query("CREATE TRIGGER r3g_force_audit_failure BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.r3g_force_audit_failure()");
  try{await assert.rejects(()=>setFeatureFlagDefault({idempotencyKey:"r3g-rollback-default",featureFlagKey:"booking.rollout",enabledDefault:false,reasonCode:"rollout.rollback"},{context:{...ctx,correlationId:"r3g-rollback"},unitOfWork:store}));}finally{await pool.query("DROP TRIGGER IF EXISTS r3g_force_audit_failure ON audit.audit_events");await pool.query("DROP FUNCTION IF EXISTS public.r3g_force_audit_failure()");}
  assert.equal((await getFeatureFlagAdmin("booking.rollout",{context:{...ctx,correlationId:"r3g-t24-after"},queries:store}))?.enabledDefault,beforeDefault); assert.equal(Number((await pool.query("SELECT count(*)::int c FROM platform.capability_idempotency WHERE idempotency_key='r3g-rollback-default'")).rows[0].c),0); assert.equal(Number((await pool.query("SELECT count(*)::int c FROM events.outbox_events WHERE correlation_id='r3g-rollback'")).rows[0].c),0);

  // R3G-T25 resolver safe projection excludes override provenance/cross-Tenant metadata.
  const safe=(await resolveCurrentCapabilities({context:runtime("r3g-t25",["booking.read"]),resolver:store})).find(x=>x.capabilityKey==="booking.dashboard")!; assert.deepEqual(Object.keys(safe).sort(),["allowed","authorized","available","capabilityKey","denialReasons","scopeKind"].sort()); for(const forbidden of ["tenantId","locationId","featureFlagKey","overrideId","reasonCode","requiredPermissions"]) assert.equal(Object.prototype.hasOwnProperty.call(safe,forbidden),false);
  // R3G-T26 R3-A..F regression boundary: resolver does not mutate Subscription or Tenant Entitlement state.
  const beforeState=await stateSnapshot(); await resolveCurrentCapabilities({context:runtime("r3g-t26",["booking.read"]),resolver:store}); assert.equal(await stateSnapshot(),beforeState);

  assert.ok(Number((await pool.query("SELECT count(*)::int c FROM platform.capability_events")).rows[0].c)>=12); assert.ok(Number((await pool.query("SELECT count(*)::int c FROM audit.audit_events WHERE action_key LIKE 'capability.%' OR action_key LIKE 'feature_flag.%'")).rows[0].c)>=12); assert.ok(Number((await pool.query("SELECT count(*)::int c FROM events.outbox_events WHERE event_type LIKE 'capability.%' OR event_type LIKE 'feature_flag.%'")).rows[0].c)>=12);
});
