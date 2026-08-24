import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import type { LocationAdminProjection, LocationAdminQueryStore, LocationLifecycleAction, LocationLifecycleResult, LocationLifecycleTransaction, LocationLifecycleUnitOfWork, LocationStatus } from "../../tenant/src/commands/manage-location.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function translate(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "Platform Location control-plane authority denied");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_LOCATION_NOT_FOUND")) return new AppError("NOT_FOUND", "Location not found");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) return new AppError("IDEMPOTENCY_CONFLICT", "Location lifecycle idempotency key was reused with different input");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_LOCATION_SCOPE_MISMATCH")) return new AppError("CONFLICT", "Primary Location transfer cannot cross Tenant scope");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PRIMARY_LOCATION_TRANSFER_REQUIRED")) return new AppError("CONFLICT", "Primary Location must be transferred before this lifecycle transition");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PRIMARY_SOURCE_REQUIRED")) return new AppError("CONFLICT", "Primary transfer source is not the current unique primary Location");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PRIMARY_TARGET_REQUIRES_ACTIVE")) return new AppError("CONFLICT", "Primary transfer target must be active");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PRIMARY_LOCATION_INVARIANT_FAILED")) return new AppError("CONFLICT", "Primary Location invariant could not be preserved");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_INVALID_LOCATION_STATE")) return new AppError("CONFLICT", "Location lifecycle transition is invalid from current state");
  if (candidate.code === "22023" || candidate.code === "23514" || candidate.code === "23502") return new AppError("VALIDATION_FAILED", "Location control-plane input violated the PostgreSQL capability contract");
  if (candidate.code === "23505") return new AppError("CONFLICT", "Location control-plane mutation conflicts with an existing resource");
  return error;
}

function project(row: Record<string, unknown>): LocationAdminProjection {
  return {
    id: String(row.location_id),
    tenantId: String(row.tenant_id),
    slug: String(row.location_slug),
    name: String(row.location_name),
    status: String(row.location_status) as LocationStatus,
    timezone: String(row.location_timezone),
    isPrimary: Boolean(row.location_is_primary),
    createdAt: new Date(String(row.location_created_at)).toISOString(),
    updatedAt: new Date(String(row.location_updated_at)).toISOString()
  };
}

class Transaction implements LocationLifecycleTransaction {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async mutateLocation(input: { action: Exclude<LocationLifecycleAction, "transfer_primary">; idempotencyKey: string; locationId: string; name?: string; timezone?: string; reasonCode?: string }): Promise<LocationLifecycleResult> {
    const result = await this.client.query(
      `SELECT action_key, location_id, tenant_id, location_slug, location_name, location_status, location_timezone, location_is_primary, location_created_at, location_updated_at, replayed
       FROM security.platform_mutate_location($1,$2,$3,$4,$5,$6)`,
      [input.action, input.idempotencyKey, input.locationId, input.name ?? null, input.timezone ?? null, input.reasonCode ?? null]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "Location lifecycle capability returned no result");
    return { action: String(row.action_key) as LocationLifecycleAction, location: project(row), replayed: Boolean(row.replayed) };
  }

  async transferPrimaryLocation(input: { idempotencyKey: string; sourceLocationId: string; targetLocationId: string; reasonCode: string }): Promise<LocationLifecycleResult> {
    const result = await this.client.query(
      `SELECT action_key, location_id, tenant_id, location_slug, location_name, location_status, location_timezone, location_is_primary, location_created_at, location_updated_at, previous_primary_location_id, replayed
       FROM security.platform_transfer_primary_location($1,$2,$3,$4)`,
      [input.idempotencyKey, input.sourceLocationId, input.targetLocationId, input.reasonCode]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "Location primary-transfer capability returned no result");
    return {
      action: "transfer_primary",
      location: project(row),
      previousPrimaryLocationId: String(row.previous_primary_location_id),
      replayed: Boolean(row.replayed)
    };
  }
}

export class PostgresLocationControlPlaneStore implements LocationLifecycleUnitOfWork, LocationAdminQueryStore {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_control_plane") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: LocationLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T> {
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

  async getLocation(locationId: string, context: PlatformSecurityContext): Promise<LocationAdminProjection | null> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_get_location($1)", [locationId]);
      await client.query("COMMIT");
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? project(row) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async listLocations(input: { tenantId: string; status?: LocationStatus; afterId?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly LocationAdminProjection[]> {
    const client = await this.open(context);
    try {
      const result = await client.query("SELECT * FROM security.platform_list_locations($1,$2,$3,$4)", [input.tenantId, input.status ?? null, input.afterId ?? null, input.limit ?? 50]);
      await client.query("COMMIT");
      return result.rows.map((row) => project(row as Record<string, unknown>));
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  private async open(context: PlatformSecurityContext): Promise<PoolClient> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for Location control-plane operations");
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
