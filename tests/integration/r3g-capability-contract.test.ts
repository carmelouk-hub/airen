import test from "node:test";
import assert from "node:assert/strict";
import {
  createCapability, createFeatureFlag, resolveCurrentCapabilities, setFeatureFlagOverride,
  listCapabilitiesAdmin, type CapabilityLifecycleTransaction, type CapabilityLifecycleUnitOfWork,
  type CapabilityMutationResult, type FeatureFlagMutationResult, type FeatureFlagOverrideMutationResult
} from "../../packages/capabilities/src/index.ts";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";

const admin:PlatformSecurityContext={scopeKind:"platform",correlationId:"r3g-app",actorIdentityId:"00000000-0000-4000-8000-000000000001",platformRoles:["platform_admin"],platformPermissions:["platform.capabilities.create","platform.capabilities.read","platform.feature_flags.create","platform.feature_flags.set_override"]};
let captured:any;
const tx:CapabilityLifecycleTransaction={
  async mutateCapability(input:any):Promise<CapabilityMutationResult>{captured=input;return {replayed:false,capability:{id:"10000000-0000-4000-8000-000000000001",capabilityKey:input.capabilityKey,name:input.name,description:input.description??undefined,status:"draft",scopeKind:input.scopeKind,requiredEntitlements:input.requiredEntitlements??[],requiredPermissions:input.requiredPermissions??[],featureFlagKey:input.featureFlagKey??undefined,auditLevel:input.auditLevel??"standard",aiAccessMode:input.aiAccessMode??"none",createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()}};},
  async mutateFeatureFlag(input:any):Promise<FeatureFlagMutationResult>{captured=input;return {replayed:false,featureFlag:{id:"20000000-0000-4000-8000-000000000001",featureFlagKey:input.featureFlagKey,description:input.description??undefined,status:"active",enabledDefault:Boolean(input.enabledDefault),validFrom:input.validFrom??undefined,validUntil:input.validUntil??undefined,createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()}};},
  async mutateFeatureFlagOverride(input:any):Promise<FeatureFlagOverrideMutationResult>{captured=input;return {replayed:false,override:{id:"30000000-0000-4000-8000-000000000001",featureFlagKey:input.featureFlagKey,subjectKind:input.subjectKind,tenantId:input.tenantId,locationId:input.locationId,enabled:Boolean(input.enabled),validFrom:input.validFrom??undefined,validUntil:input.validUntil??undefined,reasonCode:input.reasonCode,status:"active",createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()}};}
};
const uow:CapabilityLifecycleUnitOfWork={async transaction(fn){return fn(tx);}};

test("R3-G application contract normalizes requirements and preserves authority separation",async()=>{
  const r=await createCapability({idempotencyKey:"r3g-create-0001",capabilityKey:" Booking.Dashboard ",name:" Booking Dashboard ",scopeKind:"tenant",requiredEntitlements:["booking.enabled","booking.enabled"],requiredPermissions:["booking.read","booking.read"],featureFlagKey:" booking.rollout "},{context:admin,unitOfWork:uow});
  assert.equal(r.capability.capabilityKey,"booking.dashboard");
  assert.deepEqual(captured.requiredEntitlements,["booking.enabled"]); assert.deepEqual(captured.requiredPermissions,["booking.read"]); assert.equal(captured.featureFlagKey,"booking.rollout");

  await createFeatureFlag({idempotencyKey:"r3g-flag-00001",featureFlagKey:"booking.rollout",enabledDefault:false},{context:admin,unitOfWork:uow});
  assert.equal(captured.enabledDefault,false);
  await setFeatureFlagOverride({idempotencyKey:"r3g-override-01",featureFlagKey:"booking.rollout",subjectKind:"tenant",tenantId:"40000000-0000-4000-8000-000000000001",enabled:true,reasonCode:"rollout.test"},{context:admin,unitOfWork:uow});
  assert.equal(captured.subjectKind,"tenant");

  const base:SecurityContext={correlationId:"r3g-resolve",actorIdentityId:admin.actorIdentityId,platformRoles:[],platformPermissions:[],tenantId:"40000000-0000-4000-8000-000000000001",locationId:"50000000-0000-4000-8000-000000000001",permissions:[],entitlements:["booking.enabled"]};
  const resolver={async resolveCurrentCapabilityAvailability(){return [{capabilityKey:"booking.dashboard",scopeKind:"tenant" as const,requiredPermissions:["booking.read"],available:true,denialReasons:[]}]}};
  const denied=await resolveCurrentCapabilities({context:base,resolver}); assert.equal(denied[0].available,true); assert.equal(denied[0].authorized,false); assert.equal(denied[0].allowed,false); assert.deepEqual(denied[0].denialReasons,["permission_missing"]);
  const allowed=await resolveCurrentCapabilities({context:{...base,permissions:["booking.read"]},resolver}); assert.equal(allowed[0].allowed,true);

  await assert.rejects(()=>createCapability({idempotencyKey:"r3g-noauth-001",capabilityKey:"booking.other",name:"Other",scopeKind:"tenant"},{context:{...admin,platformPermissions:[]},unitOfWork:uow}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
  await assert.rejects(()=>setFeatureFlagOverride({idempotencyKey:"r3g-bad-scope1",featureFlagKey:"booking.rollout",subjectKind:"location",tenantId:"40000000-0000-4000-8000-000000000001",enabled:true,reasonCode:"rollout.test"},{context:admin,unitOfWork:uow}),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");
  assert.throws(()=>listCapabilitiesAdmin({limit:101},{context:admin,queries:{getCapability:async()=>null,listCapabilities:async()=>[],getFeatureFlag:async()=>null,listFeatureFlags:async()=>[],listFeatureFlagOverrides:async()=>[]}}),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");
});
