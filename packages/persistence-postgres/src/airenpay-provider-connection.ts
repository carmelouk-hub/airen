import { Pool, type PoolClient } from "pg";
import type { SecurityContext, SecretRef } from "../../shared-contracts/src/index.ts";
import type {
  AirenPayTrustedProviderConnectionV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../../airenpay/src/index.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function parseSecretRef(value: unknown): SecretRef {
  const parsed = JSON.parse(String(value)) as SecretRef;
  if (!parsed || typeof parsed.provider !== "string" || typeof parsed.key !== "string") {
    throw new Error("AIRENPAY_SECRET_REFERENCE_INVALID");
  }
  return Object.freeze(parsed);
}

function mapConnection(row: Record<string, unknown>): AirenPayTrustedProviderConnectionV1 {
  const gateway: TenantPaymentGatewayConnectionProjectionV1 = Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    ...(row.locationId == null ? {} : { locationId: String(row.locationId) }),
    providerType: String(row.providerType),
    providerAccountReference: String(row.providerAccountReference),
    capabilities: Object.freeze([...(row.capabilities as string[])] as TenantPaymentGatewayConnectionProjectionV1["capabilities"]),
    mode: String(row.environmentClass) as TenantPaymentGatewayConnectionProjectionV1["mode"],
    credentialSecretRef: parseSecretRef(row.credentialSecretRef),
    ...(row.webhookSecretRef == null ? {} : { webhookSecretRef: parseSecretRef(row.webhookSecretRef) }),
    ...(row.webhookConfigurationReference == null ? {} : { webhookConfigurationReference: String(row.webhookConfigurationReference) }),
    status: String(row.connectionStatus) as TenantPaymentGatewayConnectionProjectionV1["status"],
    createdAt: new Date(String(row.createdAt)).toISOString(),
    updatedAt: new Date(String(row.updatedAt)).toISOString(),
    rowVersion: Number(row.rowVersion)
  });

  return Object.freeze({
    gateway,
    profile: Object.freeze({
      connectionId: gateway.id,
      tenantId: gateway.tenantId,
      ...(gateway.locationId ? { locationId: gateway.locationId } : {}),
      providerType: gateway.providerType,
      providerApiProfile: String(row.providerApiProfile),
      environmentClass: gateway.mode,
      configurationRoles: Object.freeze([...(row.configurationRoles as string[])] as any),
      fundsFlowProfile: String(row.fundsFlowProfile) as any,
      dashboardProfile: String(row.dashboardProfile) as any,
      feesResponsibility: String(row.feesResponsibility) as any,
      lossesResponsibility: String(row.lossesResponsibility) as any,
      readinessState: String(row.readinessState) as any,
      ...(row.lastReconciliationAt == null
        ? {}
        : { lastReconciliationAt: new Date(String(row.lastReconciliationAt)).toISOString() })
    })
  });
}

const SELECT_COLUMNS = `
  id::text AS id,
  tenant_id::text AS "tenantId",
  location_id::text AS "locationId",
  provider_type AS "providerType",
  provider_account_reference AS "providerAccountReference",
  capabilities,
  environment_class AS "environmentClass",
  credential_secret_ref AS "credentialSecretRef",
  webhook_secret_ref AS "webhookSecretRef",
  webhook_configuration_reference AS "webhookConfigurationReference",
  connection_status AS "connectionStatus",
  provider_api_profile AS "providerApiProfile",
  configuration_roles AS "configurationRoles",
  funds_flow_profile AS "fundsFlowProfile",
  dashboard_profile AS "dashboardProfile",
  fees_responsibility AS "feesResponsibility",
  losses_responsibility AS "lossesResponsibility",
  readiness_state AS "readinessState",
  last_reconciliation_at AS "lastReconciliationAt",
  row_version AS "rowVersion",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export class PostgresAirenPayProviderConnectionStore {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  private async scoped<T>(context: SecurityContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
      );
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async insert(
    context: SecurityContext,
    connection: AirenPayTrustedProviderConnectionV1
  ): Promise<AirenPayTrustedProviderConnectionV1> {
    return this.scoped(context, async (client) => {
      const { gateway, profile } = connection;
      const result = await client.query(
        `INSERT INTO airenpay.provider_connections
          (id, tenant_id, location_id, provider_type, provider_account_reference, capabilities,
           environment_class, credential_secret_ref, webhook_secret_ref, webhook_configuration_reference,
           connection_status, provider_api_profile, configuration_roles, funds_flow_profile,
           dashboard_profile, fees_responsibility, losses_responsibility, readiness_state,
           last_reconciliation_at, row_version, created_at, updated_at)
         VALUES
          ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::text[],$7,$8,$9,$10,$11,$12,$13::text[],$14,$15,$16,$17,$18,$19::timestamptz,$20,$21::timestamptz,$22::timestamptz)
         RETURNING ${SELECT_COLUMNS}`,
        [
          gateway.id,
          gateway.tenantId,
          gateway.locationId ?? null,
          gateway.providerType,
          gateway.providerAccountReference,
          [...gateway.capabilities],
          gateway.mode,
          JSON.stringify(gateway.credentialSecretRef),
          gateway.webhookSecretRef ? JSON.stringify(gateway.webhookSecretRef) : null,
          gateway.webhookConfigurationReference ?? null,
          gateway.status,
          profile.providerApiProfile,
          [...profile.configurationRoles],
          profile.fundsFlowProfile,
          profile.dashboardProfile,
          profile.feesResponsibility,
          profile.lossesResponsibility,
          profile.readinessState,
          profile.lastReconciliationAt ?? null,
          gateway.rowVersion,
          gateway.createdAt,
          gateway.updatedAt
        ]
      );
      return mapConnection(result.rows[0] as Record<string, unknown>);
    });
  }

  async getById(context: SecurityContext, connectionId: string): Promise<AirenPayTrustedProviderConnectionV1 | null> {
    return this.scoped(context, async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_COLUMNS}
           FROM airenpay.provider_connections
          WHERE id = $1::uuid`,
        [connectionId]
      );
      return result.rows[0] ? mapConnection(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async list(context: SecurityContext): Promise<readonly AirenPayTrustedProviderConnectionV1[]> {
    return this.scoped(context, async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_COLUMNS}
           FROM airenpay.provider_connections
          ORDER BY created_at, id`
      );
      return Object.freeze(result.rows.map((row) => mapConnection(row as Record<string, unknown>)));
    });
  }
}
