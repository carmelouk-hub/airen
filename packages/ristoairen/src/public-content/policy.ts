import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type {
  JournalDraftInputV1,
  JournalPublishInputV1,
  PublicContentLocale,
  PublicPageRequestV1,
  ResolvedPublicTenantV1,
} from "./contracts.ts";

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeHostname(hostname: string): string {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!HOSTNAME_RE.test(normalized)) throw new AppError("VALIDATION_FAILED", "INVALID_PUBLIC_HOSTNAME");
  return normalized;
}

export function normalizePublicPath(path: string): string {
  const normalized = String(path || "").trim();
  if (!normalized.startsWith("/") || normalized.includes("..") || normalized.includes("\\") || normalized.length > 512) {
    throw new AppError("VALIDATION_FAILED", "INVALID_PUBLIC_PATH");
  }
  return normalized.replace(/\/{2,}/g, "/");
}

export function validatePublicPageRequest(input: PublicPageRequestV1): PublicPageRequestV1 {
  return Object.freeze({
    hostname: normalizeHostname(input.hostname),
    pagePath: normalizePublicPath(input.pagePath),
    locale: input.locale,
  });
}

export function assertResolvedPublicTenant(scope: ResolvedPublicTenantV1 | null): asserts scope is ResolvedPublicTenantV1 {
  if (!scope?.tenantId || !scope.hostname || !scope.canonicalOrigin) {
    throw new AppError("TENANT_RESOLUTION_FAILED", "PUBLIC_TENANT_RESOLUTION_FAILED");
  }
}

export function requireEditorialWrite(context: SecurityContext): void {
  if (!context.tenantId || !context.actorIdentityId) throw new AppError("PERMISSION_DENIED", "MISSING_EDITORIAL_SECURITY_SCOPE");
  const allowed = context.permissions.includes("journal.write") || context.permissions.includes("journal.publish") || context.platformPermissions.includes("platform.override_tenant_scope");
  if (!allowed) throw new AppError("PERMISSION_DENIED", "JOURNAL_WRITE_NOT_ALLOWED");
}

export function requireJournalPublish(context: SecurityContext): void {
  if (!context.permissions.includes("journal.publish") && !context.platformPermissions.includes("platform.override_tenant_scope")) {
    throw new AppError("PERMISSION_DENIED", "JOURNAL_PUBLISH_NOT_ALLOWED");
  }
}

export function validateJournalDraft(input: JournalDraftInputV1): JournalDraftInputV1 {
  const title = input.title?.trim();
  const slug = input.slug?.trim().toLowerCase();
  const body = input.body?.trim();
  if (!title || !slug || !body) throw new AppError("VALIDATION_FAILED", "INVALID_JOURNAL_DRAFT");
  if (!SLUG_RE.test(slug) || slug.length > 120) throw new AppError("VALIDATION_FAILED", "INVALID_JOURNAL_SLUG");
  return Object.freeze({ ...input, title, slug, body, excerpt: input.excerpt?.trim(), category: input.category?.trim() });
}

export function validateJournalPublish(input: JournalPublishInputV1): JournalPublishInputV1 {
  if (!input.articleId || !input.publishedAt?.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_JOURNAL_PUBLISH");
  if (!Number.isInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_JOURNAL_ROW_VERSION");
  return Object.freeze({ ...input, publishedAt: input.publishedAt.trim() });
}

export function normalizePublicLocale(locale: PublicContentLocale): PublicContentLocale {
  return locale;
}
