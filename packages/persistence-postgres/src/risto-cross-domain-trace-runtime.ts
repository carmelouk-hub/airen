import { Pool, type PoolClient } from "pg";
import { AppError, type SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  CrossDomainTraceEvidence,
  CrossDomainTraceStore
} from "../../ristoairen/src/journeys/cross-domain-trace-runtime.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function translate(error: unknown): unknown {
  const value = error as { code?: string; message?: string };
  const message = value.message ?? "";
  if (value.code === "42501") return new AppError("PERMISSION_DENIED", "Cross-domain trace query denied");
  if (message.includes("CROSS_DOMAIN_TRACE_TENANT_CONTEXT_REQUIRED")) {
    return new AppError("TENANT_SCOPE_VIOLATION", "Tenant context is required for cross-domain trace reconstruction");
  }
  if (message.includes("CROSS_DOMAIN_TRACE_LOCATION_CONTEXT_REQUIRED")) {
    return new AppError("LOCATION_SCOPE_VIOLATION", "Location context is required for cross-domain trace reconstruction");
  }
  if (message.includes("CROSS_DOMAIN_TRACE_CORRELATION_INVALID")) {
    return new AppError("VALIDATION_FAILED", "Correlation id is invalid for cross-domain trace reconstruction");
  }
  return error;
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function evidenceFromRow(row: Record<string, unknown>): CrossDomainTraceEvidence {
  return Object.freeze({
    evidenceKind: String(row.evidenceKind) as CrossDomainTraceEvidence["evidenceKind"],
    evidenceId: String(row.evidenceId),
    tenantId: String(row.tenantId),
    locationId: String(row.locationId),
    ...(row.actorIdentityId == null ? {} : { actorIdentityId: String(row.actorIdentityId) }),
    ...(row.commandKey == null ? {} : { commandKey: String(row.commandKey) }),
    decision: String(row.decision),
    ...(row.stateTransition == null ? {} : { stateTransition: String(row.stateTransition) }),
    ...(row.emittedFact == null ? {} : { emittedFact: String(row.emittedFact) }),
    ...(row.resourceType == null ? {} : { resourceType: String(row.resourceType) }),
    ...(row.resourceId == null ? {} : { resourceId: String(row.resourceId) }),
    sourceId: String(row.sourceId),
    correlationId: String(row.correlationId),
    occurredAt: iso(row.occurredAt),
    metadataSanitized: Object.freeze(structuredClone((row.metadataSanitized ?? {}) as Record<string, unknown>))
  });
}

async function withScopedTransaction<T>(
  pool: Pool,
  assumeRole: string,
  context: SecurityContext,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(assumeRole)}`);
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
      [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
    );
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw translate(error);
  } finally {
    client.release();
  }
}

export class PostgresCrossDomainTraceStore implements CrossDomainTraceStore {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assertRoleIdentifier(assumeRole);
  }

  async queryByCorrelation(
    correlationId: string,
    context: SecurityContext
  ): Promise<readonly CrossDomainTraceEvidence[]> {
    return withScopedTransaction(this.pool, this.assumeRole, context, async (client) => {
      const result = await client.query(
        `SELECT evidence_kind AS "evidenceKind",
                evidence_id AS "evidenceId",
                tenant_id::text AS "tenantId",
                location_id::text AS "locationId",
                actor_identity_id::text AS "actorIdentityId",
                command_key AS "commandKey",
                decision,
                state_transition AS "stateTransition",
                emitted_fact AS "emittedFact",
                resource_type AS "resourceType",
                resource_id AS "resourceId",
                source_id AS "sourceId",
                correlation_id AS "correlationId",
                occurred_at AS "occurredAt",
                metadata_sanitized AS "metadataSanitized"
           FROM ristoairen.query_cross_domain_trace($1)
          ORDER BY occurred_at, evidence_kind, evidence_id`,
        [correlationId]
      );
      return Object.freeze(result.rows.map((row) => evidenceFromRow(row as Record<string, unknown>)));
    });
  }
}
