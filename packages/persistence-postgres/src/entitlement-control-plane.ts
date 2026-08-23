import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  CurrentTenantEffectiveEntitlementResolver, EffectiveEntitlementProjection, EntitlementCatalogMutationResult, EntitlementCatalogProjection,
  EntitlementCatalogStatus, EntitlementDerivedState, EntitlementLifecycleTransaction, EntitlementLifecycleUnitOfWork, PlatformEntitlementQueryStore,
  TenantEntitlementLifecycleAction, TenantEntitlementMutationResult, TenantEntitlementProjection
} from "../../entitlements/src/index.ts";

function assertRoleIdentifier(role: string): string { if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier"); return role; }
function translate(error: unknown): unknown {
  const e=error as { code?: string; message?: string; constraint?: string };
  if (e.code==="42501") return new AppError("PERMISSION_DENIED","Entitlement control-plane authority denied");
  if (e.code==="P0002" && e.message?.includes("AIRENOS_ENTITLEMENT_CATALOG_NOT_FOUND")) return new AppError("NOT_FOUND","Entitlement catalog entry not found");
  if (e.code==="P0002" && e.message?.includes("AIRENOS_TENANT_ENTITLEMENT_NOT_FOUND")) return new AppError("NOT_FOUND","Tenant Entitlement not found");
  if (e.code==="P0002" && e.message?.includes("AIRENOS_TENANT_NOT_FOUND")) return new AppError("NOT_FOUND","Tenant not found");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) return new AppError("IDEMPOTENCY_CONFLICT","Entitlement idempotency key was reused with different input");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_TENANT_REQUIRES_ACTIVE")) return new AppError("CONFLICT","Entitlement service-granting change requires an active Tenant");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_ENTITLEMENT_CATALOG_REQUIRES_ACTIVE")) return new AppError("CONFLICT","Entitlement catalog entry must be active");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_ENTITLEMENT_CATALOG_RETIRED")) return new AppError("CONFLICT","Retired Entitlement catalog entry cannot be granted");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_ENTITLEMENT_ALREADY_ACTIVE")) return new AppError("CONFLICT","Tenant Entitlement is already active or scheduled");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_ENTITLEMENT_EXPIRY_NOT_REACHED")) return new AppError("CONFLICT","Entitlement expiry threshold has not been reached");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_INVALID_ENTITLEMENT_VALIDITY")) return new AppError("CONFLICT","Entitlement validity interval is invalid");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_ENTITLEMENT_SOURCE_IMMUTABLE")) return new AppError("CONFLICT","Entitlement source attribution is immutable during an active grant incarnation");
  if (e.code==="P0001" && e.message?.includes("AIRENOS_INVALID_ENTITLEMENT_STATE")) return new AppError("CONFLICT","Entitlement lifecycle transition is invalid from current state");
  if (e.code==="23505" && e.constraint?.includes("entitlement_catalog")) return new AppError("CONFLICT","Entitlement catalog key already exists");
  if (["22023","23502","23503","23514","22P02"].includes(e.code ?? "")) return new AppError("VALIDATION_FAILED","Entitlement input violated the PostgreSQL capability contract");
  return error;
}
function optionalIso(value: unknown): string | undefined { return value == null ? undefined : new Date(String(value)).toISOString(); }
function optionalNumber(value: unknown): number | undefined { return value == null ? undefined : Number(value); }
function jsonObject(value: unknown): Readonly<Record<string,unknown>> { return value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {}; }
function catalog(row: Record<string,unknown>): EntitlementCatalogProjection {
  return { entitlementKey:String(row.result_entitlement_key ?? row.entitlement_key), description:(row.result_description ?? row.description)==null?undefined:String(row.result_description ?? row.description),
    status:String(row.result_status ?? row.catalog_status ?? row.status) as EntitlementCatalogStatus, createdAt:new Date(String(row.result_created_at ?? row.created_at)).toISOString(),
    updatedAt:new Date(String(row.result_updated_at ?? row.updated_at)).toISOString(), retiredAt:optionalIso(row.result_retired_at ?? row.retired_at) };
}
function tenantEntitlement(row: Record<string,unknown>): TenantEntitlementProjection {
  return { tenantId:String(row.result_tenant_id ?? row.tenant_id), entitlementKey:String(row.result_entitlement_key ?? row.entitlement_key), sourceKind:String(row.result_source_kind ?? row.source_kind),
    sourceRef:(row.result_source_ref ?? row.source_ref)==null?undefined:String(row.result_source_ref ?? row.source_ref), enabled:Boolean(row.result_enabled ?? row.enabled),
    derivedState:String(row.result_derived_state ?? row.derived_state) as EntitlementDerivedState, limitValue:optionalNumber(row.result_limit_value ?? row.limit_value),
    validFrom:optionalIso(row.result_valid_from ?? row.valid_from), validUntil:optionalIso(row.result_valid_until ?? row.valid_until), config:jsonObject(row.result_config ?? row.config),
    createdAt:new Date(String(row.result_created_at ?? row.created_at)).toISOString(), updatedAt:new Date(String(row.result_updated_at ?? row.updated_at)).toISOString(),
    revokedAt:optionalIso(row.result_revoked_at ?? row.revoked_at), expiredAt:optionalIso(row.result_expired_at ?? row.expired_at) };
}

