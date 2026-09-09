import { AppError } from "../../../shared-contracts/src/index.ts";

export const FORBIDDEN_DONOR_PUBLIC_CONTENT_FIELDS = [
  "id",
  "tenant_id",
  "location_id",
  "business_name",
  "legal_name",
  "website_url",
  "canonical_url",
  "author",
  "keyword",
  "current_position",
  "previous_position",
  "best_position",
  "clicks",
  "impressions",
  "ctr",
  "analytics_id",
  "google_tag_id",
  "search_console_property",
] as const;

export type RecoverablePublicContentPatternV1 = Readonly<{
  supportsSeoProjection: boolean;
  supportsJournalDraftPublishLifecycle: boolean;
  supportsPublishedJournalProjection: boolean;
  supportsSitemapProjection: boolean;
  requiresServerSideTenantResolution: true;
  rejectsCallerTenantAuthority: true;
}>;

export function assertNoDonorPublicContentAuthority(payload: Readonly<Record<string, unknown>>): void {
  for (const field of FORBIDDEN_DONOR_PUBLIC_CONTENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      throw new AppError("VALIDATION_FAILED", `FORBIDDEN_DONOR_PUBLIC_CONTENT_FIELD:${field}`);
    }
  }
}

export function recoverPublicContentPattern(payload: Readonly<Record<string, unknown>>): RecoverablePublicContentPatternV1 {
  assertNoDonorPublicContentAuthority(payload);
  return Object.freeze({
    supportsSeoProjection: payload.hasSeoSettings === true,
    supportsJournalDraftPublishLifecycle: payload.hasJournalLifecycle === true,
    supportsPublishedJournalProjection: payload.hasPublishedJournalProjection === true,
    supportsSitemapProjection: payload.hasSitemap === true,
    requiresServerSideTenantResolution: true,
    rejectsCallerTenantAuthority: true,
  });
}

export const EX_CORTE_PUBLIC_CONTENT_RECOVERY_RULES = Object.freeze({
  donorRole: "RECOVERY_DONOR_ONLY",
  migrateContentRecords: false,
  migrateBranding: false,
  migrateTenantOrLocationIds: false,
  migrateDomainsOrCanonicalUrls: false,
  migrateKeywordMetrics: false,
  migrateAnalyticsIdentifiers: false,
  preservePatterns: Object.freeze([
    "SERVER_SIDE_HOST_TO_TENANT_RESOLUTION",
    "SANITIZED_PUBLIC_PROJECTION",
    "JOURNAL_DRAFT_THEN_HUMAN_PUBLISH",
    "SITEMAP_FROM_PUBLISHABLE_PROJECTIONS",
  ]),
});
