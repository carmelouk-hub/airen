import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../shared-contracts/src/index.ts";
import type { SubscriptionStatus } from "../../billing/src/index.ts";
import type {
  CurrentProductSubscriptionResolver,
  ProductAccessControlPlaneTransaction,
  ProductAccessControlPlaneUnitOfWork,
  ProductSubscriptionBindingProjection,
  ProductSubscriptionBindingResult,
} from "../../platform-core/src/product-access.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function optionalIso(value: unknown): string | undefined {
  return value == null ? undefined : new Date(String(value)).toISOString();
}

function projection(row: Record<string, unknown>): ProductSubscriptionBindingProjection {
  return {
    bindingId: String(row.binding_id),
    organizationId: String(row.organization_id),
    tenantId: String(row.tenant_id),
    productCode: String(row.product_code),
    entitlementKey: String(row.entitlement_key),
    subscriptionId: String(row.subscription_id),
    subscriptionStatus: String(row.subscription_status) as SubscriptionStatus,
    startsAt: new Date(String(row.starts_at)).toISOString(),
    trialEndsAt: optionalIso(row.trial_ends_at),
    currentPeriodStart: new Date(String(row.current_period_start)).toISOString(),
    currentPeriodEnd: new Date(String(row.current_period_end)).toISOString(),
    cancelEffectiveAt: optionalIso(row.cancel_effective_at),
    createdAt: new Date(String(row.binding_created_at)).toISOString(),
  };
}

function translate(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string; constraint?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "AIRenOS ProductAccess authority denied");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) {
    return new AppError("IDEMPOTENCY_CONFLICT", "ProductSubscription idempotency key was reused with different input");
  }
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PRODUCT_SUBSCRIPTION_BINDING_CONFLICT")) {
    return new AppError("CONFLICT", "ProductSubscription binding conflicts with existing platform state");
  }
  if (candidate.code === "P0002") return new AppError("NOT_FOUND", "ProductSubscription binding dependency was not found");
  if (["22023", "23502", "23503", "23505", "23514", "22P02"].includes(candidate.code ?? "")) {
    return new AppError("VALIDATION_FAILED", "ProductSubscription input violated the PostgreSQL capability contract");
  }
  return error;
}

class Transaction implements ProductAccessControlPlaneTransaction {
  private readonly client: PoolClient;
  constructor(client: PoolClient) { this.client = client; }

  async bindProductSubscription(input: {
    idempotencyKey: string;
    organizationId: string;
    tenantId: string;
    productCode: string;
    entitlementKey: string;
    subscriptionId: string;
  }): Promise<ProductSubscriptionBindingResult> {
    const result = await this.client.query(
      "SELECT * FROM security.platform_bind_product_subscription($1,$2,$3,$4,$5,$6)",
      [input.idempotencyKey, input.organizationId, input.tenantId, input.productCode, input.entitlementKey, input.subscriptionId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR", "ProductSubscription binding capability returned no result");
    return { binding: projection(row), replayed: Boolean(row.replayed) };
  }
}

export class PostgresProductAccessStore implements ProductAccessControlPlaneUnitOfWork, CurrentProductSubscriptionResolver {
  private readonly pool: Pool;
  private readonly controlPlaneRole: string;
  private readonly appRole: string;

  constructor(pool: Pool, controlPlaneRole = "airen_control_plane", appRole = "airen_app") {
    this.pool = pool;
    this.controlPlaneRole = controlPlaneRole;
    this.appRole = appRole;
  }

  async transaction<T>(fn: (tx: ProductAccessControlPlaneTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED", "PlatformSecurityContext is required for ProductAccess administration");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.controlPlaneRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id','',true),set_config('airen.location_id','',true),set_config('airen.correlation_id',$2,true)",
        [context.actorIdentityId, context.correlationId],
      );
      const value = await fn(new Transaction(client));
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally {
      client.release();
    }
  }

  async resolveCurrentProductSubscription(productCode: string, context: SecurityContext): Promise<ProductSubscriptionBindingProjection | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.appRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId],
      );
      const result = await client.query("SELECT * FROM security.resolve_current_product_subscription($1)", [productCode]);
      await client.query("ROLLBACK");
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? projection(row) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally {
      client.release();
    }
  }
}
