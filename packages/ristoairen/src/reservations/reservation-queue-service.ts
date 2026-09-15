import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const RESERVATION_MANAGE_PERMISSION = "reservation.manage";
export const QUEUE_MANAGE_PERMISSION = "queue.manage";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const RESERVATIONS_ENTITLEMENT = "reservations.enabled";

export const RESERVATION_CHANGED_ACTION = "RESERVATION_CHANGED";
export const QUEUE_CHANGED_ACTION = "QUEUE_CHANGED";

// Historical compatibility vocabulary only. AIRen Booking is the sole mutable Booking authority.
// Do not translate these legacy statuses into AIRen Booking statuses.
export type ReservationStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "SEATED"
  | "CANCELLED"
  | "NO_SHOW"
  | "COMPLETED";

export type GuestQueueStatus = "WAITING" | "CALLED" | "SEATED" | "EXPIRED" | "CANCELLED";
export type GuestServiceEnvironmentClass = "PRODUCTION" | "DEMO" | "SANDBOX" | "TEST_TEMPORARY";

// Historical compatibility shape. No active RISTOAIREN runtime may persist this record.
export type BookingRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  requestKey: string;
  status: ReservationStatus;
  partySize: number;
  rowVersion: number;
  environmentClass: GuestServiceEnvironmentClass;
  createdAt: string;
  updatedAt: string;
}>;

export type GuestQueueEntryRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  requestKey: string;
  bookingId?: string;
  status: GuestQueueStatus;
  partySize: number;
  rowVersion: number;
  environmentClass: GuestServiceEnvironmentClass;
  createdAt: string;
  updatedAt: string;
}>;

export type ReservationQueueOutboxEvent = Readonly<{
  aggregateType: "Booking" | "GuestQueueEntry";
  aggregateId: string;
  eventType: "ReservationChanged" | "QueueChanged";
  correlationId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface ReservationQueueTransaction extends TransactionContext {
  getQueueEntryForTransition(queueEntryId: string): Promise<GuestQueueEntryRecord | null>;
  transitionQueueEntry(input: Readonly<{
    queueEntryId: string;
    expectedRowVersion: number;
    nextStatus: GuestQueueStatus;
    updatedAt: string;
  }>): Promise<GuestQueueEntryRecord>;
  enqueueReservationQueueEvent(event: ReservationQueueOutboxEvent): Promise<void>;
}

export type ReservationQueueDependencies = Readonly<{
  unitOfWork: UnitOfWork<ReservationQueueTransaction>;
  now?: () => string;
}>;

const QUEUE_TRANSITIONS: Readonly<Record<GuestQueueStatus, readonly GuestQueueStatus[]>> = Object.freeze({
  WAITING: Object.freeze(["CALLED", "SEATED", "EXPIRED", "CANCELLED"]),
  CALLED: Object.freeze(["SEATED", "WAITING", "EXPIRED", "CANCELLED"]),
  SEATED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
  CANCELLED: Object.freeze([])
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
  for (const entitlement of [RISTOAIREN_ENTITLEMENT, RESERVATIONS_ENTITLEMENT]) {
    if (!context.entitlements.includes(entitlement)) {
      throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${entitlement}`);
    }
  }
}

function authority(context: SecurityContext, permission: string): void {
  requireEntitlements(context);
  requirePermission(context, permission, { tenantId: context.tenantId, locationId: context.locationId });
}

function audit(
  context: SecurityContext,
  actionKey: string,
  resourceType: "Booking" | "GuestQueueEntry",
  resourceId: string,
  metadata: Readonly<Record<string, unknown>>
): AuditRecord {
  return Object.freeze({
    actorIdentityId: context.actorIdentityId,
    tenantId: context.tenantId,
    locationId: context.locationId,
    actionKey,
    resourceType,
    resourceId,
    correlationId: context.correlationId,
    outcome: "success",
    metadata
  });
}

function assertSameScope(
  context: SecurityContext,
  record: Readonly<{ tenantId: string; locationId: string }>,
  resourceName: string
): void {
  if (record.tenantId !== context.tenantId || record.locationId !== context.locationId) {
    notFound(`${resourceName} not found`);
  }
}

function assertQueueTransition(current: GuestQueueStatus, next: GuestQueueStatus): void {
  if (!QUEUE_TRANSITIONS[current].includes(next)) {
    conflict(`GuestQueueEntry transition ${current} -> ${next} is not allowed`);
  }
}

/**
 * Historical compatibility export only.
 *
 * MAT-041 Phase B retires the legacy Reservation adapter rather than mapping its
 * requestKey/status semantics onto AIRen Booking. The failure occurs before any
 * authorization-derived persistence access or UnitOfWork transaction can open.
 */
export async function transitionReservation(
  context: SecurityContext,
  rawInput: Readonly<{
    bookingId: string;
    expectedRowVersion: number;
    nextStatus: ReservationStatus;
  }>,
  dependencies: ReservationQueueDependencies
): Promise<BookingRecord> {
  void context;
  void rawInput;
  void dependencies;
  throw new AppError(
    "RUNTIME_CONFIGURATION_INVALID",
    "Legacy RISTOAIREN Reservation adapter is retired; use the canonical AIRen Booking authority"
  );
}

export async function transitionGuestQueueEntry(
  context: SecurityContext,
  rawInput: Readonly<{
    queueEntryId: string;
    expectedRowVersion: number;
    nextStatus: GuestQueueStatus;
  }>,
  dependencies: ReservationQueueDependencies
): Promise<GuestQueueEntryRecord> {
  authority(context, QUEUE_MANAGE_PERMISSION);
  const queueEntryId = normalizeId(rawInput.queueEntryId, "queueEntryId");
  const version = expectedVersion(rawInput.expectedRowVersion);
  const updatedAt = serverNow(dependencies.now);

  return dependencies.unitOfWork.transaction(async tx => {
    const current = await tx.getQueueEntryForTransition(queueEntryId);
    if (!current) notFound("GuestQueueEntry not found");
    assertSameScope(context, current, "GuestQueueEntry");
    if (current.rowVersion !== version) conflict("GuestQueueEntry row_version is stale");
    assertQueueTransition(current.status, rawInput.nextStatus);

    const updated = await tx.transitionQueueEntry(Object.freeze({
      queueEntryId,
      expectedRowVersion: version,
      nextStatus: rawInput.nextStatus,
      updatedAt
    }));

    await tx.audit(audit(context, QUEUE_CHANGED_ACTION, "GuestQueueEntry", updated.id, Object.freeze({
      previousStatus: current.status,
      status: updated.status,
      previousRowVersion: current.rowVersion,
      rowVersion: updated.rowVersion
    })));
    await tx.enqueueReservationQueueEvent(Object.freeze({
      aggregateType: "GuestQueueEntry",
      aggregateId: updated.id,
      eventType: "QueueChanged",
      correlationId: context.correlationId,
      payload: Object.freeze({
        tenantId: context.tenantId,
        locationId: context.locationId,
        previousStatus: current.status,
        status: updated.status,
        previousRowVersion: current.rowVersion,
        rowVersion: updated.rowVersion
      })
    }));
    return updated;
  }, context);
}
