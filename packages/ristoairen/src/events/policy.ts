import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { AttributionTouchInputV1, EventCreateInputV1, EventUpdateInputV1, PromoterAssignmentInputV1 } from "./contracts.ts";

export function requireEventsWrite(context: SecurityContext): void {
  if (!context.tenantId || !context.actorIdentityId) throw new AppError("FORBIDDEN", "MISSING_SECURITY_SCOPE");
}

export function validateEventCreate(input: EventCreateInputV1): EventCreateInputV1 {
  if (!input.title?.trim() || !input.startsAt?.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_EVENT_CREATE");
  if (input.endsAt && input.endsAt <= input.startsAt) throw new AppError("VALIDATION_FAILED", "INVALID_EVENT_WINDOW");
  return Object.freeze({ ...input, title: input.title.trim(), startsAt: input.startsAt.trim(), endsAt: input.endsAt?.trim() || undefined });
}

export function validateEventUpdate(input: EventUpdateInputV1): EventUpdateInputV1 {
  if (!input.eventId) throw new AppError("VALIDATION_FAILED", "MISSING_EVENT_ID");
  if (!Number.isInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_EVENT_ROW_VERSION");
  if (input.title !== undefined && !input.title.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_EVENT_TITLE");
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw new AppError("VALIDATION_FAILED", "INVALID_EVENT_WINDOW");
  return Object.freeze({ ...input, title: input.title?.trim(), startsAt: input.startsAt?.trim(), endsAt: input.endsAt?.trim() });
}

export function validatePromoterAssignment(input: PromoterAssignmentInputV1): PromoterAssignmentInputV1 {
  if (!input.eventId || !input.promoterId || !input.attributionCode?.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_PROMOTER_ASSIGNMENT");
  if (!Number.isInteger(input.expectedEventRowVersion) || input.expectedEventRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_EVENT_ROW_VERSION");
  return Object.freeze({ ...input, attributionCode: input.attributionCode.trim().toUpperCase() });
}

export function validateAttributionTouch(input: AttributionTouchInputV1): AttributionTouchInputV1 {
  if (!input.eventId || !input.sourceReference?.trim() || !input.occurredAt?.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_ATTRIBUTION_TOUCH");
  return Object.freeze({ ...input, sourceReference: input.sourceReference.trim(), occurredAt: input.occurredAt.trim() });
}
