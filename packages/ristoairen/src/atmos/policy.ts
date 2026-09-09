import { AppError, assertResourceScope, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { AtmosConfigMutationInputV1, AtmosPresentationConfigV1 } from "./contracts.ts";

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function requireAtmosWrite(context: SecurityContext, input: AtmosConfigMutationInputV1): void {
  if (!context.tenantId || !context.actorIdentityId) {
    throw new AppError("AUTHENTICATION_REQUIRED", "ATMOS_CONFIGURATION_REQUIRES_SECURITY_CONTEXT");
  }
  assertResourceScope(context, { tenantId: context.tenantId, locationId: input.locationId });
}

export function validateAtmosPresentationConfig(config: AtmosPresentationConfigV1): AtmosPresentationConfigV1 {
  if (!config.timezone?.trim()) throw new AppError("VALIDATION_FAILED", "ATMOS_TIMEZONE_REQUIRED");
  if (!Number.isFinite(config.intensity) || config.intensity < 0 || config.intensity > 2) {
    throw new AppError("VALIDATION_FAILED", "ATMOS_INTENSITY_OUT_OF_RANGE");
  }
  if (!Number.isInteger(config.transitionMs) || config.transitionMs < 0 || config.transitionMs > 60_000) {
    throw new AppError("VALIDATION_FAILED", "ATMOS_TRANSITION_OUT_OF_RANGE");
  }
  const thresholds = config.thresholds;
  if (!thresholds || ![thresholds.dawnStart, thresholds.dayStart, thresholds.goldenStart, thresholds.nightStart].every((value) => HHMM.test(value))) {
    throw new AppError("VALIDATION_FAILED", "ATMOS_INVALID_DAYPART_THRESHOLDS");
  }
  if (config.seasonMode === "FIXED" && !config.forcedSeason) {
    throw new AppError("VALIDATION_FAILED", "ATMOS_FIXED_SEASON_REQUIRED");
  }
  if (config.previewExpiresAt && Number.isNaN(Date.parse(config.previewExpiresAt))) {
    throw new AppError("VALIDATION_FAILED", "ATMOS_INVALID_PREVIEW_EXPIRY");
  }
  return Object.freeze({
    ...config,
    timezone: config.timezone.trim(),
    thresholds: Object.freeze({ ...thresholds }),
  });
}

export function validateAtmosMutation(input: AtmosConfigMutationInputV1): AtmosConfigMutationInputV1 {
  if (!Number.isInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) {
    throw new AppError("VALIDATION_FAILED", "ATMOS_INVALID_ROW_VERSION");
  }
  return Object.freeze({ ...input, config: validateAtmosPresentationConfig(input.config) });
}

export const ATMOS_AUTHORITY_RULES = Object.freeze({
  presentationOnly: true,
  businessAuthorityAllowed: false,
  entitlementMutationAllowed: false,
  tenantAuthorityMutationAllowed: false,
  domainAuthorityMutationAllowed: false,
  locationScopeElevationAllowed: false,
  effectiveResolutionOrder: Object.freeze(["LOCATION_OVERRIDE", "TENANT_DEFAULT", "ENGINE_DEFAULT"]),
});