class Transaction implements EntitlementLifecycleTransaction {
  private readonly client: PoolClient;
  constructor(client: PoolClient) { this.client=client; }
  async mutateCatalog(input: { action:"create"|"update"|"retire"; idempotencyKey:string; entitlementKey:string; description?:string|null; reasonCode?:string }): Promise<EntitlementCatalogMutationResult> {
    const r=await this.client.query("SELECT * FROM security.platform_mutate_entitlement_catalog($1,$2,$3,$4,$5)",[input.action,input.idempotencyKey,input.entitlementKey,input.description ?? null,input.reasonCode ?? null]);
    const row=r.rows[0] as Record<string,unknown>|undefined; if (!row) throw new AppError("INTERNAL_ERROR","Entitlement catalog capability returned no result");
    return {catalog:catalog(row),replayed:Boolean(row.result_replayed)};
  }
  async mutateTenantEntitlement(input: { action:TenantEntitlementLifecycleAction; idempotencyKey:string; tenantId:string; entitlementKey:string; sourceKind?:string; sourceRef?:string|null; limitValue?:number|null; validFrom?:string|null; validUntil?:string|null; config?:Readonly<Record<string,unknown>>; reasonCode?:string }): Promise<TenantEntitlementMutationResult> {
    const r=await this.client.query("SELECT * FROM security.platform_mutate_tenant_entitlement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)",[
      input.action,input.idempotencyKey,input.tenantId,input.entitlementKey,input.sourceKind ?? null,input.sourceRef ?? null,input.limitValue ?? null,input.validFrom ?? null,input.validUntil ?? null,
      input.config==null?null:JSON.stringify(input.config),input.reasonCode ?? null
    ]);
    const row=r.rows[0] as Record<string,unknown>|undefined; if (!row) throw new AppError("INTERNAL_ERROR","Tenant Entitlement capability returned no result");
    return {entitlement:tenantEntitlement(row),replayed:Boolean(row.result_replayed)};
  }
}

