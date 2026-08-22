import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import type { Location, PublicRouteLookup, Tenant, TenantDomain } from "../../tenant/src/index.ts";
import type { TenantDomainAction, TenantDomainAdminProjection, TenantDomainAdminQueryStore, TenantDomainLifecycleResult, TenantDomainLifecycleTransaction, TenantDomainLifecycleUnitOfWork, TenantDomainStatus, TenantDomainVerificationState } from "../../tenant/src/commands/manage-tenant-domain.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function translate(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "Platform TenantDomain authority denied");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_TENANT_DOMAIN_NOT_FOUND")) return new AppError("NOT_FOUND", "TenantDomain not found");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_TENANT_NOT_FOUND")) return new AppError("NOT_FOUND", "Tenant not found");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) return new AppError("IDEMPOTENCY_CONFLICT", "TenantDomain idempotency key was reused with different input");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_RESERVED_PLATFORM_HOSTNAME")) return new AppError("CONFLICT", "Trusted platform hostname namespace cannot be registered as a custom domain");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_DOMAIN_LOCATION_SCOPE_MISMATCH")) return new AppError("CONFLICT", "TenantDomain Location binding cannot cross Tenant scope");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_DOMAIN_LOCATION_REQUIRES_ACTIVE")) return new AppError("CONFLICT", "TenantDomain Location binding requires an active Location");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_DOMAIN_ACTIVE_LOCATION_REQUIRED")) return new AppError("CONFLICT", "Active TenantDomain requires an active effective Location");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_DOMAIN_TENANT_REQUIRES_ACTIVE")) return new AppError("CONFLICT", "TenantDomain operation requires an active Tenant");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_DOMAIN_BINDING_UNCHANGED")) return new AppError("CONFLICT", "TenantDomain Location binding is unchanged");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_INVALID_DOMAIN_STATE")) return new AppError("CONFLICT", "TenantDomain lifecycle transition is invalid from current state");
  if (candidate.code === "23505" || candidate.message?.includes("AIRENOS_DOMAIN_HOSTNAME_CONFLICT")) return new AppError("CONFLICT", "Hostname is already registered");
  if (candidate.code === "22023" || candidate.code === "23514" || candidate.code === "23502") return new AppError("VALIDATION_FAILED", "TenantDomain input violated the PostgreSQL capability contract");
  return error;
}

function project(row: Record<string, unknown>): TenantDomainAdminProjection {
  return {
    id: String(row.domain_id),
    tenantId: String(row.tenant_id),
    locationId: row.location_id === null || row.location_id === undefined ? undefined : String(row.location_id),
    hostname: String(row.domain_hostname),
    status: String(row.domain_status) as TenantDomainStatus,
    verificationState: String(row.verification_state) as TenantDomainVerificationState,
    createdAt: new Date(String(row.domain_created_at)).toISOString(),
    updatedAt: new Date(String(row.domain_updated_at)).toISOString()
  };
}

class Transaction implements TenantDomainLifecycleTransaction {
  private readonly client: PoolClient;
  constructor(client: PoolClient) { this.client = client; }

  async registerDomain(input: { idempotencyKey: string; tenantId: string; hostname: string; locationId?: string }): Promise<TenantDomainLifecycleResult> {
    const result = await this.client.query(
      `SELECT action_key,domain_id,tenant_id,location_id,domain_hostname,domain_status,verification_state,domain_created_at,domain_updated_at,replayed
       FROM security.platform_register_tenant_domain($1,$2,$3,$4)`,
      [input.idempotencyKey,input.tenantId,input.hostname,input.locationId ?? null]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "TenantDomain registration capability returned no result");
    return { action: "register", domain: project(row), replayed: Boolean(row.replayed) };
  }

