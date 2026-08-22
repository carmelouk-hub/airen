import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import type { TenantAdminProjection, TenantAdminQueryStore, TenantLifecycleAction, TenantLifecycleResult, TenantLifecycleTransaction, TenantLifecycleUnitOfWork, TenantStatus } from "../../tenant/src/commands/manage-tenant.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function translate(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "Platform Tenant control-plane authority denied");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_TENANT_NOT_FOUND")) return new AppError("NOT_FOUND", "Tenant not found");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) return new AppError("IDEMPOTENCY_CONFLICT", "Tenant lifecycle idempotency key was reused with different input");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_INVALID_TENANT_STATE")) return new AppError("CONFLICT", "Tenant lifecycle transition is invalid from current state");
  if (candidate.code === "22023" || candidate.code === "23514" || candidate.code === "23502") return new AppError("VALIDATION_FAILED", "Tenant control-plane input violated the PostgreSQL capability contract");
  if (candidate.code === "23505") return new AppError("CONFLICT", "Tenant control-plane mutation conflicts with an existing resource");
  return error;
}

function project(row: Record<string, unknown>): TenantAdminProjection {
  return {
    id: String(row.tenant_id),
    slug: String(row.tenant_slug),
    name: String(row.tenant_name),
    status: String(row.tenant_status) as TenantStatus,
    locale: String(row.tenant_locale),
    timezone: String(row.tenant_timezone),
    currency: String(row.tenant_currency),
    createdAt: new Date(String(row.tenant_created_at)).toISOString(),
    updatedAt: new Date(String(row.tenant_updated_at)).toISOString()
  };
}

class Transaction implements TenantLifecycleTransaction {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async mutateTenant(input: { action: TenantLifecycleAction; idempotencyKey: string; tenantId: string; name?: string; locale?: string; timezone?: string; currency?: string; reasonCode?: string }): Promise<TenantLifecycleResult> {
    const result = await this.client.query(
      `SELECT action_key, tenant_id, tenant_slug, tenant_name, tenant_status, tenant_locale, tenant_timezone, tenant_currency, tenant_created_at, tenant_updated_at, replayed
       FROM security.platform_mutate_tenant($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.action, input.idempotencyKey, input.tenantId, input.name ?? null, input.locale ?? null, input.timezone ?? null, input.currency ?? null, input.reasonCode ?? null]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "Tenant lifecycle capability returned no result");
    return { action: String(row.action_key) as TenantLifecycleAction, tenant: project(row), replayed: Boolean(row.replayed) };
  }
}

export class PostgresTenantControlPlaneStore implements TenantLifecycleUnitOfWork, TenantAdminQueryStore {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_control_plane") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: TenantLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T> {
    const client = await this.open(context);
    try {
      const result = await fn(new Transaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async getTenant(tenantId: string, context: PlatformSecurityContext): Promise<TenantAdminProjection | null> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_get_tenant($1)", [tenantId]);
      await client.query("COMMIT");
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? project(row) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async listTenants(input: { status?: TenantStatus; afterId?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly TenantAdminProjection[]> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_list_tenants($1,$2,$3)", [input.status ?? null, input.afterId ?? null, input.limit ?? 50]);
      await client.query("COMMIT");
      return result.rows.map((row) => project(row as Record<string, unknown>));
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  private async open(context: PlatformSecurityContext): Promise<PoolClient> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for Tenant control-plane operations");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id','',true), set_config('airen.location_id','',true), set_config('airen.correlation_id',$2,true)",
        [context.actorIdentityId, context.correlationId]
      );
      return client;
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      throw translate(error);
    }
  }
}
