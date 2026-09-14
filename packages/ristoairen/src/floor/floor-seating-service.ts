import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const FLOOR_SEATING_OPERATE_PERMISSION = "floor.seating.operate";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const FLOOR_SEATING_ENTITLEMENT = "floor-seating.enabled";
export const SEATING_CHANGED_ACTION = "SEATING_CHANGED";

export type FloorEnvironmentClass = "PRODUCTION" | "DEMO" | "SANDBOX" | "TEST_TEMPORARY";
export type DiningTableOperationalStatus = "ACTIVE" | "OUT_OF_SERVICE";
export type ServiceSessionState = "OPEN" | "CLOSED" | "CANCELLED";

export type DiningTableRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  code: string;
  operationalStatus: DiningTableOperationalStatus;
  capacity: number;
  rowVersion: number;
  environmentClass: FloorEnvironmentClass;
  createdAt: string;
  updatedAt: string;
}>;

export type SeatingServiceSessionRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  tableId: string;
  status: ServiceSessionState;
  rowVersion: number;
  environmentClass: FloorEnvironmentClass;
  openedAt: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type SeatingChangedOutboxEvent = Readonly<{
  aggregateType: "ServiceSession";
  aggregateId: string;
  eventType: "SeatingChanged";
  correlationId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface FloorSeatingTransaction extends TransactionContext {
  getSessionForSeating(serviceSessionId: string): Promise<SeatingServiceSessionRecord | null>;
  getTableForSeating(tableId: string): Promise<DiningTableRecord | null>;
  moveOpenSessionToTable(input: Readonly<{
    serviceSessionId: string;
    expectedSessionRowVersion: number;
    fromTableId: string;
    expectedFromTableRowVersion: number;
    toTableId: string;
    expectedToTableRowVersion: number;
    updatedAt: string;
  }>): Promise<Readonly<{
    session: SeatingServiceSessionRecord;
    fromTable: DiningTableRecord;
    toTable: DiningTableRecord;
  }>>;
  enqueueSeatingEvent(event: SeatingChangedOutboxEvent): Promise<void>;
}

export type FloorSeatingDependencies = Readonly<{
  unitOfWork: UnitOfWork<FloorSeatingTransaction>;
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

function expectedVersion(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) validation(`${field} is invalid`);
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
  for (const entitlement of [RISTOAIREN_ENTITLEMENT, FLOOR_SEATING_ENTITLEMENT]) {
    if (!context.entitlements.includes(entitlement)) {
      throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${entitlement}`);
    }
  }
}

function authority(context: SecurityContext): void {
  requireEntitlements(context);
  requirePermission(context, FLOOR_SEATING_OPERATE_PERMISSION, {
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
    actionKey: SEATING_CHANGED_ACTION,
    resourceType: "ServiceSession",
    resourceId: serviceSessionId,
    correlationId: context.correlationId,
    outcome: "success",
    metadata
  });
}

function assertScope(
  context: SecurityContext,
  record: Readonly<{ tenantId: string; locationId: string }>,
  resourceName: string
): void {
  if (record.tenantId !== context.tenantId || record.locationId !== context.locationId) {
    notFound(`${resourceName} not found`);
  }
}

export async function moveServiceSessionToTable(
  context: SecurityContext,
  rawInput: Readonly<{
    serviceSessionId: string;
    expectedSessionRowVersion: number;
    toTableId: string;
    expectedFromTableRowVersion: number;
    expectedToTableRowVersion: number;
  }>,
  dependencies: FloorSeatingDependencies
): Promise<Readonly<{
  session: SeatingServiceSessionRecord;
  fromTable: DiningTableRecord;
  toTable: DiningTableRecord;
}>> {
  authority(context);
  const serviceSessionId = normalizeId(rawInput.serviceSessionId, "serviceSessionId");
  const toTableId = normalizeId(rawInput.toTableId, "toTableId");
  const expectedSessionRowVersion = expectedVersion(rawInput.expectedSessionRowVersion, "expectedSessionRowVersion");
  const expectedFromTableRowVersion = expectedVersion(rawInput.expectedFromTableRowVersion, "expectedFromTableRowVersion");
  const expectedToTableRowVersion = expectedVersion(rawInput.expectedToTableRowVersion, "expectedToTableRowVersion");
  const updatedAt = serverNow(dependencies.now);

  return dependencies.unitOfWork.transaction(async tx => {
    const currentSession = await tx.getSessionForSeating(serviceSessionId);
    if (!currentSession) notFound("ServiceSession not found");
    assertScope(context, currentSession, "ServiceSession");
    if (currentSession.status !== "OPEN") conflict("Only OPEN ServiceSession can change table");
    if (currentSession.rowVersion !== expectedSessionRowVersion) conflict("ServiceSession row_version is stale");
    if (currentSession.tableId === toTableId) conflict("ServiceSession is already assigned to the target table");

    const [fromTable, toTable] = await Promise.all([
      tx.getTableForSeating(currentSession.tableId),
      tx.getTableForSeating(toTableId)
    ]);
    if (!fromTable) notFound("Current DiningTable not found");
    if (!toTable) notFound("Target DiningTable not found");
    assertScope(context, fromTable, "Current DiningTable");
    assertScope(context, toTable, "Target DiningTable");
    if (fromTable.rowVersion !== expectedFromTableRowVersion) conflict("Current DiningTable row_version is stale");
    if (toTable.rowVersion !== expectedToTableRowVersion) conflict("Target DiningTable row_version is stale");
    if (toTable.operationalStatus !== "ACTIVE") conflict("Target DiningTable is not operational");

    const moved = await tx.moveOpenSessionToTable(Object.freeze({
      serviceSessionId,
      expectedSessionRowVersion,
      fromTableId: fromTable.id,
      expectedFromTableRowVersion,
      toTableId: toTable.id,
      expectedToTableRowVersion,
      updatedAt
    }));

    await tx.audit(audit(context, moved.session.id, Object.freeze({
      fromTableId: fromTable.id,
      toTableId: toTable.id,
      previousSessionRowVersion: currentSession.rowVersion,
      sessionRowVersion: moved.session.rowVersion,
      previousFromTableRowVersion: fromTable.rowVersion,
      fromTableRowVersion: moved.fromTable.rowVersion,
      previousToTableRowVersion: toTable.rowVersion,
      toTableRowVersion: moved.toTable.rowVersion
    })));
    await tx.enqueueSeatingEvent(Object.freeze({
      aggregateType: "ServiceSession",
      aggregateId: moved.session.id,
      eventType: "SeatingChanged",
      correlationId: context.correlationId,
      payload: Object.freeze({
        tenantId: context.tenantId,
        locationId: context.locationId,
        fromTableId: fromTable.id,
        toTableId: toTable.id,
        previousRowVersion: currentSession.rowVersion,
        rowVersion: moved.session.rowVersion
      })
    }));
    return moved;
  }, context);
}
