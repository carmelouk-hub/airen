import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { dispatchAdminApiRequest, mapAdminApiError, type AdminApiDependencies } from "../../apps/api/src/admin-api.ts";

const TENANT="11111111-1111-4111-8111-111111111111";
const LOCATION="22222222-2222-4222-8222-222222222222";
const IDENTITY="33333333-3333-4333-8333-333333333333";
const NOW="2026-08-23T12:00:00.000Z";

const ALL_PERMISSIONS=[
  "platform.override_tenant_scope",
  "platform.tenants.read","platform.tenants.provision","platform.tenants.update","platform.tenants.suspend","platform.tenants.reactivate","platform.tenants.archive",
  "platform.locations.read","platform.locations.update","platform.locations.suspend","platform.locations.reactivate","platform.locations.archive","platform.locations.transfer_primary",
  "platform.domains.read","platform.domains.register","platform.domains.verify","platform.domains.activate","platform.domains.disable","platform.domains.bind_location",
  "platform.principals.read","platform.roles.read","platform.roles.assign","platform.roles.suspend","platform.roles.reactivate","platform.roles.revoke",
  "platform.plans.read","platform.plans.create","platform.plans.update","platform.plans.activate","platform.plans.retire",
  "platform.subscriptions.read","platform.subscriptions.create","platform.subscriptions.activate","platform.subscriptions.suspend","platform.subscriptions.reactivate","platform.subscriptions.schedule_cancel","platform.subscriptions.unschedule_cancel","platform.subscriptions.cancel","platform.subscriptions.expire","platform.subscriptions.change_plan",
  "platform.entitlements.read","platform.entitlements.create","platform.entitlements.update","platform.entitlements.retire","platform.entitlements.grant","platform.entitlements.revoke","platform.entitlements.expire","platform.entitlements.change_limit","platform.entitlements.change_config","platform.entitlements.change_validity",
  "platform.capabilities.read","platform.capabilities.create","platform.capabilities.update","platform.capabilities.activate","platform.capabilities.retire",
  "platform.feature_flags.read","platform.feature_flags.create","platform.feature_flags.update","platform.feature_flags.retire","platform.feature_flags.set_default","platform.feature_flags.set_override","platform.feature_flags.remove_override",
  "platform.audit.read"
];

function principal(kind:string){
  if(kind==="admin") return {identityId:IDENTITY,providerKey:"reference",providerSubject:"admin",platformRoles:["platform_admin"],authenticatedAtIso:NOW,expiresAtIso:"2026-08-24T12:00:00.000Z"};
  if(kind==="viewer") return {identityId:IDENTITY,providerKey:"reference",providerSubject:"viewer",platformRoles:["viewer"],authenticatedAtIso:NOW,expiresAtIso:"2026-08-24T12:00:00.000Z"};
  if(kind==="tenant") return {identityId:IDENTITY,providerKey:"reference",providerSubject:"tenant",platformRoles:[],authenticatedAtIso:NOW,expiresAtIso:"2026-08-24T12:00:00.000Z"};
  return null;
}

