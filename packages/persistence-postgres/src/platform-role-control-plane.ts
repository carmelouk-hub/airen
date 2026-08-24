import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import type { PlatformPrincipalProjection, PlatformPrincipalRoleQueryStore, PlatformRoleAssignmentProjection, PlatformRoleAssignmentStatus, PlatformRoleCatalogProjection, PlatformRoleLifecycleAction, PlatformRoleLifecycleResult, PlatformRoleLifecycleTransaction, PlatformRoleLifecycleUnitOfWork } from "../../authorization/src/platform-role-admin.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function translate(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "Platform role administration authority denied");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_PLATFORM_PRINCIPAL_NOT_FOUND")) return new AppError("NOT_FOUND", "Platform principal not found");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_PLATFORM_ROLE_UNDEFINED")) return new AppError("NOT_FOUND", "Platform role is not defined by platform permission grants");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) return new AppError("IDEMPOTENCY_CONFLICT", "Platform role idempotency key was reused with different input");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PLATFORM_PRINCIPAL_REQUIRES_ACTIVE")) return new AppError("CONFLICT", "Platform role assignment requires an active target Identity");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PROTECTED_ROLE_MINIMUM_ACTIVE")) return new AppError("CONFLICT", "Protected role minimum active assignment invariant would be violated");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_INVALID_PLATFORM_ROLE_STATE")) return new AppError("CONFLICT", "Platform role lifecycle transition is invalid from current state");
  if (candidate.code === "22023" || candidate.code === "23514" || candidate.code === "23502") return new AppError("VALIDATION_FAILED", "Platform role input violated the PostgreSQL capability contract");
  return error;
}

function assignment(row: Record<string, unknown>): PlatformRoleAssignmentProjection {
  return {
    identityId: String(row.target_identity_id ?? row.identityId ?? row.identity_id),
    roleKey: String(row.role_key ?? row.roleKey),
    status: String(row.assignment_status ?? row.status) as PlatformRoleAssignmentStatus,
    createdAt: new Date(String(row.assignment_created_at ?? row.createdAt ?? row.created_at)).toISOString(),
    updatedAt: new Date(String(row.assignment_updated_at ?? row.updatedAt ?? row.updated_at)).toISOString()
  };
}

function parseRoleAssignments(value: unknown): PlatformRoleAssignmentProjection[] {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      identityId: String(row.identityId),
      roleKey: String(row.roleKey),
      status: String(row.status) as PlatformRoleAssignmentStatus,
      createdAt: new Date(String(row.createdAt)).toISOString(),
      updatedAt: new Date(String(row.updatedAt)).toISOString()
    };
  });
}

function principal(row: Record<string, unknown>): PlatformPrincipalProjection {
  return {
    identityId: String(row.identity_id),
    displayName: row.display_name == null ? undefined : String(row.display_name),
    primaryEmail: row.primary_email == null ? undefined : String(row.primary_email),
    status: String(row.identity_status),
    roleAssignments: parseRoleAssignments(row.role_assignments)
  };
}

class Transaction implements PlatformRoleLifecycleTransaction {
  private readonly client: PoolClient;
  constructor(client: PoolClient) { this.client = client; }
  async mutateRoleAssignment(input: { action: PlatformRoleLifecycleAction; idempotencyKey: string; targetIdentityId: string; roleKey: string; reasonCode?: string }): Promise<PlatformRoleLifecycleResult> {
    const result = await this.client.query(
      `SELECT action_key,target_identity_id,role_key,assignment_status,assignment_created_at,assignment_updated_at,replayed
       FROM security.platform_mutate_role_assignment($1,$2,$3,$4,$5)`,
      [input.action,input.idempotencyKey,input.targetIdentityId,input.roleKey,input.reasonCode ?? null]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "Platform role capability returned no result");
    return { action: String(row.action_key) as PlatformRoleLifecycleAction, assignment: assignment(row), replayed: Boolean(row.replayed) };
  }
}

export class PostgresPlatformRoleAdminStore implements PlatformRoleLifecycleUnitOfWork, PlatformPrincipalRoleQueryStore {
  private readonly pool: Pool;
  private readonly assumeRole: string;
  constructor(pool: Pool, assumeRole = "airen_control_plane") { this.pool = pool; this.assumeRole = assumeRole; }

  async transaction<T>(fn: (tx: PlatformRoleLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T> {
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

  async getPrincipal(identityId: string, context: PlatformSecurityContext): Promise<PlatformPrincipalProjection | null> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_get_principal($1)",[identityId]);
      await client.query("COMMIT");
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? principal(row) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async listPrincipals(input: { activeRoleKey?: string; afterIdentityId?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly PlatformPrincipalProjection[]> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_list_principals($1,$2,$3)",[input.activeRoleKey ?? null,input.afterIdentityId ?? null,input.limit ?? 50]);
      await client.query("COMMIT");
      return result.rows.map((row) => principal(row as Record<string, unknown>));
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async listRoles(input: { afterRoleKey?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly PlatformRoleCatalogProjection[]> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_list_roles($1,$2)",[input.afterRoleKey ?? null,input.limit ?? 50]);
      await client.query("COMMIT");
      return result.rows.map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          roleKey: String(row.role_key),
          permissionKeys: Array.isArray(row.permission_keys) ? row.permission_keys.map(String) : [],
          protected: Boolean(row.is_protected),
          minimumActiveAssignments: Number(row.minimum_active_assignments),
          activeAssignmentCount: Number(row.active_assignment_count)
        };
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  private async open(context: PlatformSecurityContext): Promise<PoolClient> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for platform role administration");
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
