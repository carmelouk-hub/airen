import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const ORDER_MANAGE_PERMISSION = "order.manage";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const ORDERING_ENTITLEMENT = "ordering.enabled";
export const ORDER_CHANGED_ACTION = "ORDER_CHANGED";

export type OrderStatus = "DRAFT" | "SUBMITTED" | "AMENDED" | "CANCELLED" | "COMPLETED";
export type OrderChannel = "FOH" | "POS" | "QR" | "SELF" | "FAST";
export type OrderEnvironmentClass = "PRODUCTION" | "DEMO" | "SANDBOX" | "TEST_TEMPORARY";

export type OrderRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  serviceSessionId: string;
  requestKey: string;
  channel: OrderChannel;
  status: OrderStatus;
  rowVersion: number;
  environmentClass: OrderEnvironmentClass;
  createdAt: string;
  submittedAt?: string;
  updatedAt: string;
}>;

export type OrderOutboxEvent = Readonly<{
  aggregateType: "Order";
  aggregateId: string;
  eventType: "OrderChanged";
  correlationId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface OrderIntakeTransaction extends TransactionContext {
  getOrderForTransition(orderId: string): Promise<OrderRecord | null>;
  transitionOrder(input: Readonly<{
    orderId: string;
    expectedRowVersion: number;
    nextStatus: "AMENDED" | "CANCELLED" | "COMPLETED";
    updatedAt: string;
  }>): Promise<OrderRecord>;
  enqueueOrderEvent(event: OrderOutboxEvent): Promise<void>;
}

export type OrderIntakeDependencies = Readonly<{
  unitOfWork: UnitOfWork<OrderIntakeTransaction>;
  now?: () => string;
}>;

const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = Object.freeze({
  DRAFT: Object.freeze([]),
  SUBMITTED: Object.freeze(["AMENDED", "CANCELLED", "COMPLETED"]),
  AMENDED: Object.freeze(["AMENDED", "CANCELLED", "COMPLETED"]),
  CANCELLED: Object.freeze([]),
  COMPLETED: Object.freeze([])
});

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
  for (const entitlement of [RISTOAIREN_ENTITLEMENT, ORDERING_ENTITLEMENT]) {
    if (!context.entitlements.includes(entitlement)) {
      throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${entitlement}`);
    }
  }
}

function authority(context: SecurityContext): void {
  requireEntitlements(context);
  requirePermission(context, ORDER_MANAGE_PERMISSION, {
    tenantId: context.tenantId,
    locationId: context.locationId
  });
}

function audit(
  context: SecurityContext,
  orderId: string,
  metadata: Readonly<Record<string, unknown>>
): AuditRecord {
  return Object.freeze({
    actorIdentityId: context.actorIdentityId,
    tenantId: context.tenantId,
    locationId: context.locationId,
    actionKey: ORDER_CHANGED_ACTION,
    resourceType: "Order",
    resourceId: orderId,
    correlationId: context.correlationId,
    outcome: "success",
    metadata
  });
}

function assertScope(context: SecurityContext, order: OrderRecord): void {
  if (order.tenantId !== context.tenantId || order.locationId !== context.locationId) {
    notFound("Order not found");
  }
}

export async function amendOrder(
  context: SecurityContext,
  rawInput: Readonly<{
    orderId: string;
    expectedRowVersion: number;
    nextStatus?: "AMENDED" | "CANCELLED" | "COMPLETED";
  }>,
  dependencies: OrderIntakeDependencies
): Promise<OrderRecord> {
  authority(context);
  const orderId = normalizeId(rawInput.orderId, "orderId");
  const version = expectedVersion(rawInput.expectedRowVersion);
  const nextStatus = rawInput.nextStatus ?? "AMENDED";
  if (!["AMENDED", "CANCELLED", "COMPLETED"].includes(nextStatus)) validation("nextStatus is invalid");
  const updatedAt = serverNow(dependencies.now);

  return dependencies.unitOfWork.transaction(async tx => {
    const current = await tx.getOrderForTransition(orderId);
    if (!current) notFound("Order not found");
    assertScope(context, current);
    if (current.rowVersion !== version) conflict("Order row_version is stale");
    if (!ORDER_TRANSITIONS[current.status].includes(nextStatus)) {
      conflict(`Order transition ${current.status} -> ${nextStatus} is not allowed`);
    }

    const updated = await tx.transitionOrder(Object.freeze({
      orderId,
      expectedRowVersion: version,
      nextStatus,
      updatedAt
    }));

    await tx.audit(audit(context, updated.id, Object.freeze({
      serviceSessionId: updated.serviceSessionId,
      previousStatus: current.status,
      status: updated.status,
      previousRowVersion: current.rowVersion,
      rowVersion: updated.rowVersion
    })));
    await tx.enqueueOrderEvent(Object.freeze({
      aggregateType: "Order",
      aggregateId: updated.id,
      eventType: "OrderChanged",
      correlationId: context.correlationId,
      payload: Object.freeze({
        tenantId: context.tenantId,
        locationId: context.locationId,
        serviceSessionId: updated.serviceSessionId,
        previousStatus: current.status,
        status: updated.status,
        previousRowVersion: current.rowVersion,
        rowVersion: updated.rowVersion
      })
    }));
    return updated;
  }, context);
}
