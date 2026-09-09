import test from "node:test";
import assert from "node:assert/strict";
import {
  ATMOS_AUTHORITY_RULES,
  ATMOS_DONOR_FORBIDDEN_FIELDS,
  DEFAULT_ATMOS_PRESENTATION_CONFIG,
  REC008_ATMOS_RECOVERY_EVIDENCE,
  previewAtmosState,
  recoverPortableAtmosPattern,
  resolveAtmosState,
  validateAtmosPresentationConfig,
} from "../../packages/ristoairen/src/atmos/index.ts";

test("REC-008 recovers ATMOS as presentation/context engine only", () => {
  const recovered = recoverPortableAtmosPattern({ portable_context_engine: true });
  assert.equal(recovered.pureTimeSeasonEngine, true);
  assert.equal(recovered.locationTenantDefaultHierarchy, true);
  assert.equal(recovered.consumerOnlyPresentationState, true);
  assert.equal(recovered.donorConfigurationMigrated, false);
  assert.equal(recovered.donorBrandingMigrated, false);
});

test("REC-008 rejects donor identity, branding, routes and platform authority", () => {
  for (const field of ATMOS_DONOR_FORBIDDEN_FIELDS) {
    assert.throws(() => recoverPortableAtmosPattern({ [field]: "legacy-value" }), new RegExp(`REC008_FORBIDDEN_DONOR_DATA:${field}`));
  }
});

test("REC-008 engine defaults are generic and venue-neutral", () => {
  assert.equal(DEFAULT_ATMOS_PRESENTATION_CONFIG.timezone, "UTC");
  assert.equal(DEFAULT_ATMOS_PRESENTATION_CONFIG.enabled, true);
  assert.equal(JSON.stringify(DEFAULT_ATMOS_PRESENTATION_CONFIG).includes("Corte"), false);
  assert.equal(JSON.stringify(DEFAULT_ATMOS_PRESENTATION_CONFIG).includes("Cefal"), false);
});

test("REC-008 resolves time, season and sanitized event windows without business side effects", () => {
  const config = validateAtmosPresentationConfig({
    ...DEFAULT_ATMOS_PRESENTATION_CONFIG,
    timezone: "UTC",
    thresholds: { dawnStart: "06:00", dayStart: "11:00", goldenStart: "17:30", nightStart: "20:30" },
  });
  const daytime = resolveAtmosState(config, new Date("2026-06-15T12:00:00Z"));
  assert.equal(daytime.daypart, "DAY");
  assert.equal(daytime.season, "SUMMER");

  const event = resolveAtmosState(config, new Date("2026-06-15T19:00:00Z"), [
    { startsAt: "2026-06-15T18:00:00Z", endsAt: "2026-06-15T20:00:00Z", presentationToken: { primaryActionKey: "event.primary" } },
  ]);
  assert.equal(event.daypart, "EVENT");
  assert.equal(event.presentationToken?.primaryActionKey, "event.primary");
});

test("REC-008 planned preview is pure and does not mutate configuration", () => {
  const before = JSON.stringify(DEFAULT_ATMOS_PRESENTATION_CONFIG);
  const preview = previewAtmosState(DEFAULT_ATMOS_PRESENTATION_CONFIG, "2026-12-15T22:00:00Z");
  assert.equal(preview?.daypart, "NIGHT");
  assert.equal(JSON.stringify(DEFAULT_ATMOS_PRESENTATION_CONFIG), before);
});

test("REC-008 freezes ATMOS platform authority boundary", () => {
  assert.equal(ATMOS_AUTHORITY_RULES.presentationOnly, true);
  assert.equal(ATMOS_AUTHORITY_RULES.businessAuthorityAllowed, false);
  assert.equal(ATMOS_AUTHORITY_RULES.entitlementMutationAllowed, false);
  assert.equal(ATMOS_AUTHORITY_RULES.tenantAuthorityMutationAllowed, false);
  assert.equal(ATMOS_AUTHORITY_RULES.domainAuthorityMutationAllowed, false);
  assert.deepEqual(ATMOS_AUTHORITY_RULES.effectiveResolutionOrder, ["LOCATION_OVERRIDE", "TENANT_DEFAULT", "ENGINE_DEFAULT"]);
});

test("REC-008 acceptance obligations remain runtime-pending", () => {
  assert.deepEqual(REC008_ATMOS_RECOVERY_EVIDENCE.acceptanceTests, ["GJ2-002", "GJ2-030"]);
  assert.equal(REC008_ATMOS_RECOVERY_EVIDENCE.runtimeState, "RUNTIME_PENDING");
});
