import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import type { TenantProvisioningResult, TenantProvisioningTransaction, TenantProvisioningUnitOfWork } from "../../tenant/src/commands/provision-tenant.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function translateProvisioningError(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "Platform tenant provisioning authority denied");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) return new AppError("IDEMPOTENCY_CONFLICT", "Tenant provisioning idempotency key was reused with different input");
  if (candidate.code === "22023" || candidate.code === "23514" || candidate.code === "23502") return new AppError("VALIDATION_FAILED", "Tenant provisioning input violated the PostgreSQL capability contract");
  if (candidate.code === "23505") return new AppError("CONFLICT", "Tenant provisioning conflicts with an existing unique platform resource");
  return error;
}

class PostgresTenantProvisioningTransaction implements TenantProvisioningTransaction {
  private readonly client: PoolClient;
  constructor(client: PoolClient) { this.client = client; }

  async provisionTenant(input: {
    idempotencyKey: string;
    tenantSlug: string;
    tenantName: string;
    locale: string;
    timezone: string;
    currency: string;
    locationSlug: string;
    locationName: string;
    locationTimezone: string;
  }): Promise<TenantProvisioningResult> {
    const result = await this.client.query(
      `SELECT result_tenant_id, result_location_id, result_membership_id, tenant_slug, tenant_name, tenant_status, location_slug, location_name, location_status, replayed
       FROM security.platform_provision_tenant($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [input.idempotencyKey, input.tenantSlug, input.tenantName, input.locale, input.timezone, input.currency, input.locationSlug, input.locationName, input.locationTimezone]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "Platform tenant provisioning capability returned no result");
    return {
      tenant: {
        id: String(row.result_tenant_id),
        slug: String(row.tenant_slug),
        name: String(row.tenant_name),
        status: String(row.tenant_status) as "active" | "suspended" | "archived"
      },
      primaryLocation: {
        id: String(row.result_location_id),
        tenantId: String(row.result_tenant_id),
        slug: String(row.location_slug),
        name: String(row.location_name),
        status: String(row.location_status) as "active" | "inactive" | "suspended" | "archived"
      },
      tenantMembershipId: String(row.result_membership_id),
      replayed: Boolean(row.replayed)
    };
  }
}

export class PostgresTenantProvisioningUnitOfWork implements TenantProvisioningUnitOfWork {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_control_plane") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: TenantProvisioningTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for tenant provisioning");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id','',true), set_config('airen.location_id','',true), set_config('airen.correlation_id',$2,true)",
        [context.actorIdentityId, context.correlationId]
      );
      const result = await fn(new PostgresTenantProvisioningTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translateProvisioningError(error);
    } finally {
      client.release();
    }
  }
}
