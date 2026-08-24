import { AppError, type PlatformSecurityContext, type UUID } from "../../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "../../../authorization/src/index.ts";

export type LocationLifecycleAction = "update" | "suspend" | "reactivate" | "archive" | "transfer_primary";
export type LocationStatus = "active" | "inactive" | "suspended" | "archived";

export type LocationAdminProjection = Readonly<{
  id: UUID;
  tenantId: UUID;
  slug: string;
  name: string;
  status: LocationStatus;
  timezone: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type LocationLifecycleResult = Readonly<{
  action: LocationLifecycleAction;
  location: LocationAdminProjection;
  replayed: boolean;
  previousPrimaryLocationId?: UUID;
}>;

export interface LocationLifecycleTransaction {
  mutateLocation(input: {
    action: Exclude<LocationLifecycleAction, "transfer_primary">;
    idempotencyKey: string;
    locationId: UUID;
    name?: string;
    timezone?: string;
    reasonCode?: string;
  }): Promise<LocationLifecycleResult>;
  transferPrimaryLocation(input: {
    idempotencyKey: string;
    sourceLocationId: UUID;
    targetLocationId: UUID;
    reasonCode: string;
  }): Promise<LocationLifecycleResult>;
}

export interface LocationLifecycleUnitOfWork {
  transaction<T>(fn: (tx: LocationLifecycleTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>;
}

export interface LocationAdminQueryStore {
  getLocation(locationId: UUID, context: PlatformSecurityContext): Promise<LocationAdminProjection | null>;
  listLocations(input: { tenantId: UUID; status?: LocationStatus; afterId?: UUID; limit?: number }, context: PlatformSecurityContext): Promise<readonly LocationAdminProjection[]>;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const REASON_CODE = /^[a-z0-9][a-z0-9._:-]{2,63}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS = new Set<LocationStatus>(["active", "inactive", "suspended", "archived"]);
const PERMISSION: Record<LocationLifecycleAction, string> = {
  update: "platform.locations.update",
  suspend: "platform.locations.suspend",
  reactivate: "platform.locations.reactivate",
  archive: "platform.locations.archive",
  transfer_primary: "platform.locations.transfer_primary"
};

function normalizeId(value: UUID, label: string): UUID {
  const normalized = value.trim();
  if (!UUID_SHAPE.test(normalized)) throw new AppError("VALIDATION_FAILED", `Invalid ${label}`);
  return normalized;
}

function normalizeBase(input: { idempotencyKey: string; locationId: UUID }) {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new AppError("VALIDATION_FAILED", "Invalid Location lifecycle idempotency key");
  return { idempotencyKey, locationId: normalizeId(input.locationId, "Location id") };
}

function normalizeReason(reasonCode: string | undefined): string {
  const normalized = (reasonCode ?? "").trim().toLowerCase();
  if (!REASON_CODE.test(normalized)) throw new AppError("VALIDATION_FAILED", "A governed reasonCode is required for Location lifecycle mutation");
  return normalized;
}

async function execute(action: Exclude<LocationLifecycleAction, "transfer_primary">, input: {
  idempotencyKey: string;
  locationId: UUID;
  name?: string;
  timezone?: string;
  reasonCode?: string;
}, deps: { context: PlatformSecurityContext; unitOfWork: LocationLifecycleUnitOfWork }): Promise<LocationLifecycleResult> {
  requirePlatformPermission(deps.context, PERMISSION[action]);
  const base = normalizeBase(input);
  return deps.unitOfWork.transaction((tx) => tx.mutateLocation({ action, ...base, name: input.name, timezone: input.timezone, reasonCode: input.reasonCode }), deps.context);
}

export async function updateLocation(input: { idempotencyKey: string; locationId: UUID; name?: string; timezone?: string }, deps: { context: PlatformSecurityContext; unitOfWork: LocationLifecycleUnitOfWork }) {
  const name = input.name === undefined ? undefined : input.name.trim();
  const timezone = input.timezone === undefined ? undefined : input.timezone.trim();
  if (name === undefined && timezone === undefined) throw new AppError("VALIDATION_FAILED", "Location update requires at least one mutable field");
  if (name !== undefined && !name) throw new AppError("VALIDATION_FAILED", "Location name cannot be empty");
  if (timezone !== undefined && !timezone) throw new AppError("VALIDATION_FAILED", "Location timezone cannot be empty");
  return execute("update", { ...input, name, timezone }, deps);
}

export async function suspendLocation(input: { idempotencyKey: string; locationId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: LocationLifecycleUnitOfWork }) {
  return execute("suspend", { ...input, reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function reactivateLocation(input: { idempotencyKey: string; locationId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: LocationLifecycleUnitOfWork }) {
  return execute("reactivate", { ...input, reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function archiveLocation(input: { idempotencyKey: string; locationId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: LocationLifecycleUnitOfWork }) {
  return execute("archive", { ...input, reasonCode: normalizeReason(input.reasonCode) }, deps);
}

export async function transferPrimaryLocation(input: { idempotencyKey: string; sourceLocationId: UUID; targetLocationId: UUID; reasonCode: string }, deps: { context: PlatformSecurityContext; unitOfWork: LocationLifecycleUnitOfWork }) {
  requirePlatformPermission(deps.context, PERMISSION.transfer_primary);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new AppError("VALIDATION_FAILED", "Invalid Location primary-transfer idempotency key");
  const sourceLocationId = normalizeId(input.sourceLocationId, "source Location id");
  const targetLocationId = normalizeId(input.targetLocationId, "target Location id");
  if (sourceLocationId === targetLocationId) throw new AppError("VALIDATION_FAILED", "Primary transfer requires distinct source and target Locations");
  const reasonCode = normalizeReason(input.reasonCode);
  return deps.unitOfWork.transaction((tx) => tx.transferPrimaryLocation({ idempotencyKey, sourceLocationId, targetLocationId, reasonCode }), deps.context);
}

export async function getLocationAdmin(locationId: UUID, deps: { context: PlatformSecurityContext; queries: LocationAdminQueryStore }) {
  requirePlatformPermission(deps.context, "platform.locations.read");
  return deps.queries.getLocation(normalizeId(locationId, "Location id"), deps.context);
}

export async function listLocationsAdmin(input: { tenantId: UUID; status?: LocationStatus; afterId?: UUID; limit?: number }, deps: { context: PlatformSecurityContext; queries: LocationAdminQueryStore }) {
  requirePlatformPermission(deps.context, "platform.locations.read");
  const tenantId = normalizeId(input.tenantId, "Tenant id");
  const afterId = input.afterId === undefined ? undefined : normalizeId(input.afterId, "Location list cursor");
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("VALIDATION_FAILED", "Location list limit must be between 1 and 100");
  if (input.status !== undefined && !STATUS.has(input.status)) throw new AppError("VALIDATION_FAILED", "Invalid Location status filter");
  return deps.queries.listLocations({ tenantId, status: input.status, afterId, limit }, deps.context);
}
