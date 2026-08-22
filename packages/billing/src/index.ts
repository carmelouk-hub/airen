import { AppError, type PlatformSecurityContext, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "../../authorization/src/index.ts";

export type PlanStatus = "draft" | "active" | "retired";
export type BillingPeriod = "monthly" | "annual";
export type SubscriptionStatus = "scheduled" | "trialing" | "active" | "suspended" | "cancel_pending" | "canceled" | "expired";
export type SubscriptionSourceKind = "manual" | "migration" | "provider";
export type SubscriptionCancelMode = "immediate" | "finalize_scheduled";
export type PlanLifecycleAction = "create" | "update" | "activate" | "retire";
export type SubscriptionLifecycleAction = "activate" | "suspend" | "reactivate" | "schedule_cancel" | "unschedule_cancel" | "cancel" | "expire" | "change_plan";

export type PlanProjection = Readonly<{
  id: UUID;
  slug: string;
  name: string;
  description?: string;
  status: PlanStatus;
  currency: string;
  priceMinor: number;
  billingPeriod: BillingPeriod;
  defaultTrialDays: number;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  retiredAt?: string;
}>;

export type SubscriptionProjection = Readonly<{
  id: UUID;
  tenantId: UUID;
  planId: UUID;
  status: SubscriptionStatus;
  startsAt: string;
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelEffectiveAt?: string;
  canceledAt?: string;
  suspendedAt?: string;
  sourceKind: SubscriptionSourceKind;
  providerKey?: string;
  providerSubscriptionRef?: string;
  providerCustomerRef?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type CurrentTenantSubscriptionProjection = Readonly<{
  subscriptionId: UUID;
  tenantId: UUID;
  planId: UUID;
  planSlug: string;
  status: SubscriptionStatus;
  startsAt: string;
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelEffectiveAt?: string;
}>;

export type PlanLifecycleResult = Readonly<{ action: PlanLifecycleAction; plan: PlanProjection; replayed: boolean }>;
export type SubscriptionLifecycleResult = Readonly<{ action: "create" | SubscriptionLifecycleAction; subscription: SubscriptionProjection; replayed: boolean }>;

export interface BillingLifecycleTransaction {
  mutatePlan(input: {
    action: PlanLifecycleAction;
    idempotencyKey: string;
    planId?: UUID;
    slug?: string;
    name?: string;
    description?: string | null;
    currency?: string;
    priceMinor?: number;
    billingPeriod?: BillingPeriod;
    defaultTrialDays?: number;
    reasonCode?: string;
  }): Promise<PlanLifecycleResult>;
  createSubscription(input: {
    idempotencyKey: string;
    tenantId: UUID;
    planId: UUID;
    startsAt: string;
    trialEndsAt?: string;
    currentPeriodEnd: string;
    sourceKind: SubscriptionSourceKind;
    providerKey?: string;
    providerSubscriptionRef?: string;
    providerCustomerRef?: string;
    reasonCode?: string;
  }): Promise<SubscriptionLifecycleResult>;
  mutateSubscription(input: {
    action: SubscriptionLifecycleAction;
    idempotencyKey: string;
    subscriptionId: UUID;
    toPlanId?: UUID;
    cancelMode?: SubscriptionCancelMode;
    reasonCode?: string;
  }): Promise<SubscriptionLifecycleResult>;
}

export interface BillingLifecycleUnitOfWork {
  transaction<T>(fn: (tx: BillingLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>;
}

export interface PlatformBillingQueryStore {
  getPlan(planId: UUID, context: PlatformSecurityContext): Promise<PlanProjection | null>;
  listPlans(input: { status?: PlanStatus; afterSlug?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly PlanProjection[]>;
  getSubscription(subscriptionId: UUID, context: PlatformSecurityContext): Promise<SubscriptionProjection | null>;
  listSubscriptions(input: { tenantId?: UUID; status?: SubscriptionStatus; planId?: UUID; afterSubscriptionId?: UUID; limit?: number }, context: PlatformSecurityContext): Promise<readonly SubscriptionProjection[]>;
}

export interface CurrentTenantSubscriptionResolver {
  resolveCurrentTenantSubscription(context: SecurityContext): Promise<CurrentTenantSubscriptionProjection | null>;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PLAN_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const REASON_CODE = /^[a-z0-9][a-z0-9._:-]{2,63}$/;
const PROVIDER_KEY = /^[a-z0-9][a-z0-9._:-]{1,63}$/;
const PLAN_STATUSES = new Set<PlanStatus>(["draft","active","retired"]);
const SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(["scheduled","trialing","active","suspended","cancel_pending","canceled","expired"]);

function uuid(value: UUID, label: string): UUID {
  const normalized = value.trim();
  if (!UUID_SHAPE.test(normalized)) throw new AppError("VALIDATION_FAILED", `Invalid ${label}`);
  return normalized;
}
function idempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!IDEMPOTENCY_KEY.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid billing idempotency key");
  return normalized;
}
function reasonCode(value: string | undefined, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  const normalized = (value ?? "").trim().toLowerCase();
  if (!REASON_CODE.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid or missing billing reasonCode");
  return normalized;
}
function planSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PLAN_SLUG.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid Plan slug");
  return normalized;
}
function name(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) throw new AppError("VALIDATION_FAILED", "Plan name must be 1..160 characters");
  return normalized;
}
function description(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.trim();
  if (normalized.length > 2000) throw new AppError("VALIDATION_FAILED", "Plan description is too long");
  return normalized || null;
}
function currency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new AppError("VALIDATION_FAILED", "Plan currency must be a 3-letter uppercase code");
  return normalized;
}
function priceMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError("VALIDATION_FAILED", "Plan priceMinor must be a non-negative safe integer");
  return value;
}
function trialDays(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 365) throw new AppError("VALIDATION_FAILED", "defaultTrialDays must be between 0 and 365");
  return value;
}
function iso(value: string, label: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new AppError("VALIDATION_FAILED", `Invalid ${label}`);
  return parsed.toISOString();
}
function providerKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!PROVIDER_KEY.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid providerKey");
  return normalized;
}
function providerRef(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 255) throw new AppError("VALIDATION_FAILED", `Invalid ${label}`);
  return normalized;
}
function listLimit(value: number | undefined, label: string): number {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("VALIDATION_FAILED", `${label} limit must be between 1 and 100`);
  return limit;
}

