import { AppError, type PlatformSecurityContext, type UUID } from "../../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "../../../authorization/src/index.ts";

export type TenantLifecycleAction = "update" | "suspend" | "reactivate" | "archive";
export type TenantStatus = "active" | "suspended" | "archived";

export type TenantAdminProjection = Readonly<{
  id: UUID;
  slug: string;
  name: string;
  status: TenantStatus;
  locale: string;
  timezone: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}>;

export type TenantLifecycleResult = Readonly<{
  action: TenantLifecycleAction;
  tenant: TenantAdminProjection;
  replayed: boolean;
}>;

export interface TenantLifecycleTransaction {
  mutateTenant(input: {
    action: TenantLifecycleAction;
    idempotencyKey: string;
    tenantId: UUID;
    name?: string;
    locale?: string;
    timezone?: string;
    currency?: string;
    reasonCode?: string;
  }): Promise<TenantLifecycleResult>;
}

export interface TenantLifecycleUnitOfWork {
  transaction<T>(fn: (tx: TenantLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>;
}

export interface TenantAdminQueryStore {
  getTenant(tenantId: UUID, context: PlatformSecurityContext): Promise<TenantAdminProjection | null>;
  listTenants(input: { status?: TenantStatus; afterId?: UUID; limit?: number }, context: PlatformSecurityContext): Promise<readonly TenantAdminProjection[]>;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const REASON_CODE = /^[a-z0-9][a-z0-9._:-]{2,63}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION: Record<TenantLifecycleAction, string> = {
  update: "platform.tenants.update",
  suspend: "platform.tenants.suspend",
  reactivate: "platform.tenants.reactivate",
  archive: "platform.tenants.archive"
};

function normalizeBase(input: { idempotencyKey: string; tenantId: UUID }) {
  const idempotencyKey = input.idempotencyKey.trim();
  const tenantId = input.tenantId.trim();
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new AppError("VALIDATION_FAILED", "Invalid Tenant lifecycle idempotency key");
  if (!UUID_SHAPE.test(tenantId)) throw new AppError("VALIDATION_FAILED", "Invalid Tenant id");
  return { idempotencyKey, tenantId };
}

function normalizeReason(reasonCode: string | undefined): string {
  const normalized = (reasonCode ?? "").trim().toLowerCase();
  if (!REASON_CODE.test(normalized)) throw new AppError("VALIDATION_FAILED", "A governed reasonCode is required for Tenant state transition");
  return normalized;
}

async function execute(action: TenantLifecycleAction, input: {
  idempotencyKey: string;
  tenantId: UUID;
  name?: string;
  locale?: string;
  timezone?: string;
  currency?: string;
  reasonCode?: string;
}, deps: { context: PlatformSecurityContext; unitOfWork: TenantLifecycleUnitOfWork }): Promise<TenantLifecycleResult> {
  requirePlatformPermission(deps.context, PERMISSION[action]);
  const base = normalizeBase(input);
  return deps.unitOfWork.transaction((tx) => tx.mutateTenant({
    action,
    ...base,
    name: input.name,
    locale: input.locale,
    timezone: input.timezone,
    currency: input.currency,
    reasonCode: input.reasonCode
  }), deps.context);
}

export async function updateTenant(input: { idempotencyKey: string; tenantId: UUID; name?: string; locale?: string; timezone?: string; currency?: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantLifecycleUnitOfWork }) {
  const name = input.name === undefined ? undefined : input.name.trim();
  const locale = input.locale === undefined ? undefined : input.locale.trim();
  const timezone = input.timezone === undefined ? undefined : input.timezone.trim();
  const currency = input.currency === undefined ? undefined : input.currency.trim().toUpperCase();
  if (name === undefined && locale === undefined && timezone === undefined && currency === undefined) throw new AppError("VALIDATION_FAILED", "Tenant update requires at least one mutable field");
  if (name !== undefined && !name) throw new AppError("VALIDATION_FAILED", "Tenant name cannot be empty");
  if (locale !== undefined && !locale) throw new AppError("VALIDATION_FAILED", "Tenant locale cannot be empty");
  if (timezone !== undefined && !timezone) throw new AppError("VALIDATION_FAILED", "Tenant timezone cannot be empty");
  if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) throw new AppError("VALIDATION_FAILED", "Tenant currency must be a three-letter uppercase code");
  return execute("update", { ...input, name, locale, timezone, currency }, deps);
}

export async function suspendTenant(input: { idempotencyKey: string; tenantId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantLifecycleUnitOfWork }) {
  return execute("suspend", { ...input, reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function reactivateTenant(input: { idempotencyKey: string; tenantId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantLifecycleUnitOfWork }) {
  return execute("reactivate", { ...input, reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function archiveTenant(input: { idempotencyKey: string; tenantId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantLifecycleUnitOfWork }) {
  return execute("archive", { ...input, reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function getTenantAdmin(tenantId: UUID, deps: { context: PlatformSecurityContext; queries: TenantAdminQueryStore }) {
  requirePlatformPermission(deps.context, "platform.tenants.read");
  if (!UUID_SHAPE.test(tenantId)) throw new AppError("VALIDATION_FAILED", "Invalid Tenant id");
  return deps.queries.getTenant(tenantId, deps.context);
}

export async function listTenantsAdmin(input: { status?: TenantStatus; afterId?: UUID; limit?: number }, deps: { context: PlatformSecurityContext; queries: TenantAdminQueryStore }) {
  requirePlatformPermission(deps.context, "platform.tenants.read");
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("VALIDATION_FAILED", "Tenant list limit must be between 1 and 100");
  if (input.afterId && !UUID_SHAPE.test(input.afterId)) throw new AppError("VALIDATION_FAILED", "Invalid Tenant list cursor");
  return deps.queries.listTenants({ ...input, limit }, deps.context);
}
