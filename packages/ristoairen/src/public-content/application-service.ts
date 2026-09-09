import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type {
  JournalDraftInputV1,
  JournalPublishInputV1,
  PublicContentLocale,
  PublicContentProductAccessGuard,
  PublicContentRepository,
  PublicJournalArticleV1,
  PublicPageRequestV1,
  PublicSeoProjectionV1,
  PublicTenantResolverPort,
  ResolvedPublicTenantV1,
  SitemapEntryV1,
} from "./contracts.ts";
import {
  assertResolvedPublicTenant,
  normalizeHostname,
  requireEditorialWrite,
  requireJournalPublish,
  validateJournalDraft,
  validateJournalPublish,
  validatePublicPageRequest,
} from "./policy.ts";

export class RistoAirenPublicContentService {
  constructor(
    private readonly resolver: PublicTenantResolverPort,
    private readonly repository: PublicContentRepository,
    private readonly accessGuard?: PublicContentProductAccessGuard,
  ) {}

  private async resolvePublicScope(hostname: string): Promise<ResolvedPublicTenantV1> {
    const normalizedHostname = normalizeHostname(hostname);
    const scope = await this.resolver.resolveFromHostname(normalizedHostname);
    assertResolvedPublicTenant(scope);
    if (normalizeHostname(scope.hostname) !== normalizedHostname) {
      throw new AppError("TENANT_RESOLUTION_FAILED", "PUBLIC_HOST_SCOPE_MISMATCH");
    }
    return scope;
  }

  async getSeoProjection(input: PublicPageRequestV1): Promise<PublicSeoProjectionV1 | null> {
    const request = validatePublicPageRequest(input);
    const scope = await this.resolvePublicScope(request.hostname);
    return this.repository.findSeoProjection(scope, request.pagePath, request.locale);
  }

  async listPublishedJournal(hostname: string, locale: PublicContentLocale, limit = 50): Promise<readonly PublicJournalArticleV1[]> {
    const scope = await this.resolvePublicScope(hostname);
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    return this.repository.listPublishedJournal(scope, locale, boundedLimit);
  }

  async getPublishedJournalArticle(hostname: string, slug: string, locale: PublicContentLocale): Promise<PublicJournalArticleV1 | null> {
    const normalizedSlug = String(slug || "").trim().toLowerCase();
    if (!normalizedSlug || normalizedSlug.includes("/") || normalizedSlug.includes("..")) {
      throw new AppError("VALIDATION_FAILED", "INVALID_PUBLIC_JOURNAL_SLUG");
    }
    const scope = await this.resolvePublicScope(hostname);
    return this.repository.findPublishedJournalBySlug(scope, normalizedSlug, locale);
  }

  async getSitemap(hostname: string): Promise<Readonly<{ canonicalOrigin: string; entries: readonly SitemapEntryV1[] }>> {
    const scope = await this.resolvePublicScope(hostname);
    const entries = await this.repository.listSitemapEntries(scope);
    return Object.freeze({ canonicalOrigin: scope.canonicalOrigin, entries });
  }

  async createJournalDraft(context: SecurityContext, input: JournalDraftInputV1, idempotencyKey: string): Promise<{ articleId: string; replayed: boolean }> {
    await this.accessGuard?.assertRistoAirenAccess(context);
    requireEditorialWrite(context);
    if (!idempotencyKey?.trim()) throw new AppError("VALIDATION_FAILED", "MISSING_IDEMPOTENCY_KEY");
    return this.repository.createJournalDraft(context, validateJournalDraft(input), idempotencyKey.trim());
  }

  async publishJournal(context: SecurityContext, input: JournalPublishInputV1, idempotencyKey: string): Promise<{ replayed: boolean }> {
    await this.accessGuard?.assertRistoAirenAccess(context);
    requireEditorialWrite(context);
    requireJournalPublish(context);
    if (!idempotencyKey?.trim()) throw new AppError("VALIDATION_FAILED", "MISSING_IDEMPOTENCY_KEY");
    return this.repository.publishJournal(context, validateJournalPublish(input), idempotencyKey.trim());
  }
}
