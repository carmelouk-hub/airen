import type { Pool, PoolClient } from "pg";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  BillingLifecycleTransaction, BillingLifecycleUnitOfWork, BillingPeriod, CurrentTenantSubscriptionProjection, CurrentTenantSubscriptionResolver,
  PlanLifecycleAction, PlanLifecycleResult, PlanProjection, PlanStatus, PlatformBillingQueryStore, SubscriptionCancelMode, SubscriptionLifecycleAction,
  SubscriptionLifecycleResult, SubscriptionProjection, SubscriptionSourceKind, SubscriptionStatus
} from "../../billing/src/index.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function translate(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string; constraint?: string };
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "Billing control-plane authority denied");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_PLAN_NOT_FOUND")) return new AppError("NOT_FOUND", "Plan not found");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_TENANT_NOT_FOUND")) return new AppError("NOT_FOUND", "Tenant not found");
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_SUBSCRIPTION_NOT_FOUND")) return new AppError("NOT_FOUND", "Subscription not found");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_IDEMPOTENCY_CONFLICT")) return new AppError("IDEMPOTENCY_CONFLICT", "Billing idempotency key was reused with different input");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_TENANT_REQUIRES_ACTIVE")) return new AppError("CONFLICT", "Billing service-granting transition requires an active Tenant");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PLAN_REQUIRES_DRAFT")) return new AppError("CONFLICT", "Plan lifecycle transition requires draft state");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PLAN_REQUIRES_ACTIVE")) return new AppError("CONFLICT", "Plan must be active for this operation");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PLAN_SLUG_IMMUTABLE")) return new AppError("CONFLICT", "Plan slug is immutable");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_INVALID_SUBSCRIPTION_STATE")) return new AppError("CONFLICT", "Subscription lifecycle transition is invalid from current state");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_SUBSCRIPTION_START_NOT_REACHED")) return new AppError("CONFLICT", "Scheduled Subscription start time has not been reached");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_CANCEL_EFFECTIVE_NOT_REACHED")) return new AppError("CONFLICT", "Scheduled cancellation effective time has not been reached");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PERIOD_NOT_ENDED")) return new AppError("CONFLICT", "Subscription current period has not ended");
  if (candidate.code === "P0001" && candidate.message?.includes("AIRENOS_PLAN_CHANGE_REQUIRES_DIFFERENT_PLAN")) return new AppError("CONFLICT", "Subscription already references the requested Plan");
  if (candidate.code === "23505" && candidate.constraint === "uq_subscriptions_one_current_per_tenant") return new AppError("CONFLICT", "Tenant already has a current non-terminal Subscription");
  if (candidate.code === "23505" && candidate.constraint === "uq_subscriptions_provider_subscription_ref") return new AppError("CONFLICT", "Provider Subscription reference is already bound");
  if (candidate.code === "23505" && candidate.constraint === "uq_plans_slug") return new AppError("CONFLICT", "Plan slug already exists");
  if (["22023","23502","23503","23514","22P02"].includes(candidate.code ?? "")) return new AppError("VALIDATION_FAILED", "Billing input violated the PostgreSQL capability contract");
  return error;
}

