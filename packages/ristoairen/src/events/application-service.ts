import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";
import type { AttributionTouchInputV1, EventCreateInputV1, EventUpdateInputV1, EventsApplicationRepository, EventsProductAccessGuard, PromoterAssignmentInputV1 } from "./contracts.ts";
import { requireEventsWrite, validateAttributionTouch, validateEventCreate, validateEventUpdate, validatePromoterAssignment } from "./policy.ts";

function requireIdempotencyKey(value: string): string {
  const key = value?.trim();
  if (!key) throw new Error("MISSING_IDEMPOTENCY_KEY");
  return key;
}

export class EventsApplicationService {
  constructor(private readonly repo: EventsApplicationRepository, private readonly access: EventsProductAccessGuard) {}

  async createEvent(context: SecurityContext, input: EventCreateInputV1, idempotencyKey: string) {
    requireEventsWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.createEvent(context, validateEventCreate(input), requireIdempotencyKey(idempotencyKey));
  }

  async updateEvent(context: SecurityContext, input: EventUpdateInputV1, idempotencyKey: string) {
    requireEventsWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.updateEvent(context, validateEventUpdate(input), requireIdempotencyKey(idempotencyKey));
  }

  async assignPromoter(context: SecurityContext, input: PromoterAssignmentInputV1, idempotencyKey: string) {
    requireEventsWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.assignPromoter(context, validatePromoterAssignment(input), requireIdempotencyKey(idempotencyKey));
  }

  async recordAttribution(context: SecurityContext, input: AttributionTouchInputV1, idempotencyKey: string) {
    requireEventsWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.recordAttributionTouch(context, validateAttributionTouch(input), requireIdempotencyKey(idempotencyKey));
  }

  async attributionSummary(context: SecurityContext, eventId: UUID) {
    await this.access.assertRistoAirenAccess(context);
    if (!context.tenantId || !eventId) throw new Error("MISSING_EVENT_SCOPE");
    return this.repo.getAttributionSummary(context, eventId);
  }
}
