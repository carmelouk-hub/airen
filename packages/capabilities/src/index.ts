import { AppError, hasPermission, type PlatformSecurityContext, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "../../authorization/src/index.ts";

export type CapabilityStatus = "draft" | "active" | "retired";
export type CapabilityScopeKind = "tenant" | "location";
export type CapabilityAuditLevel = "standard" | "elevated" | "critical";
export type CapabilityAiAccessMode = "none" | "read" | "propose" | "governed_write";
export type FeatureFlagStatus = "active" | "retired";
export type FeatureFlagOverrideSubjectKind = "tenant" | "location";
export type FeatureFlagOverrideStatus = "active" | "removed";
export type CapabilityLifecycleAction = "create" | "update" | "activate" | "retire";
export type FeatureFlagLifecycleAction = "create" | "update" | "set_default" | "retire";
export type FeatureFlagOverrideAction = "set_override" | "remove_override";

export type CapabilityProjection = Readonly<{
  id: UUID; capabilityKey: string; name: string; description?: string; status: CapabilityStatus; scopeKind: CapabilityScopeKind;
  requiredEntitlements: readonly string[]; requiredPermissions: readonly string[]; featureFlagKey?: string;
  auditLevel: CapabilityAuditLevel; aiAccessMode: CapabilityAiAccessMode; createdAt: string; updatedAt: string; activatedAt?: string; retiredAt?: string;
}>;
export type FeatureFlagProjection = Readonly<{
  id: UUID; featureFlagKey: string; description?: string; status: FeatureFlagStatus; enabledDefault: boolean;
  validFrom?: string; validUntil?: string; createdAt: string; updatedAt: string; retiredAt?: string;
}>;
export type FeatureFlagOverrideProjection = Readonly<{
  id: UUID; featureFlagKey: string; subjectKind: FeatureFlagOverrideSubjectKind; tenantId: UUID; locationId?: UUID; enabled: boolean;
  validFrom?: string; validUntil?: string; reasonCode: string; status: FeatureFlagOverrideStatus; createdAt: string; updatedAt: string; removedAt?: string;
}>;
export type EffectiveCapabilityProjection = Readonly<{
  capabilityKey: string; scopeKind: CapabilityScopeKind; available: boolean; authorized: boolean; allowed: boolean; denialReasons: readonly string[];
}>;
export type CapabilityMutationResult = Readonly<{ capability: CapabilityProjection; replayed: boolean }>;
export type FeatureFlagMutationResult = Readonly<{ featureFlag: FeatureFlagProjection; replayed: boolean }>;
export type FeatureFlagOverrideMutationResult = Readonly<{ override: FeatureFlagOverrideProjection; replayed: boolean }>;

export interface CapabilityLifecycleTransaction {
  mutateCapability(input: Readonly<{ action: CapabilityLifecycleAction; idempotencyKey: string; capabilityKey: string; name?: string; description?: string|null; scopeKind?: CapabilityScopeKind; requiredEntitlements?: readonly string[]; requiredPermissions?: readonly string[]; featureFlagKey?: string|null; auditLevel?: CapabilityAuditLevel; aiAccessMode?: CapabilityAiAccessMode; reasonCode?: string }>): Promise<CapabilityMutationResult>;
  mutateFeatureFlag(input: Readonly<{ action: FeatureFlagLifecycleAction; idempotencyKey: string; featureFlagKey: string; description?: string|null; enabledDefault?: boolean; validFrom?: string|null; validUntil?: string|null; reasonCode?: string }>): Promise<FeatureFlagMutationResult>;
  mutateFeatureFlagOverride(input: Readonly<{ action: FeatureFlagOverrideAction; idempotencyKey: string; featureFlagKey: string; subjectKind: FeatureFlagOverrideSubjectKind; tenantId: UUID; locationId?: UUID; enabled?: boolean; validFrom?: string|null; validUntil?: string|null; reasonCode: string }>): Promise<FeatureFlagOverrideMutationResult>;
}
export interface CapabilityLifecycleUnitOfWork { transaction<T>(fn:(tx:CapabilityLifecycleTransaction)=>Promise<T>,context:PlatformSecurityContext):Promise<T>; }
export interface PlatformCapabilityQueryStore {
  getCapability(capabilityKey:string,context:PlatformSecurityContext):Promise<CapabilityProjection|null>;
  listCapabilities(input:Readonly<{status?:CapabilityStatus;scopeKind?:CapabilityScopeKind;afterKey?:string;limit?:number}>,context:PlatformSecurityContext):Promise<readonly CapabilityProjection[]>;
  getFeatureFlag(featureFlagKey:string,context:PlatformSecurityContext):Promise<FeatureFlagProjection|null>;
  listFeatureFlags(input:Readonly<{status?:FeatureFlagStatus;afterKey?:string;limit?:number}>,context:PlatformSecurityContext):Promise<readonly FeatureFlagProjection[]>;
  listFeatureFlagOverrides(input:Readonly<{featureFlagKey?:string;tenantId?:UUID;subjectKind?:FeatureFlagOverrideSubjectKind;status?:FeatureFlagOverrideStatus;limit?:number}>,context:PlatformSecurityContext):Promise<readonly FeatureFlagOverrideProjection[]>;
}
export interface CurrentCapabilityAvailabilityRow { capabilityKey:string; scopeKind:CapabilityScopeKind; requiredPermissions:readonly string[]; available:boolean; denialReasons:readonly string[]; }
export interface CurrentCapabilityAvailabilityResolver { resolveCurrentCapabilityAvailability(context:SecurityContext):Promise<readonly CurrentCapabilityAvailabilityRow[]>; }

const KEY=/^[a-z][a-z0-9._:-]{2,127}$/; const IDEM=/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/; const REASON=/^[a-z0-9][a-z0-9._:-]{2,63}$/;
function key(v:string,label:string){const n=v.trim().toLowerCase();if(!KEY.test(n))throw new AppError("VALIDATION_FAILED",`Invalid ${label}`);return n;}
function idem(v:string){const n=v.trim();if(n!==v||!IDEM.test(n))throw new AppError("VALIDATION_FAILED","Invalid capability idempotency key");return n;}
function reason(v?:string,required=false){if(v==null&&!required)return undefined;const n=(v??"").trim().toLowerCase();if(!REASON.test(n))throw new AppError("VALIDATION_FAILED","Invalid or missing reasonCode");return n;}
function text(v:string,label:string,max=160){const n=v.trim();if(!n||n.length>max)throw new AppError("VALIDATION_FAILED",`${label} must be 1..${max} characters`);return n;}
function description(v?:string|null){if(v==null)return v;const n=v.trim();if(n.length>2000)throw new AppError("VALIDATION_FAILED","Description is too long");return n||null;}
function keys(v:readonly string[]|undefined,label:string){if(v==null)return undefined;return [...new Set(v.map(x=>key(x,label)))].sort();}
function iso(v?:string|null){if(v==null)return v;const d=new Date(v);if(!Number.isFinite(d.getTime()))throw new AppError("VALIDATION_FAILED","Invalid validity timestamp");return d.toISOString();}
function validateWindow(from?:string|null,until?:string|null){const f=iso(from),u=iso(until);if(f&&u&&new Date(u)<=new Date(f))throw new AppError("VALIDATION_FAILED","validUntil must be after validFrom");return {validFrom:f,validUntil:u};}
function listLimit(v?:number){const n=v??50;if(!Number.isInteger(n)||n<1||n>100)throw new AppError("VALIDATION_FAILED","list limit must be between 1 and 100");return n;}

export async function createCapability(input:Readonly<{idempotencyKey:string;capabilityKey:string;name:string;description?:string|null;scopeKind:CapabilityScopeKind;requiredEntitlements?:readonly string[];requiredPermissions?:readonly string[];featureFlagKey?:string|null;auditLevel?:CapabilityAuditLevel;aiAccessMode?:CapabilityAiAccessMode;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork}){
  requirePlatformPermission(deps.context,"platform.capabilities.create");
  if(!(["tenant","location"] as const).includes(input.scopeKind))throw new AppError("VALIDATION_FAILED","Invalid capability scopeKind");
  const audit=input.auditLevel??"standard"; if(!(["standard","elevated","critical"] as const).includes(audit))throw new AppError("VALIDATION_FAILED","Invalid auditLevel");
  const ai=input.aiAccessMode??"none"; if(!(["none","read","propose","governed_write"] as const).includes(ai))throw new AppError("VALIDATION_FAILED","Invalid aiAccessMode");
  return deps.unitOfWork.transaction(tx=>tx.mutateCapability({action:"create",idempotencyKey:idem(input.idempotencyKey),capabilityKey:key(input.capabilityKey,"capabilityKey"),name:text(input.name,"Capability name"),description:description(input.description),scopeKind:input.scopeKind,requiredEntitlements:keys(input.requiredEntitlements,"entitlement requirement")??[],requiredPermissions:keys(input.requiredPermissions,"permission requirement")??[],featureFlagKey:input.featureFlagKey==null?input.featureFlagKey:key(input.featureFlagKey,"featureFlagKey"),auditLevel:audit,aiAccessMode:ai,reasonCode:reason(input.reasonCode)}),deps.context);
}
export async function updateDraftCapability(input:Readonly<{idempotencyKey:string;capabilityKey:string;name:string;description?:string|null;scopeKind:CapabilityScopeKind;requiredEntitlements?:readonly string[];requiredPermissions?:readonly string[];featureFlagKey?:string|null;auditLevel?:CapabilityAuditLevel;aiAccessMode?:CapabilityAiAccessMode;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork}){
  requirePlatformPermission(deps.context,"platform.capabilities.update");
  if(!(["tenant","location"] as const).includes(input.scopeKind))throw new AppError("VALIDATION_FAILED","Invalid capability scopeKind");
  const audit=input.auditLevel??"standard"; const ai=input.aiAccessMode??"none";
  return deps.unitOfWork.transaction(tx=>tx.mutateCapability({action:"update",idempotencyKey:idem(input.idempotencyKey),capabilityKey:key(input.capabilityKey,"capabilityKey"),name:text(input.name,"Capability name"),description:description(input.description),scopeKind:input.scopeKind,requiredEntitlements:keys(input.requiredEntitlements,"entitlement requirement")??[],requiredPermissions:keys(input.requiredPermissions,"permission requirement")??[],featureFlagKey:input.featureFlagKey==null?input.featureFlagKey:key(input.featureFlagKey,"featureFlagKey"),auditLevel:audit,aiAccessMode:ai,reasonCode:reason(input.reasonCode)}),deps.context);
}
async function capabilityTransition(action:"activate"|"retire",permission:string,input:Readonly<{idempotencyKey:string;capabilityKey:string;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork}){requirePlatformPermission(deps.context,permission);return deps.unitOfWork.transaction(tx=>tx.mutateCapability({action,idempotencyKey:idem(input.idempotencyKey),capabilityKey:key(input.capabilityKey,"capabilityKey"),reasonCode:reason(input.reasonCode)}),deps.context);}
export const activateCapability=(input:Readonly<{idempotencyKey:string;capabilityKey:string;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork})=>capabilityTransition("activate","platform.capabilities.activate",input,deps);
export const retireCapability=(input:Readonly<{idempotencyKey:string;capabilityKey:string;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork})=>capabilityTransition("retire","platform.capabilities.retire",input,deps);

export async function createFeatureFlag(input:Readonly<{idempotencyKey:string;featureFlagKey:string;description?:string|null;enabledDefault:boolean;validFrom?:string|null;validUntil?:string|null;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork}){requirePlatformPermission(deps.context,"platform.feature_flags.create");const w=validateWindow(input.validFrom,input.validUntil);return deps.unitOfWork.transaction(tx=>tx.mutateFeatureFlag({action:"create",idempotencyKey:idem(input.idempotencyKey),featureFlagKey:key(input.featureFlagKey,"featureFlagKey"),description:description(input.description),enabledDefault:input.enabledDefault,...w,reasonCode:reason(input.reasonCode)}),deps.context);}
export async function updateFeatureFlag(input:Readonly<{idempotencyKey:string;featureFlagKey:string;description?:string|null;validFrom?:string|null;validUntil?:string|null;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork}){requirePlatformPermission(deps.context,"platform.feature_flags.update");const w=validateWindow(input.validFrom,input.validUntil);return deps.unitOfWork.transaction(tx=>tx.mutateFeatureFlag({action:"update",idempotencyKey:idem(input.idempotencyKey),featureFlagKey:key(input.featureFlagKey,"featureFlagKey"),description:description(input.description),...w,reasonCode:reason(input.reasonCode)}),deps.context);}
export async function setFeatureFlagDefault(input:Readonly<{idempotencyKey:string;featureFlagKey:string;enabledDefault:boolean;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork}){requirePlatformPermission(deps.context,"platform.feature_flags.set_default");return deps.unitOfWork.transaction(tx=>tx.mutateFeatureFlag({action:"set_default",idempotencyKey:idem(input.idempotencyKey),featureFlagKey:key(input.featureFlagKey,"featureFlagKey"),enabledDefault:input.enabledDefault,reasonCode:reason(input.reasonCode,true)}),deps.context);}
export async function retireFeatureFlag(input:Readonly<{idempotencyKey:string;featureFlagKey:string;reasonCode?:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork}){requirePlatformPermission(deps.context,"platform.feature_flags.retire");return deps.unitOfWork.transaction(tx=>tx.mutateFeatureFlag({action:"retire",idempotencyKey:idem(input.idempotencyKey),featureFlagKey:key(input.featureFlagKey,"featureFlagKey"),reasonCode:reason(input.reasonCode,true)}),deps.context);}

async function overrideMutation(action:FeatureFlagOverrideAction,input:Readonly<{idempotencyKey:string;featureFlagKey:string;subjectKind:FeatureFlagOverrideSubjectKind;tenantId:UUID;locationId?:UUID;enabled?:boolean;validFrom?:string|null;validUntil?:string|null;reasonCode:string}>,deps:{context:PlatformSecurityContext;unitOfWork:CapabilityLifecycleUnitOfWork}){requirePlatformPermission(deps.context,action==="set_override"?"platform.feature_flags.set_override":"platform.feature_flags.remove_override");if(!(["tenant","location"] as const).includes(input.subjectKind))throw new AppError("VALIDATION_FAILED","Invalid override subjectKind");if(input.subjectKind==="tenant"&&input.locationId)throw new AppError("VALIDATION_FAILED","Tenant override cannot include locationId");if(input.subjectKind==="location"&&!input.locationId)throw new AppError("VALIDATION_FAILED","Location override requires locationId");if(action==="set_override"&&typeof input.enabled!=="boolean")throw new AppError("VALIDATION_FAILED","set_override requires enabled");const w=validateWindow(input.validFrom,input.validUntil);return deps.unitOfWork.transaction(tx=>tx.mutateFeatureFlagOverride({action,idempotencyKey:idem(input.idempotencyKey),featureFlagKey:key(input.featureFlagKey,"featureFlagKey"),subjectKind:input.subjectKind,tenantId:input.tenantId,locationId:input.locationId,enabled:input.enabled,...w,reasonCode:reason(input.reasonCode,true)!}),deps.context);}
export const setFeatureFlagOverride=(input:Parameters<typeof overrideMutation>[1],deps:Parameters<typeof overrideMutation>[2])=>overrideMutation("set_override",input,deps);
export const removeFeatureFlagOverride=(input:Parameters<typeof overrideMutation>[1],deps:Parameters<typeof overrideMutation>[2])=>overrideMutation("remove_override",input,deps);

export function getCapabilityAdmin(capabilityKey:string,deps:{context:PlatformSecurityContext;queries:PlatformCapabilityQueryStore}){requirePlatformPermission(deps.context,"platform.capabilities.read");return deps.queries.getCapability(key(capabilityKey,"capabilityKey"),deps.context);}
export function listCapabilitiesAdmin(input:Readonly<{status?:CapabilityStatus;scopeKind?:CapabilityScopeKind;afterKey?:string;limit?:number}>,deps:{context:PlatformSecurityContext;queries:PlatformCapabilityQueryStore}){requirePlatformPermission(deps.context,"platform.capabilities.read");return deps.queries.listCapabilities({...input,afterKey:input.afterKey?key(input.afterKey,"afterKey"):undefined,limit:listLimit(input.limit)},deps.context);}
export function getFeatureFlagAdmin(featureFlagKey:string,deps:{context:PlatformSecurityContext;queries:PlatformCapabilityQueryStore}){requirePlatformPermission(deps.context,"platform.feature_flags.read");return deps.queries.getFeatureFlag(key(featureFlagKey,"featureFlagKey"),deps.context);}
export function listFeatureFlagsAdmin(input:Readonly<{status?:FeatureFlagStatus;afterKey?:string;limit?:number}>,deps:{context:PlatformSecurityContext;queries:PlatformCapabilityQueryStore}){requirePlatformPermission(deps.context,"platform.feature_flags.read");return deps.queries.listFeatureFlags({...input,afterKey:input.afterKey?key(input.afterKey,"afterKey"):undefined,limit:listLimit(input.limit)},deps.context);}
export function listFeatureFlagOverridesAdmin(input:Readonly<{featureFlagKey?:string;tenantId?:UUID;subjectKind?:FeatureFlagOverrideSubjectKind;status?:FeatureFlagOverrideStatus;limit?:number}>,deps:{context:PlatformSecurityContext;queries:PlatformCapabilityQueryStore}){requirePlatformPermission(deps.context,"platform.feature_flags.read");return deps.queries.listFeatureFlagOverrides({...input,featureFlagKey:input.featureFlagKey?key(input.featureFlagKey,"featureFlagKey"):undefined,limit:listLimit(input.limit)},deps.context);}

export async function resolveCurrentCapabilities(deps:{context:SecurityContext;resolver:CurrentCapabilityAvailabilityResolver}):Promise<readonly EffectiveCapabilityProjection[]> {
  const rows=await deps.resolver.resolveCurrentCapabilityAvailability(deps.context);
  return rows.map(row=>{const authorized=row.requiredPermissions.every(p=>hasPermission(deps.context,p));const reasons=authorized?row.denialReasons:[...new Set([...row.denialReasons,"permission_missing"])];return {capabilityKey:row.capabilityKey,scopeKind:row.scopeKind,available:row.available,authorized,allowed:row.available&&authorized,denialReasons:reasons};});
}