function optionalIso(value: unknown): string | undefined { return value == null ? undefined : new Date(String(value)).toISOString(); }
function plan(row: Record<string, unknown>): PlanProjection {
  return {
    id: String(row.result_plan_id ?? row.plan_id ?? row.id),
    slug: String(row.result_slug ?? row.plan_slug ?? row.slug),
    name: String(row.result_name ?? row.plan_name ?? row.name),
    description: (row.result_description ?? row.plan_description ?? row.description) == null ? undefined : String(row.result_description ?? row.plan_description ?? row.description),
    status: String(row.result_status ?? row.plan_status ?? row.status) as PlanStatus,
    currency: String(row.result_currency ?? row.plan_currency ?? row.currency),
    priceMinor: Number(row.result_price_minor ?? row.plan_price_minor ?? row.price_minor),
    billingPeriod: String(row.result_billing_period ?? row.plan_billing_period ?? row.billing_period) as BillingPeriod,
    defaultTrialDays: Number(row.result_default_trial_days ?? row.plan_default_trial_days ?? row.default_trial_days),
    createdAt: new Date(String(row.result_created_at ?? row.plan_created_at ?? row.created_at)).toISOString(),
    updatedAt: new Date(String(row.result_updated_at ?? row.plan_updated_at ?? row.updated_at)).toISOString(),
    activatedAt: optionalIso(row.result_activated_at ?? row.plan_activated_at ?? row.activated_at),
    retiredAt: optionalIso(row.result_retired_at ?? row.plan_retired_at ?? row.retired_at)
  };
}
function subscription(row: Record<string, unknown>): SubscriptionProjection {
  return {
    id: String(row.result_subscription_id ?? row.subscription_id ?? row.id),
    tenantId: String(row.result_tenant_id ?? row.tenant_id),
    planId: String(row.result_plan_id ?? row.plan_id),
    status: String(row.result_status ?? row.subscription_status ?? row.status) as SubscriptionStatus,
    startsAt: new Date(String(row.result_starts_at ?? row.starts_at)).toISOString(),
    trialEndsAt: optionalIso(row.result_trial_ends_at ?? row.trial_ends_at),
    currentPeriodStart: new Date(String(row.result_current_period_start ?? row.current_period_start)).toISOString(),
    currentPeriodEnd: new Date(String(row.result_current_period_end ?? row.current_period_end)).toISOString(),
    cancelEffectiveAt: optionalIso(row.result_cancel_effective_at ?? row.cancel_effective_at),
    canceledAt: optionalIso(row.result_canceled_at ?? row.canceled_at),
    suspendedAt: optionalIso(row.result_suspended_at ?? row.suspended_at),
    sourceKind: String(row.result_source_kind ?? row.source_kind) as SubscriptionSourceKind,
    providerKey: (row.result_provider_key ?? row.provider_key) == null ? undefined : String(row.result_provider_key ?? row.provider_key),
    providerSubscriptionRef: (row.result_provider_subscription_ref ?? row.provider_subscription_ref) == null ? undefined : String(row.result_provider_subscription_ref ?? row.provider_subscription_ref),
    providerCustomerRef: (row.result_provider_customer_ref ?? row.provider_customer_ref) == null ? undefined : String(row.result_provider_customer_ref ?? row.provider_customer_ref),
    createdAt: new Date(String(row.result_created_at ?? row.created_at)).toISOString(),
    updatedAt: new Date(String(row.result_updated_at ?? row.updated_at)).toISOString()
  };
}

class Transaction implements BillingLifecycleTransaction {
  private readonly client: PoolClient;
  constructor(client: PoolClient) { this.client = client; }