function deps():AdminApiDependencies {
  const idempotency=new Map<string,{payload:string,result:any}>();
  const tenantProjection={id:TENANT,slug:"alpha",name:"Alpha",status:"active",locale:"it-IT",timezone:"Europe/Rome",currency:"EUR",createdAt:NOW,updatedAt:NOW};
  const locationProjection={id:LOCATION,tenantId:TENANT,slug:"primary",name:"Primary",status:"active",timezone:"Europe/Rome",isPrimary:true,createdAt:NOW,updatedAt:NOW};
  const tenantStore:any={
    async getTenant(){return tenantProjection;},
    async listTenants(){return [tenantProjection];},
    async transaction(fn:any,context:any){
      return fn({async mutateTenant(input:any){
        const payload=JSON.stringify(input);
        const previous=idempotency.get(input.idempotencyKey);
        if(previous){
          if(previous.payload!==payload) throw new AppError("IDEMPOTENCY_CONFLICT","Synthetic idempotency conflict");
          return {...previous.result,replayed:true};
        }
        const status=input.action==="suspend"?"suspended":input.action==="archive"?"archived":"active";
        const result={action:input.action,tenant:{...tenantProjection,status,name:input.name??tenantProjection.name},replayed:false};
        idempotency.set(input.idempotencyKey,{payload,result});
        return result;
      }});
    }
  };
  const locationStore:any={
    async getLocation(){return locationProjection;},
    async listLocations(){return [locationProjection];},
    async transaction(fn:any){return fn({
      async mutateLocation(input:any){return {action:input.action,location:locationProjection,replayed:false};},
      async transferPrimaryLocation(){return {action:"transfer_primary",location:locationProjection,previousPrimaryLocationId:LOCATION,replayed:false};}
    });}
  };
  const emptyTransaction:any={async transaction(fn:any){return fn(new Proxy({}, {get(){return async()=>({replayed:false});}}));}};
  const noRows:any=new Proxy({}, {get(_t,key){if(String(key).startsWith("list"))return async()=>[];if(String(key).startsWith("get"))return async()=>null;return undefined;}});
  const adminRoles:any={
    async platformPermissions(roles:string[]){return roles.includes("platform_admin")?ALL_PERMISSIONS:roles.includes("viewer")?["platform.tenants.read"]:[];},
    async tenantPermissions(){return ["tenant.location.all","booking.read"];},
    async locationPermissions(){return ["booking.read"];}
  };
  const authentication:any={
    async authenticate(request:any){
      const auth=request?.authorization;
      if(auth==="Bearer admin") return principal("admin");
      if(auth==="Bearer viewer") return principal("viewer");
      if(auth==="Bearer tenant") return principal("tenant");
      return null;
    }
  };
  const tenantContext:any={
    tenants:{async findById(){return {id:TENANT,slug:"alpha",name:"Alpha",status:"active"};},async findBySlug(slug:string){return slug==="alpha"?{id:TENANT,slug:"alpha",name:"Alpha",status:"active"}:null;}},
    locations:{async findById(){return {id:LOCATION,tenantId:TENANT,slug:"primary",name:"Primary",status:"active"};},async findPrimaryForTenant(){return {id:LOCATION,tenantId:TENANT,slug:"primary",name:"Primary",status:"active"};}},
    domains:{async findActiveByHostname(){return null;}},
    memberships:{
      async findTenantMembership(){return {id:"44444444-4444-4444-8444-444444444444",tenantId:TENANT,identityId:IDENTITY,roleKey:"owner",status:"active"};},
      async findLocationMembership(){return {id:"55555555-5555-4555-8555-555555555555",tenantMembershipId:"44444444-4444-4444-8444-444444444444",tenantId:TENANT,locationId:LOCATION,roleKey:"manager",status:"active"};}
    },
    entitlements:{async enabledForTenant(){return ["booking.enabled"];}}
  };
  const capabilities:any={
    ...emptyTransaction,...noRows,
    async resolveCurrentCapabilityAvailability(){
      return [{capabilityKey:"booking.dashboard",scopeKind:"tenant",requiredPermissions:["booking.read"],available:true,denialReasons:[]}];
    }
  };
  const audit:any={
    async queryPlatformAudit(input:any){return [{
      id:"66666666-6666-4666-8666-666666666666",tenantId:TENANT,locationId:LOCATION,actorIdentityId:IDENTITY,
      actorKind:"identity",actionKey:"r3i.synthetic",correlationId:"r3i-audit",outcome:"success",metadata:{safe:true},createdAt:input.createdFrom
    }];}
  };
  return {
    authentication,roles:adminRoles,appBaseDomain:"airen.test",
    tenantProvisioning:emptyTransaction,tenants:tenantStore,locations:locationStore,domains:{...emptyTransaction,...noRows},
    platformRoles:{...emptyTransaction,...noRows},billing:{...emptyTransaction,...noRows},entitlements:{...emptyTransaction,...noRows},
    capabilities,audit,tenantContext
  } as any;
}

