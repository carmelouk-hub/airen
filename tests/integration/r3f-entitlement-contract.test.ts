import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  createEntitlementCatalogEntry, grantTenantEntitlement, changeTenantEntitlementLimit, requireEntitlement,
  type EntitlementLifecycleTransaction, type EntitlementLifecycleUnitOfWork
} from "../../packages/entitlements/src/index.ts";

const ACTOR="f0000000-0000-4000-8000-000000000001";
const TENANT="f1000000-0000-4000-8000-000000000001";
const all:PlatformSecurityContext={scopeKind:"platform",correlationId:"r3f-contract",actorIdentityId:ACTOR,platformRoles:["platform_admin"],platformPermissions:[
  "platform.entitlements.catalog.create","platform.entitlements.grant","platform.entitlements.change_limit"
]};
let captured:any;
const tx:EntitlementLifecycleTransaction={
  async mutateCatalog(input){ captured=input; return {catalog:{entitlementKey:input.entitlementKey,description:input.description??undefined,status:"active",createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()},replayed:false}; },
  async mutateTenantEntitlement(input){ captured=input; return {entitlement:{tenantId:input.tenantId,entitlementKey:input.entitlementKey,sourceKind:input.sourceKind??"manual",enabled:true,derivedState:"effective",limitValue:input.limitValue??undefined,config:input.config??{},createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()},replayed:false}; }
};
const uow:EntitlementLifecycleUnitOfWork={async transaction(fn){return fn(tx);}};

test("R3-F application contract preserves enforcement and validates governed inputs",async()=>{
  const created=await createEntitlementCatalogEntry({idempotencyKey:"r3f-catalog-create-v1",entitlementKey:"Feature.Advanced",description:"Advanced"},{context:all,unitOfWork:uow});
  assert.equal(created.catalog.entitlementKey,"feature.advanced");
  assert.equal(captured.action,"create");
  const granted=await grantTenantEntitlement({idempotencyKey:"r3f-grant-contract-v1",tenantId:TENANT,entitlementKey:"feature.advanced",sourceKind:"Migration.Source",limitValue:10,config:{mode:"safe"}},{context:all,unitOfWork:uow});
  assert.equal(granted.entitlement.sourceKind,"migration.source");
  assert.equal(captured.config.mode,"safe");
  await changeTenantEntitlementLimit({idempotencyKey:"r3f-limit-contract-v1",tenantId:TENANT,entitlementKey:"feature.advanced",limitValue:null},{context:all,unitOfWork:uow});
  assert.equal(captured.limitValue,null);
  const tenantContext:SecurityContext={correlationId:"r3f-enforce",actorIdentityId:ACTOR,platformRoles:[],platformPermissions:[],tenantId:TENANT,locationId:"f2000000-0000-4000-8000-000000000001",permissions:[],entitlements:["feature.advanced"]};
  assert.doesNotThrow(()=>requireEntitlement(tenantContext,"feature.advanced"));
  assert.throws(()=>requireEntitlement(tenantContext,"feature.missing"),(e:unknown)=>e instanceof AppError&&e.code==="ENTITLEMENT_REQUIRED");
  const denied={...all,platformPermissions:[]} as PlatformSecurityContext;
  await assert.rejects(()=>grantTenantEntitlement({idempotencyKey:"r3f-denied-contract-v1",tenantId:TENANT,entitlementKey:"feature.advanced",sourceKind:"manual"},{context:denied,unitOfWork:uow}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
  await assert.rejects(()=>grantTenantEntitlement({idempotencyKey:"r3f-bad-source-contract",tenantId:TENANT,entitlementKey:"feature.advanced",sourceKind:"BAD SOURCE"},{context:all,unitOfWork:uow}),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");
});
