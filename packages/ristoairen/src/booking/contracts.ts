import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";

export const BOOKING_STATUSES = ["REQUESTED", "PENDING", "CONFIRMED", "ARRIVED", "SEATED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingPrivateProjectionV1 = Readonly<{
  id: UUID;
  status: BookingStatus;
  partySize: number;
  bookingDate: string;
  bookingTimeLocal: string;
  startsAt: string;
  expectedDurationMinutes: number;
  source: string;
  customerNameSnapshot: string;
  phoneSnapshot?: string;
  emailSnapshot?: string;
  notes?: string;
  specialRequests?: string;
  zoneId?: UUID;
  tableId?: UUID;
  eventId?: UUID;
  arrivalAt?: string;
  seatedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  noShowAt?: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}>;

export type BookingQueryInputV1 = Readonly<{
  statuses?: readonly BookingStatus[];
  fromDate?: string;
  toDate?: string;
  cursor?: string;
  limit?: number;
  order?: "starts_at.asc" | "starts_at.desc";
}>;

export type BookingCreateInputV1 = Readonly<{
  customerProfileId?: UUID;
  eventId?: UUID;
  zoneId?: UUID;
  tableId?: UUID;
  source: string;
  externalReference?: string;
  partySize: number;
  bookingDate: string;
  bookingTimeLocal: string;
  expectedDurationMinutes: number;
  customerNameSnapshot: string;
  phoneSnapshot?: string;
  emailSnapshot?: string;
  notes?: string;
  specialRequests?: string;
}>;

export type BookingUpdateInputV1 = Readonly<{
  customerProfileId?: UUID | null;
  eventId?: UUID | null;
  zoneId?: UUID | null;
  tableId?: UUID | null;
  partySize?: number;
  bookingDate?: string;
  bookingTimeLocal?: string;
  expectedDurationMinutes?: number;
  customerNameSnapshot?: string;
  phoneSnapshot?: string | null;
  emailSnapshot?: string | null;
  notes?: string | null;
  specialRequests?: string | null;
  rowVersion: number;
}>;

export type BookingStatusTransitionInputV1 = Readonly<{
  requestedStatus: BookingStatus;
  rowVersion: number;
  reason?: string;
}>;

export type BookingMutationResultV1 = Readonly<{ booking: BookingPrivateProjectionV1; replayed: boolean }>;
export type BookingPrivateListResultV1 = Readonly<{ items: readonly BookingPrivateProjectionV1[]; nextCursor?: string }>;

export type BookingAuditEvent = Readonly<{
  eventType: "BOOKING_CREATED" | "BOOKING_UPDATED" | "BOOKING_STATUS_CHANGED";
  bookingId: UUID;
  actorIdentityId: UUID;
  tenantId: UUID;
  locationId: UUID;
  correlationId: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type BookingOutboxEvent = Readonly<{
  eventType: "booking.created.v1" | "booking.updated.v1" | "booking.status_changed.v1";
  bookingId: UUID;
  tenantId: UUID;
  locationId: UUID;
  correlationId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface RistoProductAccessGuard {
  assertRistoAirenAccess(context: SecurityContext): void | Promise<void>;
}

export interface BookingReadRepository {
  query(context: SecurityContext, input: BookingQueryInputV1): Promise<BookingPrivateListResultV1>;
  findVisibleById(context: SecurityContext, bookingId: UUID): Promise<BookingPrivateProjectionV1 | null>;
}

export type IdempotencyScope = Readonly<{
  actorIdentityId: UUID;
  tenantId: UUID;
  locationId: UUID;
  canonicalFunctionId: "RST-F-BKG-001" | "RST-F-BKG-002" | "RST-F-BKG-003";
  idempotencyKey: string;
  semanticHash: string;
}>;

export type IdempotencyClaim =
  | Readonly<{ kind: "NEW" }>
  | Readonly<{ kind: "REPLAY"; result: BookingMutationResultV1 }>;

export interface BookingMutationTransaction {
  findVisibleById(bookingId: UUID): Promise<BookingPrivateProjectionV1 | null>;
  claimIdempotency(scope: IdempotencyScope): Promise<IdempotencyClaim>;
  completeIdempotency(scope: IdempotencyScope, result: BookingMutationResultV1): Promise<void>;
  insertBooking(input: BookingCreateInputV1, context: SecurityContext): Promise<BookingPrivateProjectionV1>;
  updateBooking(bookingId: UUID, input: BookingUpdateInputV1, context: SecurityContext): Promise<BookingPrivateProjectionV1>;
  transitionBookingStatus(bookingId: UUID, fromStatus: BookingStatus, input: BookingStatusTransitionInputV1, context: SecurityContext): Promise<BookingPrivateProjectionV1>;
  appendAudit(event: BookingAuditEvent): Promise<void>;
  appendOutbox(event: BookingOutboxEvent): Promise<void>;
}

export interface BookingUnitOfWork {
  transaction<T>(context: SecurityContext, fn: (tx: BookingMutationTransaction) => Promise<T>): Promise<T>;
}
