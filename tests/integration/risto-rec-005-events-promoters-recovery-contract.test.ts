import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENTS_DONOR_FORBIDDEN_FIELDS,
  REC005_EVENTS_RECOVERY_EVIDENCE,
  recoverPortableEventsPattern,
  validateAttributionTouch,
  validateEventCreate,
  validateEventUpdate,
  validatePromoterAssignment,
} from "../../packages/ristoairen/src/events/index.ts";

test("REC-005 recovers event/promoter workflows without donor campaigns", () => {
  const recovered = recoverPortableEventsPattern({ supports_events: true, supports_promoter_qr: true });
  assert.equal(recovered.eventLifecycle, true);
  assert.equal(recovered.promoterAssignment, true);
  assert.equal(recovered.canonicalAttributionFactRequired, true);
  assert.equal(recovered.donorCampaignsMigrated, false);
  assert.equal(recovered.donorPromotersMigrated, false);
});

test("REC-005 rejects donor campaign, promoter, tenant and PII authority", () => {
  for (const field of EVENTS_DONOR_FORBIDDEN_FIELDS) {
    assert.throws(() => recoverPortableEventsPattern({ [field]: "legacy-value" }), new RegExp(`REC005_FORBIDDEN_DONOR_DATA:${field}`));
  }
});

test("REC-005 validates canonical event lifecycle with row-version concurrency", () => {
  const created = validateEventCreate({ title: "Autumn Session", startsAt: "2026-10-01T19:00:00+02:00", endsAt: "2026-10-01T23:00:00+02:00" });
  assert.equal(created.title, "Autumn Session");
  const updated = validateEventUpdate({ eventId: "event-1", status: "PUBLISHED", expectedRowVersion: 3 });
  assert.equal(updated.status, "PUBLISHED");
  assert.throws(() => validateEventUpdate({ eventId: "event-1", status: "ARCHIVED", expectedRowVersion: -1 }));
});

test("REC-005 normalizes promoter assignment without treating donor QR as authority", () => {
  const assignment = validatePromoterAssignment({ eventId: "event-1", promoterId: "promoter-1", attributionCode: " ab12 ", expectedEventRowVersion: 2 });
  assert.equal(assignment.attributionCode, "AB12");
  assert.throws(() => validatePromoterAssignment({ eventId: "event-1", promoterId: "promoter-1", attributionCode: "", expectedEventRowVersion: 2 }));
});

test("REC-005 attribution is an append-oriented source fact", () => {
  const touch = validateAttributionTouch({ eventId: "event-1", promoterId: "promoter-1", channel: "QR", sourceReference: "booking-123", occurredAt: "2026-10-01T20:00:00+02:00" });
  assert.equal(touch.channel, "QR");
  assert.equal(touch.sourceReference, "booking-123");
  assert.throws(() => validateAttributionTouch({ eventId: "event-1", channel: "LINK", sourceReference: "", occurredAt: "2026-10-01T20:00:00+02:00" }));
});

test("REC-005 acceptance obligations remain runtime-pending", () => {
  assert.deepEqual(REC005_EVENTS_RECOVERY_EVIDENCE.acceptanceTests, ["GJ2-008", "GJ2-009", "GJ2-035"]);
  assert.equal(REC005_EVENTS_RECOVERY_EVIDENCE.runtimeState, "RUNTIME_PENDING");
});
