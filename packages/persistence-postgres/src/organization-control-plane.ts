import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import type {
  Organization,
  OrganizationContextRepository,
  OrganizationControlPlaneTransaction,
  OrganizationControlPlaneUnitOfWork,
  OrganizationMembership,
  OrganizationProvisioningResult,
  OrganizationTenantBindingResult
} from "../../platform-core/src/organization-control-plane.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function translateOrganizationError(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "AIRenOS Organization control-plane authority denied");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) return new AppError("IDEMPOTENCY_CONFLICT", "Organization idempotency key was reused with different input");
  if (candidate.code === "22023" || candidate.code === "23514" || candidate.code === "23502") return new AppError("VALIDATION_FAILED", "Organization control-plane input violated the PostgreSQL capability contract");
  if (candidate.code === "23505") return new AppError("CONFLICT", "Organization or Tenant binding conflicts with existing platform state");
  return error;
}

class PostgresOrganizationControlPlaneTransaction implements OrganizationControlPlaneTransaction {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async provisionOrganization(input: { idempotencyKey: string; slug: string; name: string; legalName?: string }): Promise<OrganizationProvisioningResult> {
    const result = await this.client.query(
      `SELECT result_organization_id, result_membership_id, organization_slug, organization_name, organization_legal_name, organization_status, replayed
       FROM security.platform_provision_organization($1,$2,$3,$4)`,
      [input.idempotencyKey, input.slug, input.name, input.legalName ?? null]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "Organization provisioning capability returned no result");
    return {
      organization: {
        id: String(row.result_organization_id),
        slug: String(row.organization_slug),
        name: String(row.organization_name),
        legalName: row.organization_legal_name == null ? undefined : String(row.organization_legal_name),
        status: String(row.organization_status) as Organization["status"]
      },
      initialMembershipId: String(row.result_membership_id),
      replayed: Boolean(row.replayed)
    };
  }

  async bindTenant(input: { idempotencyKey: string; organizationId: UUID; tenantId: UUID }): Promise<OrganizationTenantBindingResult> {
    const result = await this.client.query(
      `SELECT result_organization_id, result_tenant_id, replayed
       FROM security.platform_bind_tenant_to_organization($1,$2,$3)`,
      [input.idempotencyKey, input.organizationId, input.tenantId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "Organization Tenant binding capability returned no result");
    return { organizationId: String(row.result_organization_id), tenantId: String(row.result_tenant_id), replayed: Boolean(row.replayed) };
  }
}

export class PostgresOrganizationControlPlaneUnitOfWork implements OrganizationControlPlaneUnitOfWork {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_control_plane") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: OrganizationControlPlaneTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for Organization control-plane mutations");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id','',true), set_config('airen.location_id','',true), set_config('airen.correlation_id',$2,true)",
        [context.actorIdentityId, context.correlationId]
      );
      const result = await fn(new PostgresOrganizationControlPlaneTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translateOrganizationError(error);
    } finally {
      client.release();
    }
  }
}

export class PostgresOrganizationContextRepository implements OrganizationContextRepository {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  private async readWithRole<T>(identityId: UUID | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      if (identityId) await client.query("SELECT set_config('airen.identity_id',$1,true)", [identityId]);
      const result = await fn(client);
      await client.query("ROLLBACK");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translateOrganizationError(error);
    } finally {
      client.release();
    }
  }

  async findActiveOrganizationForTenant(tenantId: UUID): Promise<Organization | null> {
    return this.readWithRole(null, async (client) => {
      const result = await client.query(
        `SELECT organization_id, organization_slug, organization_name, organization_legal_name, organization_status
         FROM security.resolve_active_organization_for_tenant($1)`,
        [tenantId]
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? {
        id: String(row.organization_id),
        slug: String(row.organization_slug),
        name: String(row.organization_name),
        legalName: row.organization_legal_name == null ? undefined : String(row.organization_legal_name),
        status: String(row.organization_status) as Organization["status"]
      } : null;
    });
  }

  async findActiveMembership(organizationId: UUID, identityId: UUID): Promise<OrganizationMembership | null> {
    return this.readWithRole(identityId, async (client) => {
      const result = await client.query(
        `SELECT membership_id, organization_id, identity_id, role_key, membership_status
         FROM security.resolve_active_organization_membership($1,$2)`,
        [organizationId, identityId]
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? {
        id: String(row.membership_id),
        organizationId: String(row.organization_id),
        identityId: String(row.identity_id),
        roleKey: String(row.role_key),
        status: String(row.membership_status) as OrganizationMembership["status"]
      } : null;
    });
  }
}
