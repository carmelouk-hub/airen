import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import type { RolePermissionResolver } from "../../authorization/src/index.ts";
import type { TenantAdminProjection, TenantAdminQueryStore, TenantStatus } from "../../tenant/src/commands/manage-tenant.ts";

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
    updatedAt: new Date(String(row.tenant_updated_at)).toISOString(),
  };
}

function translate(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "Platform Tenant read authority denied");
  if (candidate.code === "22023") return new AppError("VALIDATION_FAILED", "Tenant read input violated the PostgreSQL capability contract");
  return error;
}

async function beginReadOnly(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE airen_control_plane");
    return client;
  } catch (error) {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
    throw error;
  }
}

export class PostgresPlatformRoleClaimPermissionResolver implements RolePermissionResolver {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async platformPermissions(platformRoles: readonly string[]): Promise<readonly string[]> {
    if (!platformRoles.length) return [];
    const client = await beginReadOnly(this.pool);
    try {
      const result = await client.query<{ permission_keys: string[] | null }>(
        "SELECT security.platform_permissions_for_roles($1::text[]) AS permission_keys",
        [[...platformRoles]],
      );
      await client.query("COMMIT");
      return result.rows[0]?.permission_keys ?? [];
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async tenantPermissions(): Promise<readonly string[]> { return []; }
  async locationPermissions(): Promise<readonly string[]> { return []; }
}

export class PostgresTenantRoleClaimReadStore implements TenantAdminQueryStore {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async getTenant(tenantId: string, context: PlatformSecurityContext): Promise<TenantAdminProjection | null> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for Tenant reads");
    const client = await beginReadOnly(this.pool);
    try {
      const result = await client.query(
        "SELECT * FROM security.platform_get_tenant_for_roles($1::text[],$2::uuid)",
        [[...context.platformRoles], tenantId],
      );
      await client.query("COMMIT");
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? project(row) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async listTenants(input: { status?: TenantStatus; afterId?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly TenantAdminProjection[]> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for Tenant reads");
    const client = await beginReadOnly(this.pool);
    try {
      const result = await client.query(
        "SELECT * FROM security.platform_list_tenants_for_roles($1::text[],$2,$3::uuid,$4)",
        [[...context.platformRoles], input.status ?? null, input.afterId ?? null, input.limit ?? 50],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => project(row as Record<string, unknown>));
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }
}