  async mutatePlan(input: { action: PlanLifecycleAction; idempotencyKey: string; planId?: string; slug?: string; name?: string; description?: string | null; currency?: string; priceMinor?: number; billingPeriod?: BillingPeriod; defaultTrialDays?: number; reasonCode?: string }): Promise<PlanLifecycleResult> {
    const r = await this.client.query(
      "SELECT * FROM security.platform_mutate_plan($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [input.action,input.idempotencyKey,input.planId ?? null,input.slug ?? null,input.name ?? null,input.description ?? null,input.currency ?? null,input.priceMinor ?? null,input.billingPeriod ?? null,input.defaultTrialDays ?? null,input.reasonCode ?? null]
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR","Plan lifecycle capability returned no result");
    return { action: String(row.result_action) as PlanLifecycleAction, plan: plan(row), replayed: Boolean(row.result_replayed) };
  }

  async createSubscription(input: { idempotencyKey: string; tenantId: string; planId: string; startsAt: string; trialEndsAt?: string; currentPeriodEnd: string; sourceKind: SubscriptionSourceKind; providerKey?: string; providerSubscriptionRef?: string; providerCustomerRef?: string; reasonCode?: string }): Promise<SubscriptionLifecycleResult> {
    const r = await this.client.query(
      "SELECT * FROM security.platform_create_subscription($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [input.idempotencyKey,input.tenantId,input.planId,input.startsAt,input.trialEndsAt ?? null,input.currentPeriodEnd,input.sourceKind,input.providerKey ?? null,input.providerSubscriptionRef ?? null,input.providerCustomerRef ?? null,input.reasonCode ?? null]
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR","Subscription create capability returned no result");
    return { action: "create", subscription: subscription(row), replayed: Boolean(row.result_replayed) };
  }

  async mutateSubscription(input: { action: SubscriptionLifecycleAction; idempotencyKey: string; subscriptionId: string; toPlanId?: string; cancelMode?: SubscriptionCancelMode; reasonCode?: string }): Promise<SubscriptionLifecycleResult> {
    const r = await this.client.query(
      "SELECT * FROM security.platform_mutate_subscription($1,$2,$3,$4,$5,$6)",
      [input.action,input.idempotencyKey,input.subscriptionId,input.toPlanId ?? null,input.cancelMode ?? null,input.reasonCode ?? null]
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new AppError("INTERNAL_ERROR","Subscription lifecycle capability returned no result");
    return { action: String(row.result_action) as SubscriptionLifecycleAction, subscription: subscription(row), replayed: Boolean(row.result_replayed) };
  }
}

export class PostgresBillingControlPlaneStore implements BillingLifecycleUnitOfWork, PlatformBillingQueryStore, CurrentTenantSubscriptionResolver {
  private readonly pool: Pool;
  private readonly controlPlaneRole: string;
  private readonly appRole: string;
  constructor(pool: Pool, controlPlaneRole = "airen_control_plane", appRole = "airen_app") { this.pool = pool; this.controlPlaneRole = controlPlaneRole; this.appRole = appRole; }

  async transaction<T>(fn: (tx: BillingLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T> {
    const client = await this.openPlatform(context);
    try {
      const result = await fn(new Transaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally { client.release(); }
  }

  async getPlan(planId: string, context: PlatformSecurityContext): Promise<PlanProjection | null> {
    const client = await this.openPlatform(context);
    try {
      const r = await client.query("SELECT * FROM security.platform_get_plan($1)",[planId]);
      await client.query("COMMIT");
      const row = r.rows[0] as Record<string, unknown> | undefined;
      return row ? plan(row) : null;
    } catch (error) { await client.query("ROLLBACK"); throw translate(error); } finally { client.release(); }
  }

  async listPlans(input: { status?: PlanStatus; afterSlug?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly PlanProjection[]> {
    const client = await this.openPlatform(context);
    try {
      const r = await client.query("SELECT * FROM security.platform_list_plans($1,$2,$3)",[input.status ?? null,input.afterSlug ?? null,input.limit ?? 50]);
      await client.query("COMMIT");
      return r.rows.map((row) => plan(row as Record<string, unknown>));
    } catch (error) { await client.query("ROLLBACK"); throw translate(error); } finally { client.release(); }
  }

  async getSubscription(subscriptionId: string, context: PlatformSecurityContext): Promise<SubscriptionProjection | null> {
    const client = await this.openPlatform(context);
    try {
      const r = await client.query("SELECT * FROM security.platform_get_subscription($1)",[subscriptionId]);
      await client.query("COMMIT");
      const row = r.rows[0] as Record<string, unknown> | undefined;
      return row ? subscription(row) : null;
    } catch (error) { await client.query("ROLLBACK"); throw translate(error); } finally { client.release(); }
  }

  async listSubscriptions(input: { tenantId?: string; status?: SubscriptionStatus; planId?: string; afterSubscriptionId?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly SubscriptionProjection[]> {
    const client = await this.openPlatform(context);
    try {
      const r = await client.query("SELECT * FROM security.platform_list_subscriptions($1,$2,$3,$4,$5)",[input.tenantId ?? null,input.status ?? null,input.planId ?? null,input.afterSubscriptionId ?? null,input.limit ?? 50]);
      await client.query("COMMIT");
      return r.rows.map((row) => subscription(row as Record<string, unknown>));
    } catch (error) { await client.query("ROLLBACK"); throw translate(error); } finally { client.release(); }
  }

  async resolveCurrentTenantSubscription(context: SecurityContext): Promise<CurrentTenantSubscriptionProjection | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.appRole)}`);
      await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]);
      const r = await client.query("SELECT * FROM security.resolve_current_tenant_subscription()");
      await client.query("COMMIT");
      const row = r.rows[0] as Record<string, unknown> | undefined;
      return row ? {
        subscriptionId: String(row.subscription_id), tenantId: String(row.tenant_id), planId: String(row.plan_id), planSlug: String(row.plan_slug),
        status: String(row.subscription_status) as SubscriptionStatus, startsAt: new Date(String(row.starts_at)).toISOString(), trialEndsAt: optionalIso(row.trial_ends_at),
        currentPeriodStart: new Date(String(row.current_period_start)).toISOString(), currentPeriodEnd: new Date(String(row.current_period_end)).toISOString(), cancelEffectiveAt: optionalIso(row.cancel_effective_at)
      } : null;
    } catch (error) { await client.query("ROLLBACK"); throw translate(error); } finally { client.release(); }
  }

  private async openPlatform(context: PlatformSecurityContext): Promise<PoolClient> {
    if (context.scopeKind !== "platform") throw new AppError("PERMISSION_DENIED","PlatformSecurityContext is required for billing administration");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.controlPlaneRole)}`);
      await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id','',true),set_config('airen.location_id','',true),set_config('airen.correlation_id',$2,true)",[context.actorIdentityId,context.correlationId]);
      return client;
    } catch (error) {
      await client.query("ROLLBACK"); client.release(); throw translate(error);
    }
  }
}