export async function createPlan(input: { idempotencyKey: string; slug: string; name: string; description?: string | null; currency: string; priceMinor: number; billingPeriod: BillingPeriod; defaultTrialDays?: number; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, "platform.plans.create");
  if (!(["monthly","annual"] as const).includes(input.billingPeriod)) throw new AppError("VALIDATION_FAILED", "Invalid billingPeriod");
  const request = {
    action: "create" as const, idempotencyKey: idempotencyKey(input.idempotencyKey), slug: planSlug(input.slug), name: name(input.name), description: description(input.description),
    currency: currency(input.currency), priceMinor: priceMinor(input.priceMinor), billingPeriod: input.billingPeriod, defaultTrialDays: trialDays(input.defaultTrialDays ?? 0), reasonCode: reasonCode(input.reasonCode)
  };
  return deps.unitOfWork.transaction((tx) => tx.mutatePlan(request), deps.context);
}

export async function updateDraftPlan(input: { idempotencyKey: string; planId: UUID; name: string; description?: string | null; currency: string; priceMinor: number; billingPeriod: BillingPeriod; defaultTrialDays: number; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, "platform.plans.update");
  if (!(["monthly","annual"] as const).includes(input.billingPeriod)) throw new AppError("VALIDATION_FAILED", "Invalid billingPeriod");
  const request = {
    action: "update" as const, idempotencyKey: idempotencyKey(input.idempotencyKey), planId: uuid(input.planId,"Plan id"), name: name(input.name), description: description(input.description),
    currency: currency(input.currency), priceMinor: priceMinor(input.priceMinor), billingPeriod: input.billingPeriod, defaultTrialDays: trialDays(input.defaultTrialDays), reasonCode: reasonCode(input.reasonCode)
  };
  return deps.unitOfWork.transaction((tx) => tx.mutatePlan(request), deps.context);
}

