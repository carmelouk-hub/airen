export const EVENTS_DONOR_FORBIDDEN_FIELDS = Object.freeze([
  "id", "tenant_id", "location_id", "created_by_id",
  "event_id", "event_title", "poster_design_id", "google_calendar_event_id",
  "promoter_id", "promoter_code", "deep_link", "code", "phone", "email", "name",
  "commission_per_booking", "commission_percent", "whatsapp_phone",
] as const);

export type PortableEventsRecoveryPattern = Readonly<{
  eventLifecycle: true;
  promoterAssignment: true;
  qrAttributionConcept: true;
  attributionReporting: true;
  canonicalAttributionFactRequired: true;
  donorCampaignsMigrated: false;
  donorPromotersMigrated: false;
}>;

export const REC005_EVENTS_RECOVERY_EVIDENCE = Object.freeze({
  donor: "ex-corte",
  donorMode: "RECOVERY_DONOR_ONLY",
  recoveredPatterns: Object.freeze([
    "event-lifecycle",
    "promoter-assignment",
    "qr-and-link-attribution-concept",
    "event-promoter-reporting",
  ]),
  rejectedAuthority: EVENTS_DONOR_FORBIDDEN_FIELDS,
  canonicalRefactors: Object.freeze([
    "canonical-event-contract",
    "tenant-location-policy",
    "promoter-assignment-as-relation",
    "append-oriented-attribution-touch",
    "reporting-as-projection",
    "airenos-security-context",
    "server-side-mutations",
    "idempotency-and-row-version",
  ]),
  acceptanceTests: Object.freeze(["GJ2-008", "GJ2-009", "GJ2-035"]),
  runtimeState: "RUNTIME_PENDING",
});

export function recoverPortableEventsPattern(input: Record<string, unknown>): PortableEventsRecoveryPattern {
  for (const field of EVENTS_DONOR_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) throw new Error(`REC005_FORBIDDEN_DONOR_DATA:${field}`);
  }
  return Object.freeze({
    eventLifecycle: true,
    promoterAssignment: true,
    qrAttributionConcept: true,
    attributionReporting: true,
    canonicalAttributionFactRequired: true,
    donorCampaignsMigrated: false,
    donorPromotersMigrated: false,
  });
}