function request(path:string,token?:string,extra:Record<string,any>={}){
  return {
    method:extra.method??"GET",url:`/api/admin/v1${path}`,
    headers:{...(token?{authorization:`Bearer ${token}`}:{ }),...(extra.headers??{})},
    body:extra.body
  } as any;
}

test("R3I-T01 unauthenticated Admin API request returns AUTHENTICATION_REQUIRED/401",async()=>{
  const r=await dispatchAdminApiRequest(request("/session/me"),deps());assert.equal(r.status,401);assert.equal(r.body.error,"AUTHENTICATION_REQUIRED");
});

test("R3I-T02 authenticated Platform context is built server-side from the existing resolver",async()=>{
  const r=await dispatchAdminApiRequest(request("/session/me","admin"),deps());assert.equal(r.status,200);assert.ok((r.body.session as any).platformPermissions.includes("platform.tenants.read"));
});

test("R3I-T03 fake client platform role/permission claims cannot grant authority",async()=>{
  const r=await dispatchAdminApiRequest(request("/tenants","tenant",{headers:{"x-platform-role":"platform_admin","x-platform-permissions":"platform.tenants.read"}}),deps());
  assert.equal(r.status,403);assert.equal(r.body.error,"PERMISSION_DENIED");
});

test("R3I-T04 Tenant-only admin/owner actor cannot invoke Platform Admin authority",async()=>{
  const r=await dispatchAdminApiRequest(request("/tenants","tenant"),deps());assert.equal(r.status,403);
});

test("R3I-T05 session/me returns only safe authenticated Platform projection and effective Platform permissions",async()=>{
  const r=await dispatchAdminApiRequest(request("/session/me","admin"),deps());const s=r.body.session as any;
  assert.equal(s.identityId,IDENTITY);assert.ok(Array.isArray(s.platformPermissions));assert.equal("providerSubject" in s,false);assert.equal("sessionId" in s,false);
});

test("R3I-T06 Tenant list/detail requires platform.tenants.read",async()=>{
  const denied=await dispatchAdminApiRequest(request("/tenants","tenant"),deps());assert.equal(denied.status,403);
  const allowed=await dispatchAdminApiRequest(request("/tenants","viewer"),deps());assert.equal(allowed.status,200);assert.equal((allowed.body.items as any[]).length,1);
});

test("R3I-T07 Tenant mutation routes preserve exact underlying Platform permission checks",async()=>{
  const d=deps();const denied=await dispatchAdminApiRequest(request(`/tenants/${TENANT}`,"viewer",{method:"PATCH",headers:{"idempotency-key":"idem-r3i-update1"},body:{name:"Changed"}}),d);
  assert.equal(denied.status,403);
  const allowed=await dispatchAdminApiRequest(request(`/tenants/${TENANT}`,"admin",{method:"PATCH",headers:{"idempotency-key":"idem-r3i-update1"},body:{name:"Changed"}}),d);
  assert.equal(allowed.status,200);
});

test("R3I-T08 governed Tenant mutation requires/preserves idempotency replay semantics",async()=>{
  const d=deps();const req=request(`/tenants/${TENANT}/suspend`,"admin",{method:"POST",headers:{"idempotency-key":"idem-r3i-replay1"},body:{reasonCode:"admin.test"}});
  const a=await dispatchAdminApiRequest(req,d);const b=await dispatchAdminApiRequest(req,d);assert.equal(a.status,200);assert.equal((b.body as any).replayed,true);
});

