import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const SERVICE_SESSION_MANAGE_PERMISSION = "service-session.manage";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const SERVICE_OPERATIONS_ENTITLEMENT = "service-operations.enabled";
export const SERVICE_SESSION_CHANGED_ACTION = "SERVICE_SESSION_CHANGED";

export type ServiceSessionStatus = "OPEN" | "CLOSED" | "CANCELLED";
export type ServiceSessionEnvironmentClass = "PRODUCTION" | "DEMO" | "SANDBOX" | "TEST_TEMPORARY";

export type ServiceSessionRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  tableId: string;
  bookingId?: string;
  queueEntryId?: string;
  status: ServiceSessionStatus;
  rowVersion: number;
  environmentClass: ServiceSessionEnvironmentClass;
  openedAt: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ServiceSessionOutboxEvent = Readonly<{
  aggregateType: "ServiceSession";
  aggregateId: string;
  eventType: "ServiceSessionChanged" | "ServiceSessionClosed";
  correlationId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface ServiceSessionTransaction extends TransactionContext {
  getServiceSessionForTransition(serviceSessionId: string): Promise<ServiceSessionRecord | null>;
  transitionServiceSession(input: Readonly<{
    serviceSessionId: string;
    expectedRowVersion: number;
    nextStatus: "CLOSED" | "CANCELLED";
    closedAt: string;
    updatedAt: string;
  }>): Promise<ServiceSessionRecord>;
  enqueueServiceSessionEvent(event: ServiceSessionOutboxEvent): Promise<void>;
}

export type ServiceSessionDependencies = Readonly<{
  unitOfWork: UnitOfWork<ServiceSessionTransaction>;
  now?: () => string;
}>;

function validation(message: string): never {
  throw new AppError("VALIDATION_FAILED", message);
}

function conflict(message: string): never {
  throw new AppError("CONFLICT", message);
}

function notFound(message: string): never {
  throw new AppError("NOT_FOUND", message);
}

function normalizeId(value: string, field: string): string {
  const normalized = value?.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    validation(`${field} is invalid`);
  }
  return normalized.toLowerCase();
}

function expectedVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1) validation("expectedRowVersion is invalid");
  return value;
}

function serverNow(now?: () => string): string {
  const value = (now ?? (() => new Date().toISOString()))();
  if (!Number.isFinite(Date.parse(value))) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Server clock returned invalid timestamp");
  }
  return new Date(value).toISOString();
}

function requireEntitlements(context: SecurityContext): void {
  for (const entitlement of [RISTOAIREN_ENTITLEMENT, SERVICE_OPERATIONS_ENTITLEMENT]) {
    if (!context.entitlements.includes(entitlement)) {
      throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${entitlement}`);
    }
  }
}

function authority(context: SecurityContext): void {
  requireEntitlements(context);
  requirePermission(context, SERVICE_SESSION_MANAGE_PERMISSION, {
    tenantId: context.tenantId,
    locationId: context.locationId
  });
}

function audit(
  context: SecurityContext,
  serviceSessionId: string,
  metadata: Readonly<Record<string, unknown>>
): AuditRecord {
  return Object.freeze({
    actorIdentityId: context.actorIdentityId,
    tenantId: context.tenantId,
    locationId: context.locationId,
    actionKey: SERVICE_SESSION_CHANGED_ACTION,
    resourceType: "ServiceSession",
    resourceId: serviceSessionId,
    correlationId: context.correlationId,
    outcome: "success",
    metadata
  });
}

function assertScope(context: SecurityContext, session: ServiceSessionRecord): void {
  if (session.tenantId !== context.tenantId || session.locationId !== context.locationId) {
    notFound("ServiceSession not found");
  }
}

export async function closeServiceSession(
  context: SecurityContext,
  rawInput: Readonly<{
    serviceSessionId: string;
    expectedRowVersion: number;
    outcome?: "CLOSED" | "CANCELLED";
  }>,
  dependencies: ServiceSessionDependencies
): Promise<ServiceSessionRecord> {
  authority(context);
  const serviceSessionId = normalizeId(rawInput.serviceSessionId, "serviceSessionId");
  const version = expectedVersion(rawInput.expectedRowVersion);
  const nextStatus = rawInput.outcome ?? "CLOSED";
  if (nextStatus !== "CLOSED" && nextStatus !== "CANCELLED") validation("outcome is invalid");
  const closedAt = serverNow(dependencies.now);

  return dependencies.unitOfWork.transaction(async tx => {
    const current = await tx.getServiceSessionForTransition(serviceSessionId);
    if (!current) notFound("ServiceSession not found");
    assertScope(context, current);
    if (current.status !== "OPEN") conflict("Only OPEN ServiceSession can be closed or cancelled");
    if (current.rowVersion !== version) conflict("ServiceSession row_version is stale");

    const updated = await tx.transitionServiceSession(Object.freeze({
      serviceSessionId,
      expectedRowVersion: version,
      nextStatus,
      closedAt,
      updatedAt: closedAt
    }));

    await tx.audit(audit(context, updated.id, Object.freeze({
      tableId: updated.tableId,
      previousStatus: current.status,
      status: updated.status,
      previousRowVersion: current.rowVersion,
      rowVersion: updated.rowVersion
    })));
    await tx.enqueueServiceSessionEvent(Object.freeze({
      aggregateType: "ServiceSession",
      aggregateId: updated.id,
      eventType: nextStatus === "CLOSED" ? "ServiceSessionClosed" : "ServiceSessionChanged",
      correlationId: context.correlationId,
      payload: Object.freeze({
        tenantId: context.tenantId,
        locationId: context.locationId,
        tableId: updated.tableId,
        previousStatus: current.status,
        status: updated.status,
        previousRowVersion: current.rowVersion,
        rowVersion: updated.rowVersion
      })
    }));
    return updated;
  }, context);
}
