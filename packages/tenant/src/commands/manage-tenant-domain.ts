import { AppError, type PlatformSecurityContext, type UUID } from "../../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "../../../authorization/src/index.ts";
import { normalizeHostname } from "../index.ts";

export type TenantDomainStatus = "pending" | "verified" | "active" | "disabled" | "error";
export type TenantDomainVerificationState = "unverified" | "pending" | "verified" | "failed";
export type TenantDomainAction = "register" | "start_verification" | "verify" | "fail_verification" | "retry_verification" | "activate" | "disable" | "set_location";

export type TenantDomainAdminProjection = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId?: UUID;
  hostname: string;
  status: TenantDomainStatus;
  verificationState: TenantDomainVerificationState;
  createdAt: string;
  updatedAt: string;
}>;

export type TenantDomainLifecycleResult = Readonly<{
  action: TenantDomainAction;
  domain: TenantDomainAdminProjection;
  replayed: boolean;
}>;

export interface TenantDomainLifecycleTransaction {
  registerDomain(input: { idempotencyKey: string; tenantId: UUID; hostname: string; locationId?: UUID }): Promise<TenantDomainLifecycleResult>;
  mutateDomain(input: { action: Exclude<TenantDomainAction, "register">; idempotencyKey: string; domainId: UUID; locationId?: UUID | null; reasonCode?: string; verificationEvidenceRef?: string }): Promise<TenantDomainLifecycleResult>;
}

export interface TenantDomainLifecycleUnitOfWork {
  transaction<T>(fn: (tx: TenantDomainLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>;
}

export interface TenantDomainAdminQueryStore {
  getTenantDomain(domainId: UUID, context: PlatformSecurityContext): Promise<TenantDomainAdminProjection | null>;
  listTenantDomains(input: { tenantId: UUID; status?: TenantDomainStatus; afterId?: UUID; limit?: number }, context: PlatformSecurityContext): Promise<readonly TenantDomainAdminProjection[]>;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const REASON_CODE = /^[a-z0-9][a-z0-9._:-]{2,63}$/;
const EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const STATUS = new Set<TenantDomainStatus>(["pending", "verified", "active", "disabled", "error"]);
const PERMISSION: Record<TenantDomainAction, string> = {
  register: "platform.domains.register",
  start_verification: "platform.domains.verify",
  verify: "platform.domains.verify",
  fail_verification: "platform.domains.verify",
  retry_verification: "platform.domains.verify",
  activate: "platform.domains.activate",
  disable: "platform.domains.disable",
  set_location: "platform.domains.bind_location"
};

function normalizeId(value: UUID, label: string): UUID {
  const normalized = value.trim();
  if (!UUID_SHAPE.test(normalized)) throw new AppError("VALIDATION_FAILED", `Invalid ${label}`);
  return normalized;
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!IDEMPOTENCY_KEY.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid TenantDomain idempotency key");
  return normalized;
}

function normalizeReason(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!REASON_CODE.test(normalized)) throw new AppError("VALIDATION_FAILED", "A governed reasonCode is required");
  return normalized;
}

function normalizeEvidence(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  if (!EVIDENCE_REF.test(normalized)) throw new AppError("VALIDATION_FAILED", "A trusted verification evidence reference is required");
  return normalized;
}

async function mutate(action: Exclude<TenantDomainAction, "register">, input: { idempotencyKey: string; domainId: UUID; locationId?: UUID | null; reasonCode?: string; verificationEvidenceRef?: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, PERMISSION[action]);
  return deps.unitOfWork.transaction((tx) => tx.mutateDomain({
    action,
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    domainId: normalizeId(input.domainId, "TenantDomain id"),
    locationId: input.locationId === undefined || input.locationId === null ? input.locationId : normalizeId(input.locationId, "Location id"),
    reasonCode: input.reasonCode,
    verificationEvidenceRef: input.verificationEvidenceRef
  }), deps.context);
}

export async function registerTenantDomain(input: { idempotencyKey: string; tenantId: UUID; hostname: string; locationId?: UUID }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, PERMISSION.register);
  const hostname = normalizeHostname(input.hostname);
  return deps.unitOfWork.transaction((tx) => tx.registerDomain({
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    tenantId: normalizeId(input.tenantId, "Tenant id"),
    hostname,
    locationId: input.locationId === undefined ? undefined : normalizeId(input.locationId, "Location id")
  }), deps.context);
}

export async function startTenantDomainVerification(input: { idempotencyKey: string; domainId: UUID }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  return mutate("start_verification", input, deps);
}

export async function recordTenantDomainVerificationPassed(input: { idempotencyKey: string; domainId: UUID; verificationEvidenceRef: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  return mutate("verify", { ...input, verificationEvidenceRef: normalizeEvidence(input.verificationEvidenceRef) }, deps);
}

export async function recordTenantDomainVerificationFailed(input: { idempotencyKey: string; domainId: UUID; verificationEvidenceRef: string; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  return mutate("fail_verification", { ...input, verificationEvidenceRef: normalizeEvidence(input.verificationEvidenceRef), reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function retryTenantDomainVerification(input: { idempotencyKey: string; domainId: UUID }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  return mutate("retry_verification", input, deps);
}

export async function activateTenantDomain(input: { idempotencyKey: string; domainId: UUID }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  return mutate("activate", input, deps);
}

export async function disableTenantDomain(input: { idempotencyKey: string; domainId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  return mutate("disable", { ...input, reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function setTenantDomainLocation(input: { idempotencyKey: string; domainId: UUID; locationId?: UUID | null; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: TenantDomainLifecycleUnitOfWork }) {
  return mutate("set_location", { ...input, reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function getTenantDomainAdmin(domainId: UUID, deps: { context: PlatformSecurityContext; queries: TenantDomainAdminQueryStore }) {
  requirePlatformPermission(deps.context, "platform.domains.read");
  return deps.queries.getTenantDomain(normalizeId(domainId, "TenantDomain id"), deps.context);
}

export async function listTenantDomainsAdmin(input: { tenantId: UUID; status?: TenantDomainStatus; afterId?: UUID; limit?: number }, deps: { context: PlatformSecurityContext; queries: TenantDomainAdminQueryStore }) {
  requirePlatformPermission(deps.context, "platform.domains.read");
  const tenantId = normalizeId(input.tenantId, "Tenant id");
  const afterId = input.afterId === undefined ? undefined : normalizeId(input.afterId, "TenantDomain list cursor");
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("VALIDATION_FAILED", "TenantDomain list limit must be between 1 and 100");
  if (input.status !== undefined && !STATUS.has(input.status)) throw new AppError("VALIDATION_FAILED", "Invalid TenantDomain status filter");
  return deps.queries.listTenantDomains({ tenantId, status: input.status, afterId, limit }, deps.context);
}
