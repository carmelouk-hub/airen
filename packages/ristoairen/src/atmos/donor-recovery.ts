export const ATMOS_DONOR_FORBIDDEN_FIELDS = Object.freeze([
  "id",
  "tenant_id",
  "location_id",
  "label",
  "notes",
  "brand_color",
  "brand_palette",
  "cta_dawn_primary",
  "cta_dawn_secondary",
  "cta_day_primary",
  "cta_day_secondary",
  "cta_golden_primary",
  "cta_golden_secondary",
  "cta_night_primary",
  "cta_night_secondary",
  "cta_event_primary",
  "cta_event_secondary",
  "route",
  "href",
  "domain",
  "hostname",
  "entitlement",
  "feature_flag",
  "plan",
]);

export type PortableAtmosRecoveryPattern = Readonly<{
  pureTimeSeasonEngine: true;
  locationTenantDefaultHierarchy: true;
  sanitizedEventPresentationTrigger: true;
  sideEffectFreePreview: true;
  consumerOnlyPresentationState: true;
  donorConfigurationMigrated: false;
  donorBrandingMigrated: false;
}>;

export const REC008_ATMOS_RECOVERY_EVIDENCE = Object.freeze({
  donor: "ex-corte",
  donorMode: "RECOVERY_DONOR_ONLY",
  recoveredPatterns: Object.freeze([
    "pure-time-and-season-context-engine",
    "location-override-to-tenant-default-to-engine-default-resolution",
    "sanitized-event-window-presentation-trigger",
    "side-effect-free-planned-visit-preview",
    "consumer-only-presentation-state",
  ]),
  canonicalRefactors: Object.freeze([
    "typed-presentation-settings",
    "generic-engine-defaults",
    "airenos-security-context-for-config-write",
    "resource-scope-enforcement",
    "presentation-only-authority",
    "idempotency-and-row-version",
    "no-donor-brand-or-route-content",
  ]),
  acceptanceTests: Object.freeze(["GJ2-002", "GJ2-030"]),
  runtimeState: "RUNTIME_PENDING",
});

export function recoverPortableAtmosPattern(input: Readonly<Record<string, unknown>>): PortableAtmosRecoveryPattern {
  for (const field of ATMOS_DONOR_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw new Error(`REC008_FORBIDDEN_DONOR_DATA:${field}`);
    }
  }
  return Object.freeze({
    pureTimeSeasonEngine: true,
    locationTenantDefaultHierarchy: true,
    sanitizedEventPresentationTrigger: true,
    sideEffectFreePreview: true,
    consumerOnlyPresentationState: true,
    donorConfigurationMigrated: false,
    donorBrandingMigrated: false,
  });
}
