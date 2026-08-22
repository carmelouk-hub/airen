import { AppError, type PlatformSecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "./index.ts";

export type PlatformRoleAssignmentStatus = "active" | "suspended" | "revoked";
export type PlatformRoleLifecycleAction = "assign" | "suspend" | "reactivate" | "revoke";

export type PlatformRoleAssignmentProjection = Readonly<{
  identityId: UUID;
  roleKey: string;
  status: PlatformRoleAssignmentStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type PlatformRoleLifecycleResult = Readonly<{
  action: PlatformRoleLifecycleAction;
  assignment: PlatformRoleAssignmentProjection;
  replayed: boolean;
}>;

export type PlatformPrincipalProjection = Readonly<{
  identityId: UUID;
  displayName?: string;
  primaryEmail?: string;
  status: string;
  roleAssignments: readonly PlatformRoleAssignmentProjection[];
}>;

export type PlatformRoleCatalogProjection = Readonly<{
  roleKey: string;
  permissionKeys: readonly string[];
  protected: boolean;
  minimumActiveAssignments: number;
  activeAssignmentCount: number;
}>;

export interface PlatformRoleLifecycleTransaction {
  mutateRoleAssignment(input: { action: PlatformRoleLifecycleAction; idempotencyKey: string; targetIdentityId: UUID; roleKey: string; reasonCode?: string }): Promise<PlatformRoleLifecycleResult>;
}

export interface PlatformRoleLifecycleUnitOfWork {
  transaction<T>(fn: (tx: PlatformRoleLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>;
}

export interface PlatformPrincipalRoleQueryStore {
  getPrincipal(identityId: UUID, context: PlatformSecurityContext): Promise<PlatformPrincipalProjection | null>;
  listPrincipals(input: { activeRoleKey?: string; afterIdentityId?: UUID; limit?: number }, context: PlatformSecurityContext): Promise<readonly PlatformPrincipalProjection[]>;
  listRoles(input: { afterRoleKey?: string; limit?: number }, context: PlatformSecurityContext): Promise<readonly PlatformRoleCatalogProjection[]>;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ROLE_KEY = /^[a-z][a-z0-9._:-]{2,63}$/;
const REASON_CODE = /^[a-z0-9][a-z0-9._:-]{2,63}$/;
const PERMISSION: Record<PlatformRoleLifecycleAction,string> = {
  assign: "platform.roles.assign",
  suspend: "platform.roles.suspend",
  reactivate: "platform.roles.reactivate",
  revoke: "platform.roles.revoke"
};

function normalizeId(value: UUID, label: string): UUID {
  const normalized = value.trim();
  if (!UUID_SHAPE.test(normalized)) throw new AppError("VALIDATION_FAILED", `Invalid ${label}`);
  return normalized;
}
function normalizeIdempotency(value: string): string {
  const normalized = value.trim();
  if (!IDEMPOTENCY_KEY.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid platform role idempotency key");
  return normalized;
}
function normalizeRoleKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!ROLE_KEY.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid platform role key");
  return normalized;
}
function normalizeReason(value: string | undefined, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  const normalized = (value ?? "").trim().toLowerCase();
  if (!REASON_CODE.test(normalized)) throw new AppError("VALIDATION_FAILED", "A governed reasonCode is required");
  return normalized;
}

async function mutate(action: PlatformRoleLifecycleAction, input: { idempotencyKey: string; targetIdentityId: UUID; roleKey: string; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: PlatformRoleLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, PERMISSION[action]);
  const targetIdentityId = normalizeId(input.targetIdentityId, "target Identity id");
  if ((action === "assign" || action === "reactivate") && targetIdentityId === deps.context.actorIdentityId) {
    throw new AppError("PERMISSION_DENIED", "Platform role authority cannot be self-granted or self-reactivated");
  }
  return deps.unitOfWork.transaction((tx) => tx.mutateRoleAssignment({
    action,
    idempotencyKey: normalizeIdempotency(input.idempotencyKey),
    targetIdentityId,
    roleKey: normalizeRoleKey(input.roleKey),
    reasonCode: normalizeReason(input.reasonCode, action === "suspend" || action === "revoke")
  }), deps.context);
}

export function assignPlatformRole(input: { idempotencyKey: string; targetIdentityId: UUID; roleKey: string; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: PlatformRoleLifecycleUnitOfWork }) {
  return mutate("assign", input, deps);
}
export function suspendPlatformRole(input: { idempotencyKey: string; targetIdentityId: UUID; roleKey: string; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: PlatformRoleLifecycleUnitOfWork }) {
  return mutate("suspend", input, deps);
}
export function reactivatePlatformRole(input: { idempotencyKey: string; targetIdentityId: UUID; roleKey: string; reasonCode?: string }, deps: { context: PlatformSecurityContext; unitOfWork: PlatformRoleLifecycleUnitOfWork }) {
  return mutate("reactivate", input, deps);
}
export function revokePlatformRole(input: { idempotencyKey: string; targetIdentityId: UUID; roleKey: string; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: PlatformRoleLifecycleUnitOfWork }) {
  return mutate("revoke", input, deps);
}

export async function getPlatformPrincipalAdmin(identityId: UUID, deps: { context: PlatformSecurityContext; queries: PlatformPrincipalRoleQueryStore }) {
  requirePlatformPermission(deps.context, "platform.principals.read");
  return deps.queries.getPrincipal(normalizeId(identityId, "Identity id"), deps.context);
}

export async function listPlatformPrincipalsAdmin(input: { activeRoleKey?: string; afterIdentityId?: UUID; limit?: number }, deps: { context: PlatformSecurityContext; queries: PlatformPrincipalRoleQueryStore }) {
  requirePlatformPermission(deps.context, "platform.principals.read");
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("VALIDATION_FAILED", "Platform principal list limit must be between 1 and 100");
  return deps.queries.listPrincipals({
    activeRoleKey: input.activeRoleKey === undefined ? undefined : normalizeRoleKey(input.activeRoleKey),
    afterIdentityId: input.afterIdentityId === undefined ? undefined : normalizeId(input.afterIdentityId, "Platform principal cursor"),
    limit
  }, deps.context);
}

export async function listPlatformRolesAdmin(input: { afterRoleKey?: string; limit?: number }, deps: { context: PlatformSecurityContext; queries: PlatformPrincipalRoleQueryStore }) {
  requirePlatformPermission(deps.context, "platform.roles.read");
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("VALIDATION_FAILED", "Platform role list limit must be between 1 and 100");
  return deps.queries.listRoles({ afterRoleKey: input.afterRoleKey === undefined ? undefined : normalizeRoleKey(input.afterRoleKey), limit }, deps.context);
}