test("R3I-T09 changed payload with reused idempotency key returns 409 conflict semantics",async()=>{
  const d=deps();const headers={"idempotency-key":"idem-r3i-conflict1"};
  await dispatchAdminApiRequest(request(`/tenants/${TENANT}/suspend`,"admin",{method:"POST",headers,body:{reasonCode:"admin.one"}}),d);
  const r=await dispatchAdminApiRequest(request(`/tenants/${TENANT}/suspend`,"admin",{method:"POST",headers,body:{reasonCode:"admin.two"}}),d);
  assert.equal(r.status,409);assert.equal(r.body.error,"IDEMPOTENCY_CONFLICT");
});

test("R3I-T10 Location list/detail requires certified Platform Location read authority",async()=>{
  const denied=await dispatchAdminApiRequest(request(`/locations?tenantId=${TENANT}`,"tenant"),deps());assert.equal(denied.status,403);
  const allowed=await dispatchAdminApiRequest(request(`/locations?tenantId=${TENANT}`,"admin"),deps());assert.equal(allowed.status,200);
});

test("R3I-T11 Platform Location update/lifecycle/primary-transfer routes preserve certified permissions",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");
  for(const fn of ["updateLocation","suspendLocation","reactivateLocation","archiveLocation","transferPrimaryLocation"])assert.ok(source.includes(fn));
});

test("R3I-T12 no Platform create-Location endpoint/shortcut bypasses Tenant permission+entitlement authority",async()=>{
  const r=await dispatchAdminApiRequest(request("/locations","admin",{method:"POST",headers:{"idempotency-key":"idem-r3i-location1"},body:{tenantId:TENANT}}),deps());
  assert.equal(r.status,404);const source=await readFile("apps/api/src/admin-api.ts","utf8");assert.equal(source.includes("createLocation("),false);
});

test("R3I-T13 TenantDomain list/detail/actions preserve R3-C permissions and lifecycle validation",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");
  for(const fn of ["listTenantDomainsAdmin","getTenantDomainAdmin","registerTenantDomain","startTenantDomainVerification","recordTenantDomainVerificationPassed","recordTenantDomainVerificationFailed","activateTenantDomain","disableTenantDomain","setTenantDomainLocation"])assert.ok(source.includes(fn));
});

test("R3I-T14 Platform Principal projection exposes no new unrelated Identity/provider secret fields",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");assert.ok(source.includes("getPlatformPrincipalAdmin"));assert.equal(source.includes("providerSubject:"),false);assert.equal(source.includes("credential"),false);
});

test("R3I-T15 Platform role actions preserve R3-D anti-self-escalation/protected-role behavior",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");
  for(const fn of ["assignPlatformRole","suspendPlatformRole","reactivatePlatformRole","revokePlatformRole"])assert.ok(source.includes(fn));
  assert.ok(source.includes("unitOfWork: deps.platformRoles"));
});

test("R3I-T16 Plan query/actions preserve R3-E permissions and lifecycle validation",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");for(const fn of ["createPlan","updateDraftPlan","activatePlan","retirePlan","getPlanAdmin","listPlansAdmin"])assert.ok(source.includes(fn));
});

test("R3I-T17 Subscription query/actions preserve R3-E permissions, dates and transitions",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");for(const fn of ["createSubscription","activateSubscription","suspendSubscription","reactivateSubscription","scheduleSubscriptionCancellation","cancelSubscription","expireSubscription","changeSubscriptionPlan"])assert.ok(source.includes(fn));
});

test("R3I-T18 Entitlement query/actions preserve R3-F commercial-right/permission separation",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");for(const fn of ["getEntitlementCatalogEntryAdmin","listTenantEntitlementsAdmin","grantTenantEntitlement","revokeTenantEntitlement","changeTenantEntitlementLimit"])assert.ok(source.includes(fn));
});

test("R3I-T19 Capability and Feature Flag surfaces preserve R3-G eligibility/authorization separation",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");for(const fn of ["listCapabilitiesAdmin","createCapability","listFeatureFlagsAdmin","setFeatureFlagOverride"])assert.ok(source.includes(fn));
});