  async mutateDomain(input: { action: Exclude<TenantDomainAction,"register">; idempotencyKey: string; domainId: string; locationId?: string | null; reasonCode?: string; verificationEvidenceRef?: string }): Promise<TenantDomainLifecycleResult> {
    const result = await this.client.query(
      `SELECT action_key,domain_id,tenant_id,location_id,domain_hostname,domain_status,verification_state,domain_created_at,domain_updated_at,replayed
       FROM security.platform_mutate_tenant_domain($1,$2,$3,$4,$5,$6)`,
      [input.action,input.idempotencyKey,input.domainId,input.locationId ?? null,input.reasonCode ?? null,input.verificationEvidenceRef ?? null]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "TenantDomain lifecycle capability returned no result");
    return { action: String(row.action_key) as TenantDomainAction, domain: project(row), replayed: Boolean(row.replayed) };
  }
}

export class PostgresTenantDomainControlPlaneStore implements TenantDomainLifecycleUnitOfWork, TenantDomainAdminQueryStore {
  private readonly pool: Pool;
  private readonly assumeRole: string;
  constructor(pool: Pool, assumeRole = "airen_control_plane") { this.pool = pool; this.assumeRole = assumeRole; }

  async transaction<T>(fn: (tx: TenantDomainLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T> {
    const client = await this.open(context);
    try {
      const value = await fn(new Transaction(client));
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async getTenantDomain(domainId: string, context: PlatformSecurityContext): Promise<TenantDomainAdminProjection | null> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_get_tenant_domain($1)",[domainId]);
      await client.query("COMMIT");
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? project(row) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async listTenantDomains(input: { tenantId: string; status?: TenantDomainStatus; afterId?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly TenantDomainAdminProjection[]> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_list_tenant_domains($1,$2,$3,$4)",[input.tenantId,input.status ?? null,input.afterId ?? null,input.limit ?? 50]);
      await client.query("COMMIT");
      return result.rows.map((row) => project(row as Record<string, unknown>));
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  private async open(context: PlatformSecurityContext): Promise<PoolClient> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for TenantDomain control-plane operations");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id','',true),set_config('airen.location_id','',true),set_config('airen.correlation_id',$2,true)",[context.actorIdentityId,context.correlationId]);
      return client;
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      throw translate(error);
    }
  }
}

export class PostgresPublicRouteLookup implements PublicRouteLookup {
  private readonly pool: Pool;
  private readonly assumeRole: string;
  constructor(pool: Pool, assumeRole = "airen_app") { this.pool = pool; this.assumeRole = assumeRole; }

  async findCustomDomainRoute(hostname: string): Promise<{ domain: TenantDomain; tenant: Tenant; location: Location } | null> {
    const row = await this.one("SELECT * FROM security.resolve_active_tenant_domain_route($1)",[hostname]);
    if (!row) return null;
    return {
      domain: { id:String(row.domain_id), tenantId:String(row.domain_tenant_id), locationId:row.domain_location_id == null ? undefined : String(row.domain_location_id), hostname:String(row.domain_hostname), status:String(row.domain_status) as TenantDomain["status"] },
      tenant: { id:String(row.tenant_id_out), slug:String(row.tenant_slug), name:String(row.tenant_name), status:String(row.tenant_status) as Tenant["status"] },
      location: { id:String(row.location_id_out), tenantId:String(row.location_tenant_id), slug:String(row.location_slug), name:String(row.location_name), status:String(row.location_status) as Location["status"] }
    };
  }

  async findTrustedSubdomainRoute(slug: string): Promise<{ tenant: Tenant; location: Location } | null> {
    const row = await this.one("SELECT * FROM security.resolve_active_tenant_slug_route($1)",[slug]);
    if (!row) return null;
    return {
      tenant: { id:String(row.tenant_id_out), slug:String(row.tenant_slug), name:String(row.tenant_name), status:String(row.tenant_status) as Tenant["status"] },
      location: { id:String(row.location_id_out), tenantId:String(row.location_tenant_id), slug:String(row.location_slug), name:String(row.location_name), status:String(row.location_status) as Location["status"] }
    };
  }

  private async one(sql: string, params: readonly unknown[]): Promise<Record<string, unknown> | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query("SELECT set_config('airen.identity_id','',true),set_config('airen.tenant_id','',true),set_config('airen.location_id','',true),set_config('airen.correlation_id','',true)");
      const result = await client.query(sql,params);
      await client.query("COMMIT");
      return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }
}
