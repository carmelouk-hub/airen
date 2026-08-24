import { AppError, type PlatformSecurityContext, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";

export interface EntitlementRepository { enabledForTenant(tenantId: UUID): Promise<readonly string[]>; }
export function requireEntitlement(context: SecurityContext, entitlementKey: string): void { if (!context.entitlements.includes(entitlementKey)) throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${entitlementKey}`); }

export type EntitlementCatalogStatus = "active" | "retired";
export type EntitlementDerivedState = "scheduled" | "effective" | "revoked" | "expired" | "inactive";
export type TenantEntitlementLifecycleAction = "grant" | "revoke" | "expire" | "change_limit" | "change_config" | "change_validity";

export type EntitlementCatalogProjection = Readonly<{
  entitlementKey: string;
  description?: string;
  status: EntitlementCatalogStatus;
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
}>;

export type TenantEntitlementProjection = Readonly<{
  tenantId: UUID;
  entitlementKey: string;
  sourceKind: string;
  sourceRef?: string;
  enabled: boolean;
  derivedState: EntitlementDerivedState;
  limitValue?: number;
  validFrom?: string;
  validUntil?: string;
  config: Readonly<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  expiredAt?: string;
}>;

export type EffectiveEntitlementProjection = Readonly<{
  entitlementKey: string;
  limitValue?: number;
  config: Readonly<Record<string, unknown>>;
  validFrom?: string;
  validUntil?: string;
}>;

export type EntitlementCatalogMutationResult = Readonly<{ catalog: EntitlementCatalogProjection; replayed: boolean }>;
export type TenantEntitlementMutationResult = Readonly<{ entitlement: TenantEntitlementProjection; replayed: boolean }>;

export interface EntitlementLifecycleTransaction {
  mutateCatalog(input: Readonly<{ action: "create" | "update" | "retire"; idempotencyKey: string; entitlementKey: string; description?: string | null; reasonCode?: string }>): Promise<EntitlementCatalogMutationResult>;
  mutateTenantEntitlement(input: Readonly<{
    action: TenantEntitlementLifecycleAction;
    idempotencyKey: string;
    tenantId: UUID;
    entitlementKey: string;
    sourceKind?: string;
    sourceRef?: string | null;
    limitValue?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
    config?: Readonly<Record<string, unknown>>;
    reasonCode?: string;
  }>): Promise<TenantEntitlementMutationResult>;
}
export interface EntitlementLifecycleUnitOfWork { transaction<T>(fn: (tx: EntitlementLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>; }
export interface PlatformEntitlementQueryStore {
  getCatalogEntry(entitlementKey: string, context: PlatformSecurityContext): Promise<EntitlementCatalogProjection | null>;
  listCatalog(input: Readonly<{ status?: EntitlementCatalogStatus; afterKey?: string; limit?: number }>, context: PlatformSecurityContext): Promise<readonly EntitlementCatalogProjection[]>;
  getTenantEntitlement(tenantId: UUID, entitlementKey: string, context: PlatformSecurityContext): Promise<TenantEntitlementProjection | null>;
  listTenantEntitlements(input: Readonly<{ tenantId?: UUID; entitlementKey?: string; derivedState?: EntitlementDerivedState; afterKey?: string; limit?: number }>, context: PlatformSecurityContext): Promise<readonly TenantEntitlementProjection[]>;
}
export interface CurrentTenantEffectiveEntitlementResolver { resolveCurrentTenantEntitlements(context: SecurityContext): Promise<readonly EffectiveEntitlementProjection[]>; }

const KEY = /^[a-z][a-z0-9._:-]{2,127}$/;
const SOURCE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const IDEM = /^.{8,128}$/;
function requirePlatform(context: PlatformSecurityContext, permission: string): void {
  if (context.scopeKind !== "platform" || !context.platformPermissions.includes(permission)) throw new AppError("PERMISSION_DENIED", `Missing platform permission: ${permission}`);
}
function key(value: string): string { const v=value.trim().toLowerCase(); if (!KEY.test(v)) throw new AppError("VALIDATION_FAILED","Invalid entitlement key"); return v; }
function idempotency(value: string): string { if (value !== value.trim() || !IDEM.test(value)) throw new AppError("VALIDATION_FAILED","Invalid idempotency key"); return value; }
function source(value: string): string { const v=value.trim().toLowerCase(); if (!SOURCE.test(v)) throw new AppError("VALIDATION_FAILED","Invalid entitlement source kind"); return v; }
function reason(value?: string): string | undefined { if (value == null) return undefined; if (!/^[a-z0-9][a-z0-9._:-]{2,63}$/.test(value)) throw new AppError("VALIDATION_FAILED","Invalid reason code"); return value; }
function limit(value?: number | null): number | null | undefined { if (value != null && (!Number.isFinite(value) || value < 0)) throw new AppError("VALIDATION_FAILED","Entitlement limit must be null or non-negative"); return value; }
function iso(value?: string | null): string | null | undefined { if (value == null) return value; const t=Date.parse(value); if (!Number.isFinite(t)) throw new AppError("VALIDATION_FAILED","Invalid entitlement validity timestamp"); return new Date(t).toISOString(); }
function config(value?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined { if (value == null) return undefined; if (Array.isArray(value) || typeof value !== "object") throw new AppError("VALIDATION_FAILED","Entitlement config must be an object"); return value; }

export async function createEntitlementCatalogEntry(input: Readonly<{ idempotencyKey: string; entitlementKey: string; description?: string | null; reasonCode?: string }>, deps: { context: PlatformSecurityContext; unitOfWork: EntitlementLifecycleUnitOfWork }) {
  requirePlatform(deps.context,"platform.entitlements.catalog.create");
  return deps.unitOfWork.transaction((tx)=>tx.mutateCatalog({action:"create",idempotencyKey:idempotency(input.idempotencyKey),entitlementKey:key(input.entitlementKey),description:input.description,reasonCode:reason(input.reasonCode)}),deps.context);
}
export async function updateEntitlementCatalogEntry(input: Readonly<{ idempotencyKey: string; entitlementKey: string; description?: string | null; reasonCode?: string }>, deps: { context: PlatformSecurityContext; unitOfWork: EntitlementLifecycleUnitOfWork }) {
  requirePlatform(deps.context,"platform.entitlements.catalog.update");
  return deps.unitOfWork.transaction((tx)=>tx.mutateCatalog({action:"update",idempotencyKey:idempotency(input.idempotencyKey),entitlementKey:key(input.entitlementKey),description:input.description,reasonCode:reason(input.reasonCode)}),deps.context);
}
export async function retireEntitlementCatalogEntry(input: Readonly<{ idempotencyKey: string; entitlementKey: string; reasonCode?: string }>, deps: { context: PlatformSecurityContext; unitOfWork: EntitlementLifecycleUnitOfWork }) {
  requirePlatform(deps.context,"platform.entitlements.catalog.retire");
  return deps.unitOfWork.transaction((tx)=>tx.mutateCatalog({action:"retire",idempotencyKey:idempotency(input.idempotencyKey),entitlementKey:key(input.entitlementKey),reasonCode:reason(input.reasonCode)}),deps.context);
}

async function mutateTenant(permission: string, action: TenantEntitlementLifecycleAction, input: Readonly<{
  idempotencyKey: string; tenantId: UUID; entitlementKey: string; sourceKind?: string; sourceRef?: string | null; limitValue?: number | null;
  validFrom?: string | null; validUntil?: string | null; config?: Readonly<Record<string, unknown>>; reasonCode?: string;
}>, deps: { context: PlatformSecurityContext; unitOfWork: EntitlementLifecycleUnitOfWork }) {
  requirePlatform(deps.context,permission);
  if (!input.tenantId) throw new AppError("VALIDATION_FAILED","Tenant ID is required");
  return deps.unitOfWork.transaction((tx)=>tx.mutateTenantEntitlement({
    action,idempotencyKey:idempotency(input.idempotencyKey),tenantId:input.tenantId,entitlementKey:key(input.entitlementKey),
    sourceKind:input.sourceKind == null ? undefined : source(input.sourceKind),sourceRef:input.sourceRef,limitValue:limit(input.limitValue),
    validFrom:iso(input.validFrom),validUntil:iso(input.validUntil),config:config(input.config),reasonCode:reason(input.reasonCode)
  }),deps.context);
}
export function grantTenantEntitlement(input: Parameters<typeof mutateTenant>[2], deps: Parameters<typeof mutateTenant>[3]) { if (!input.sourceKind) throw new AppError("VALIDATION_FAILED","sourceKind is required for entitlement grant/regrant"); return mutateTenant("platform.entitlements.grant","grant",input,deps); }
export function revokeTenantEntitlement(input: Parameters<typeof mutateTenant>[2], deps: Parameters<typeof mutateTenant>[3]) { return mutateTenant("platform.entitlements.revoke","revoke",input,deps); }
export function expireTenantEntitlement(input: Parameters<typeof mutateTenant>[2], deps: Parameters<typeof mutateTenant>[3]) { return mutateTenant("platform.entitlements.expire","expire",input,deps); }
export function changeTenantEntitlementLimit(input: Parameters<typeof mutateTenant>[2], deps: Parameters<typeof mutateTenant>[3]) { return mutateTenant("platform.entitlements.change_limit","change_limit",input,deps); }
export function changeTenantEntitlementConfig(input: Parameters<typeof mutateTenant>[2], deps: Parameters<typeof mutateTenant>[3]) { if (!input.config) throw new AppError("VALIDATION_FAILED","config is required"); return mutateTenant("platform.entitlements.change_config","change_config",input,deps); }
export function changeTenantEntitlementValidity(input: Parameters<typeof mutateTenant>[2], deps: Parameters<typeof mutateTenant>[3]) { return mutateTenant("platform.entitlements.change_validity","change_validity",input,deps); }

export function getEntitlementCatalogEntryAdmin(entitlementKey: string, deps: { context: PlatformSecurityContext; queries: PlatformEntitlementQueryStore }) { requirePlatform(deps.context,"platform.entitlements.read"); return deps.queries.getCatalogEntry(key(entitlementKey),deps.context); }
export function listEntitlementCatalogAdmin(input: Readonly<{ status?: EntitlementCatalogStatus; afterKey?: string; limit?: number }>, deps: { context: PlatformSecurityContext; queries: PlatformEntitlementQueryStore }) { requirePlatform(deps.context,"platform.entitlements.read"); return deps.queries.listCatalog(input,deps.context); }
export function getTenantEntitlementAdmin(tenantId: UUID, entitlementKey: string, deps: { context: PlatformSecurityContext; queries: PlatformEntitlementQueryStore }) { requirePlatform(deps.context,"platform.entitlements.read"); return deps.queries.getTenantEntitlement(tenantId,key(entitlementKey),deps.context); }
export function listTenantEntitlementsAdmin(input: Readonly<{ tenantId?: UUID; entitlementKey?: string; derivedState?: EntitlementDerivedState; afterKey?: string; limit?: number }>, deps: { context: PlatformSecurityContext; queries: PlatformEntitlementQueryStore }) { requirePlatform(deps.context,"platform.entitlements.read"); return deps.queries.listTenantEntitlements({...input,entitlementKey:input.entitlementKey ? key(input.entitlementKey) : undefined},deps.context); }
export function resolveCurrentTenantEntitlements(deps: { context: SecurityContext; resolver: CurrentTenantEffectiveEntitlementResolver }) { return deps.resolver.resolveCurrentTenantEntitlements(deps.context); }