async function transitionPlan(action: "activate" | "retire", permission: string, input: { idempotencyKey: string; planId: UUID; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, permission);
  const request = { action, idempotencyKey: idempotencyKey(input.idempotencyKey), planId: uuid(input.planId,"Plan id"), reasonCode: reasonCode(input.reasonCode) };
  return deps.unitOfWork.transaction((tx) => tx.mutatePlan(request), deps.context);
}
export const activatePlan = (input: { idempotencyKey: string; planId: UUID; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => transitionPlan("activate","platform.plans.activate",input,deps);
export const retirePlan = (input: { idempotencyKey: string; planId: UUID; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => transitionPlan("retire","platform.plans.retire",input,deps);

export async function createSubscription(input: { idempotencyKey: string; tenantId: UUID; planId: UUID; startsAt: string; trialEndsAt?: string; currentPeriodEnd: string; sourceKind?: SubscriptionSourceKind; providerKey?: string; providerSubscriptionRef?: string; providerCustomerRef?: string; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, "platform.subscriptions.create");
  const sourceKind = input.sourceKind ?? "manual";
  if (!(["manual","migration","provider"] as const).includes(sourceKind)) throw new AppError("VALIDATION_FAILED", "Invalid subscription sourceKind");
  const normalizedProviderKey = providerKey(input.providerKey);
  const subscriptionRef = providerRef(input.providerSubscriptionRef,"providerSubscriptionRef");
  const customerRef = providerRef(input.providerCustomerRef,"providerCustomerRef");
  if ((subscriptionRef || customerRef) && !normalizedProviderKey) throw new AppError("VALIDATION_FAILED", "providerKey is required when provider references are present");
  if (sourceKind === "provider" && (!normalizedProviderKey || !subscriptionRef)) throw new AppError("VALIDATION_FAILED", "Provider subscriptions require providerKey and providerSubscriptionRef");
  const startsAt = iso(input.startsAt,"startsAt");
  const currentPeriodEnd = iso(input.currentPeriodEnd,"currentPeriodEnd");
  if (new Date(currentPeriodEnd) <= new Date(startsAt)) throw new AppError("VALIDATION_FAILED", "currentPeriodEnd must be after startsAt");
  const trialEndsAt = input.trialEndsAt === undefined ? undefined : iso(input.trialEndsAt,"trialEndsAt");
  if (trialEndsAt && new Date(trialEndsAt) <= new Date(startsAt)) throw new AppError("VALIDATION_FAILED", "trialEndsAt must be after startsAt");
  const request = {
    idempotencyKey: idempotencyKey(input.idempotencyKey), tenantId: uuid(input.tenantId,"Tenant id"), planId: uuid(input.planId,"Plan id"), startsAt, trialEndsAt, currentPeriodEnd,
    sourceKind, providerKey: normalizedProviderKey, providerSubscriptionRef: subscriptionRef, providerCustomerRef: customerRef, reasonCode: reasonCode(input.reasonCode)
  };
  return deps.unitOfWork.transaction((tx) => tx.createSubscription(request), deps.context);
}

const SUBSCRIPTION_PERMISSION: Record<SubscriptionLifecycleAction,string> = {
  activate: "platform.subscriptions.activate",
  suspend: "platform.subscriptions.suspend",
  reactivate: "platform.subscriptions.reactivate",
  schedule_cancel: "platform.subscriptions.schedule_cancel",
  unschedule_cancel: "platform.subscriptions.unschedule_cancel",
  cancel: "platform.subscriptions.cancel",
  expire: "platform.subscriptions.expire",
  change_plan: "platform.subscriptions.change_plan"
};

async function mutateSubscription(action: SubscriptionLifecycleAction, input: { idempotencyKey: string; subscriptionId: UUID; toPlanId?: UUID; cancelMode?: SubscriptionCancelMode; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, SUBSCRIPTION_PERMISSION[action]);
  if (action === "change_plan" && !input.toPlanId) throw new AppError("VALIDATION_FAILED", "toPlanId is required for change_plan");
  if (action !== "change_plan" && input.toPlanId) throw new AppError("VALIDATION_FAILED", "toPlanId is only valid for change_plan");
  if (action === "cancel" && !input.cancelMode) throw new AppError("VALIDATION_FAILED", "cancelMode is required for cancel");
  if (action !== "cancel" && input.cancelMode) throw new AppError("VALIDATION_FAILED", "cancelMode is only valid for cancel");
  if (input.cancelMode && !(["immediate","finalize_scheduled"] as const).includes(input.cancelMode)) throw new AppError("VALIDATION_FAILED", "Invalid cancelMode");
  const reasonRequired = action === "suspend" || action === "cancel" || action === "expire";
  const request = {
    action, idempotencyKey: idempotencyKey(input.idempotencyKey), subscriptionId: uuid(input.subscriptionId,"Subscription id"),
    toPlanId: input.toPlanId ? uuid(input.toPlanId,"target Plan id") : undefined, cancelMode: input.cancelMode, reasonCode: reasonCode(input.reasonCode, reasonRequired)
  };
  return deps.unitOfWork.transaction((tx) => tx.mutateSubscription(request), deps.context);
}

export const activateSubscription = (input: { idempotencyKey: string; subscriptionId: UUID; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => mutateSubscription("activate",input,deps);
export const suspendSubscription = (input: { idempotencyKey: string; subscriptionId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => mutateSubscription("suspend",input,deps);
export const reactivateSubscription = (input: { idempotencyKey: string; subscriptionId: UUID; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => mutateSubscription("reactivate",input,deps);
export const scheduleSubscriptionCancellation = (input: { idempotencyKey: string; subscriptionId: UUID; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => mutateSubscription("schedule_cancel",input,deps);
export const unscheduleSubscriptionCancellation = (input: { idempotencyKey: string; subscriptionId: UUID; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => mutateSubscription("unschedule_cancel",input,deps);
export const cancelSubscription = (input: { idempotencyKey: string; subscriptionId: UUID; mode: SubscriptionCancelMode; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => mutateSubscription("cancel",{...input,cancelMode:input.mode},deps);
export const expireSubscription = (input: { idempotencyKey: string; subscriptionId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => mutateSubscription("expire",input,deps);
export const changeSubscriptionPlan = (input: { idempotencyKey: string; subscriptionId: UUID; toPlanId: UUID; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: BillingLifecycleUnitOfWork }) => mutateSubscription("change_plan",input,deps);

export async function getPlanAdmin(planId: UUID, deps: { context: PlatformSecurityContext; queries: PlatformBillingQueryStore }) {
  requirePlatformPermission(deps.context,"platform.plans.read");
  return deps.queries.getPlan(uuid(planId,"Plan id"),deps.context);
}
export async function listPlansAdmin(input: { status?: PlanStatus; afterSlug?: string; limit?: number }, deps: { context: PlatformSecurityContext; queries: PlatformBillingQueryStore }) {
  requirePlatformPermission(deps.context,"platform.plans.read");
  if (input.status && !PLAN_STATUSES.has(input.status)) throw new AppError("VALIDATION_FAILED","Invalid Plan status filter");
  return deps.queries.listPlans({status:input.status,afterSlug:input.afterSlug===undefined?undefined:planSlug(input.afterSlug),limit:listLimit(input.limit,"Plan list")},deps.context);
}
export async function getSubscriptionAdmin(subscriptionId: UUID, deps: { context: PlatformSecurityContext; queries: PlatformBillingQueryStore }) {
  requirePlatformPermission(deps.context,"platform.subscriptions.read");
  return deps.queries.getSubscription(uuid(subscriptionId,"Subscription id"),deps.context);
}
export async function listSubscriptionsAdmin(input: { tenantId?: UUID; status?: SubscriptionStatus; planId?: UUID; afterSubscriptionId?: UUID; limit?: number }, deps: { context: PlatformSecurityContext; queries: PlatformBillingQueryStore }) {
  requirePlatformPermission(deps.context,"platform.subscriptions.read");
  if (input.status && !SUBSCRIPTION_STATUSES.has(input.status)) throw new AppError("VALIDATION_FAILED","Invalid Subscription status filter");
  return deps.queries.listSubscriptions({
    tenantId: input.tenantId ? uuid(input.tenantId,"Tenant filter") : undefined,
    status: input.status,
    planId: input.planId ? uuid(input.planId,"Plan filter") : undefined,
    afterSubscriptionId: input.afterSubscriptionId ? uuid(input.afterSubscriptionId,"Subscription cursor") : undefined,
    limit: listLimit(input.limit,"Subscription list")
  },deps.context);
}

export function resolveCurrentTenantSubscription(deps: { context: SecurityContext; resolver: CurrentTenantSubscriptionResolver }) {
  return deps.resolver.resolveCurrentTenantSubscription(deps.context);
}