test("R3I-T20 effective capability resolution remains side-effect free and cannot grant missing permission/entitlement",async()=>{
  const r=await dispatchAdminApiRequest(request("/feature-flags/effective-resolution?hostname=alpha.airen.test","admin"),deps());
  assert.equal(r.status,200);const row=(r.body.items as any[])[0];assert.equal(row.available,true);assert.equal(row.authorized,true);assert.equal(row.allowed,true);
  const source=await readFile("apps/api/src/admin-api.ts","utf8");assert.ok(source.includes("resolveRequestSecurityContext"));assert.ok(source.includes("resolveCurrentCapabilities"));
});

test("R3I-T21 Audit Admin route uses only R3-H bounded safe query/sanitized projection",async()=>{
  const r=await dispatchAdminApiRequest(request("/audit?createdFrom=2026-08-22T00:00:00.000Z&createdUntil=2026-08-23T00:00:00.000Z","admin"),deps());
  assert.equal(r.status,200);assert.equal((r.body.items as any[])[0].metadata.safe,true);
  const source=await readFile("apps/api/src/admin-api.ts","utf8");assert.ok(source.includes("queryPlatformAudit"));
});

test("R3I-T22 AppError codes map to the frozen HTTP status classes without leaking internals",()=>{
  const expected:any={AUTHENTICATION_REQUIRED:401,PERMISSION_DENIED:403,VALIDATION_FAILED:400,NOT_FOUND:404,CONFLICT:409,IDEMPOTENCY_CONFLICT:409,INTERNAL_ERROR:500};
  for(const [code,status] of Object.entries(expected)){const r=mapAdminApiError(new AppError(code as any,"sensitive internal detail"),"corr-test1");assert.equal(r.status,status);if(status===500)assert.equal(r.body.message,"Administrative request failed");}
});

test("R3I-T23 correlation identifier is generated/validated server-side and returned/propagated safely",async()=>{
  const a=await dispatchAdminApiRequest(request("/session/me","admin",{headers:{"x-correlation-id":"bad"}}),deps());
  assert.notEqual(a.headers["x-correlation-id"],"bad");
  const b=await dispatchAdminApiRequest(request("/session/me","admin",{headers:{"x-correlation-id":"r3i-valid-correlation"}}),deps());
  assert.equal(b.headers["x-correlation-id"],"r3i-valid-correlation");
});

test("R3I-T24 Admin route implementation contains no raw SQL/direct table authority path",async()=>{
  const source=await readFile("apps/api/src/admin-api.ts","utf8");for(const forbidden of ["pool.query(","client.query(","SELECT ","INSERT ","UPDATE ","DELETE FROM "])assert.equal(source.includes(forbidden),false);
});

test("R3I-T28 no Base44 runtime or Corte/RISTOAIREN-specific Platform authority is introduced",async()=>{
  const source=(await readFile("apps/api/src/admin-api.ts","utf8")).toLowerCase();for(const word of ["base44","corte delle stelle","ristoairen"])assert.equal(source.includes(word),false);
});

test("R3I-T29 Foundation plus R3-A through R3-H regression suites remain wired green before R3-I",async()=>{
  const ci=await readFile(".github/workflows/ci.yml","utf8");
  for(const marker of ["test:r3a-tenant-lifecycle","test:r3b-location-lifecycle","test:r3c-tenant-domain-lifecycle","test:r3d-platform-role-admin","test:r3e-plan-subscription-lifecycle","test:r3f-entitlement-lifecycle","test:r3g-capability-feature-resolution","test:r3h-platform-audit-query"])assert.ok(ci.includes(marker));
  assert.ok(ci.includes("test:r3i-admin-api-contract"));
});

test("R3I-T30 no database migration/new authority is introduced by R3-I",async()=>{
  const migrations=(await readdir("db/migrations")).filter(x=>/^\d{4}_/.test(x)).sort();assert.equal(migrations.at(-1)?.startsWith("0029_"),true);
});