export class PostgresEntitlementControlPlaneStore implements EntitlementLifecycleUnitOfWork, PlatformEntitlementQueryStore, CurrentTenantEffectiveEntitlementResolver {
  private readonly pool: Pool;
  private readonly controlPlaneRole: string;
  private readonly appRole: string;
  constructor(pool: Pool, controlPlaneRole="airen_control_plane", appRole="airen_app") { this.pool=pool; this.controlPlaneRole=controlPlaneRole; this.appRole=appRole; }
  async transaction<T>(fn:(tx:EntitlementLifecycleTransaction)=>Promise<T>,context:PlatformSecurityContext):Promise<T>{
    const client=await this.openPlatform(context); try { const result=await fn(new Transaction(client)); await client.query("COMMIT"); return result; }
    catch(error){ await client.query("ROLLBACK"); throw translate(error); } finally { client.release(); }
  }
  async getCatalogEntry(entitlementKey:string,context:PlatformSecurityContext){ const c=await this.openPlatform(context); try { const r=await c.query("SELECT * FROM security.platform_get_entitlement_catalog($1)",[entitlementKey]); await c.query("COMMIT"); return r.rows[0]?catalog(r.rows[0] as Record<string,unknown>):null; } catch(e){await c.query("ROLLBACK");throw translate(e);} finally{c.release();} }
  async listCatalog(input:{status?:EntitlementCatalogStatus;afterKey?:string;limit?:number},context:PlatformSecurityContext){ const c=await this.openPlatform(context); try { const r=await c.query("SELECT * FROM security.platform_list_entitlement_catalog($1,$2,$3)",[input.status??null,input.afterKey??null,input.limit??50]); await c.query("COMMIT"); return r.rows.map((x)=>catalog(x as Record<string,unknown>)); } catch(e){await c.query("ROLLBACK");throw translate(e);} finally{c.release();} }
  async getTenantEntitlement(tenantId:string,entitlementKey:string,context:PlatformSecurityContext){ const c=await this.openPlatform(context); try { const r=await c.query("SELECT * FROM security.platform_get_tenant_entitlement($1,$2)",[tenantId,entitlementKey]); await c.query("COMMIT"); return r.rows[0]?tenantEntitlement(r.rows[0] as Record<string,unknown>):null; } catch(e){await c.query("ROLLBACK");throw translate(e);} finally{c.release();} }
  async listTenantEntitlements(input:{tenantId?:string;entitlementKey?:string;derivedState?:EntitlementDerivedState;afterKey?:string;limit?:number},context:PlatformSecurityContext){ const c=await this.openPlatform(context); try { const r=await c.query("SELECT * FROM security.platform_list_tenant_entitlements($1,$2,$3,$4,$5)",[input.tenantId??null,input.entitlementKey??null,input.derivedState??null,input.afterKey??null,input.limit??50]); await c.query("COMMIT"); return r.rows.map((x)=>tenantEntitlement(x as Record<string,unknown>)); } catch(e){await c.query("ROLLBACK");throw translate(e);} finally{c.release();} }
  async resolveCurrentTenantEntitlements(context:SecurityContext):Promise<readonly EffectiveEntitlementProjection[]>{
    const c=await this.pool.connect(); try { await c.query("BEGIN"); await c.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.appRole)}`); await c.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]); const r=await c.query("SELECT * FROM security.resolve_current_tenant_entitlements()"); await c.query("COMMIT"); return r.rows.map((row)=>({entitlementKey:String(row.entitlement_key),limitValue:optionalNumber(row.limit_value),config:jsonObject(row.config),validFrom:optionalIso(row.valid_from),validUntil:optionalIso(row.valid_until)})); } catch(e){await c.query("ROLLBACK");throw translate(e);} finally{c.release();}
  }
  private async openPlatform(context:PlatformSecurityContext):Promise<PoolClient>{ if(context.scopeKind!=="platform") throw new AppError("PERMISSION_DENIED","PlatformSecurityContext is required for Entitlement administration"); const c=await this.pool.connect(); try { await c.query("BEGIN"); await c.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.controlPlaneRole)}`); await c.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id','',true),set_config('airen.location_id','',true),set_config('airen.correlation_id',$2,true)",[context.actorIdentityId,context.correlationId]); return c; } catch(e){await c.query("ROLLBACK");c.release();throw translate(e);} }
}
