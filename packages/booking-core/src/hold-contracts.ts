import type { SecurityContext, UUID } from "../../shared-contracts/src/index.ts";
import type { BookingPrivateProjectionV1 } from "./contracts.ts";

export const BOOKING_HOLD_FUNCTION_IDS = Object.freeze({
  create: "AIREN-F-BKG-HOLD-001",
  cancel: "AIREN-F-BKG-HOLD-002",
  convert: "AIREN-F-BKG-HOLD-003",
  guaranteeBegin: "AIREN-F-BKG-HOLD-004",
  guaranteeResolve: "AIREN-F-BKG-HOLD-005"
} as const);
export type BookingHoldFunctionId = (typeof BOOKING_HOLD_FUNCTION_IDS)[keyof typeof BOOKING_HOLD_FUNCTION_IDS];

export const BOOKING_HOLD_STATUSES = [
  "CREATED",
  "GUARANTEE_REQUIRED",
  "GUARANTEE_PENDING",
  "GUARANTEED",
  "CONVERTED",
  "EXPIRED",
  "CANCELLED",
  "FAILED"
] as const;
export type BookingHoldStatus = (typeof BOOKING_HOLD_STATUSES)[number];

export const BOOKING_GUARANTEE_MODES = [
  "NONE",
  "PAYMENT_METHOD_GUARANTEE",
  "DEPOSIT",
  "FULL_PREPAYMENT",
  "AUTHORIZATION_HOLD"
] as const;
export type BookingGuaranteeMode = (typeof BOOKING_GUARANTEE_MODES)[number];

export type BookingGuaranteePolicyProjectionV1 = Readonly<{
  id: UUID;
  status: "active" | "disabled";
  guaranteeMode: BookingGuaranteeMode;
  holdDurationSeconds: number;
  priority: number;
  sourceChannel?: string;
  resourceKey?: string;
  minPartySize?: number;
  maxPartySize?: number;
  effectiveFrom?: string;
  effectiveUntil?: string;
}>;

export type BookingHoldPrivateProjectionV1 = Readonly<{
  id: UUID;
  status: BookingHoldStatus;
  sourceChannel: string;
  sourceExternalReference?: string;
  resourceKey: string;
  partySize: number;
  capacityClaim: number;
  bookingDate: string;
  bookingTimeLocal: string;
  startsAt: string;
  expectedDurationMinutes: number;
  expiresAt: string;
  guaranteePolicyId: UUID;
  guaranteeMode: BookingGuaranteeMode;
  guaranteeRef?: string;
  conversionBookingId?: UUID;
  customerNameSnapshot: string;
  phoneSnapshot?: string;
  emailSnapshot?: string;
  notes?: string;
  specialRequests?: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}>;

export type BookingHoldCreateInputV1 = Readonly<{
  sourceChannel: string;
  sourceExternalReference?: string;
  resourceKey: string;
  partySize: number;
  capacityClaim?: number;
  bookingDate: string;
  bookingTimeLocal: string;
  expectedDurationMinutes: number;
  customerNameSnapshot: string;
  phoneSnapshot?: string;
  emailSnapshot?: string;
  notes?: string;
  specialRequests?: string;
}>;

export type BookingHoldCancelInputV1 = Readonly<{
  rowVersion: number;
  reason?: string;
}>;

export type BookingHoldGuaranteeBeginInputV1 = Readonly<{
  rowVersion: number;
  guaranteeReference: string;
}>;

export const BOOKING_HOLD_GUARANTEE_OUTCOMES = ["SATISFIED", "FAILED"] as const;
export type BookingHoldGuaranteeOutcome = (typeof BOOKING_HOLD_GUARANTEE_OUTCOMES)[number];

export type BookingHoldGuaranteeResolutionInputV1 = Readonly<{
  rowVersion: number;
  guaranteeReference: string;
  outcome: BookingHoldGuaranteeOutcome;
  failureReason?: string;
}>;

export type BookingHoldConvertInputV1 = Readonly<{
  rowVersion: number;
}>;

export type BookingHoldMutationResultV1 = Readonly<{
  hold: BookingHoldPrivateProjectionV1;
  replayed: boolean;
}>;

export type BookingHoldConversionResultV1 = Readonly<{
  hold: BookingHoldPrivateProjectionV1;
  booking: BookingPrivateProjectionV1;
  replayed: boolean;
}>;

export type BookingHoldIdempotencyScope = Readonly<{
  actorIdentityId: UUID;
  tenantId: UUID;
  locationId: UUID;
  canonicalFunctionId: BookingHoldFunctionId;
  idempotencyKey: string;
  semanticHash: string;
}>;

export type BookingHoldIdempotencyResultV1 = BookingHoldMutationResultV1 | BookingHoldConversionResultV1;

export type BookingHoldIdempotencyClaim =
  | Readonly<{ kind: "NEW" }>
  | Readonly<{ kind: "REPLAY"; result: BookingHoldIdempotencyResultV1 }>;

export type BookingHoldAuditEvent = Readonly<{
  eventType:
    | "BOOKING_HOLD_CREATED"
    | "BOOKING_HOLD_CANCELLED"
    | "BOOKING_HOLD_EXPIRED"
    | "BOOKING_HOLD_CONVERTED"
    | "BOOKING_HOLD_GUARANTEE_PENDING"
    | "BOOKING_HOLD_GUARANTEED"
    | "BOOKING_HOLD_GUARANTEE_FAILED";
  holdId: UUID;
  actorIdentityId: UUID;
  tenantId: UUID;
  locationId: UUID;
  correlationId: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type BookingHoldOutboxEvent = Readonly<{
  eventType:
    | "booking.hold.created.v1"
    | "booking.hold.cancelled.v1"
    | "booking.hold.expired.v1"
    | "booking.hold.converted.v1"
    | "booking.hold.guarantee_pending.v1"
    | "booking.hold.guaranteed.v1"
    | "booking.hold.guarantee_failed.v1";
  holdId: UUID;
  tenantId: UUID;
  locationId: UUID;
  correlationId: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface BookingHoldMutationTransaction {
  findVisibleHoldById(holdId: UUID): Promise<BookingHoldPrivateProjectionV1 | null>;
  listGuaranteePolicies(input: BookingHoldCreateInputV1, context: SecurityContext): Promise<readonly BookingGuaranteePolicyProjectionV1[]>;
  claimHoldIdempotency(scope: BookingHoldIdempotencyScope): Promise<BookingHoldIdempotencyClaim>;
  completeHoldIdempotency(scope: BookingHoldIdempotencyScope, result: BookingHoldIdempotencyResultV1): Promise<void>;
  insertHold(input: BookingHoldCreateInputV1, policy: BookingGuaranteePolicyProjectionV1, context: SecurityContext): Promise<BookingHoldPrivateProjectionV1>;
  transitionHoldStatus(
    holdId: UUID,
    fromStatus: BookingHoldStatus,
    toStatus: BookingHoldStatus,
    rowVersion: number,
    reason: string | undefined,
    context: SecurityContext
  ): Promise<BookingHoldPrivateProjectionV1>;
  appendHoldAudit(event: BookingHoldAuditEvent): Promise<void>;
  appendHoldOutbox(event: BookingHoldOutboxEvent): Promise<void>;
}

export interface BookingHoldUnitOfWork {
  transaction<T>(context: SecurityContext, fn: (tx: BookingHoldMutationTransaction) => Promise<T>): Promise<T>;
}
