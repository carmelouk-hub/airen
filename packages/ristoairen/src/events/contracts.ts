import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";

export const EVENT_STATUSES = ["DRAFT", "PUBLISHED", "CANCELLED", "ARCHIVED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const ATTRIBUTION_CHANNELS = ["QR", "LINK", "MANUAL", "PARTNER"] as const;
export type AttributionChannel = (typeof ATTRIBUTION_CHANNELS)[number];

export type EventProjectionV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId?: UUID;
  title: string;
  startsAt: string;
  endsAt?: string;
  status: EventStatus;
  rowVersion: number;
}>;

export type EventCreateInputV1 = Readonly<{
  title: string;
  startsAt: string;
  endsAt?: string;
  locationId?: UUID;
}>;

export type EventUpdateInputV1 = Readonly<{
  eventId: UUID;
  title?: string;
  startsAt?: string;
  endsAt?: string;
  status?: EventStatus;
  expectedRowVersion: number;
}>;

export type PromoterAssignmentInputV1 = Readonly<{
  eventId: UUID;
  promoterId: UUID;
  attributionCode: string;
  expectedEventRowVersion: number;
}>;

export type AttributionTouchInputV1 = Readonly<{
  eventId: UUID;
  promoterId?: UUID;
  channel: AttributionChannel;
  sourceReference: string;
  occurredAt: string;
}>;

export type EventAttributionSummaryV1 = Readonly<{
  eventId: UUID;
  promoterId?: UUID;
  channel: AttributionChannel;
  bookingCount: number;
  orderCount: number;
  grossValueMinor: number;
  currency: string;
}>;

export interface EventsProductAccessGuard {
  assertRistoAirenAccess(context: SecurityContext): void | Promise<void>;
}

export interface EventsApplicationRepository {
  createEvent(context: SecurityContext, input: EventCreateInputV1, idempotencyKey: string): Promise<{ eventId: UUID; replayed: boolean }>;
  updateEvent(context: SecurityContext, input: EventUpdateInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
  assignPromoter(context: SecurityContext, input: PromoterAssignmentInputV1, idempotencyKey: string): Promise<{ assignmentId: UUID; replayed: boolean }>;
  recordAttributionTouch(context: SecurityContext, input: AttributionTouchInputV1, idempotencyKey: string): Promise<{ attributionId: UUID; replayed: boolean }>;
  getAttributionSummary(context: SecurityContext, eventId: UUID): Promise<readonly EventAttributionSummaryV1[]>;
}
