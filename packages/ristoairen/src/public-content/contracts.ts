import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";

export const PUBLIC_CONTENT_LOCALES = ["it", "en", "fr", "de", "es"] as const;
export type PublicContentLocale = (typeof PUBLIC_CONTENT_LOCALES)[number];

export const JOURNAL_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export type ResolvedPublicTenantV1 = Readonly<{
  tenantId: UUID;
  locationId?: UUID;
  hostname: string;
  canonicalOrigin: string;
}>;

export type PublicPageRequestV1 = Readonly<{
  hostname: string;
  pagePath: string;
  locale: PublicContentLocale;
}>;

export type PublicSeoProjectionV1 = Readonly<{
  pagePath: string;
  locale: PublicContentLocale;
  seoTitle: string;
  metaDescription?: string;
  h1?: string;
  canonicalUrl?: string;
  openGraphTitle?: string;
  openGraphDescription?: string;
  openGraphImageUrl?: string;
  schemaType?: string;
  noindex: boolean;
}>;

export type PublicJournalArticleV1 = Readonly<{
  slug: string;
  locale: PublicContentLocale;
  title: string;
  excerpt?: string;
  body: string;
  category?: string;
  heroImageUrl?: string;
  heroImageAlt?: string;
  seoTitle?: string;
  metaDescription?: string;
  publishedAt?: string;
  updatedAt?: string;
}>;

export type JournalDraftInputV1 = Readonly<{
  title: string;
  slug: string;
  locale: PublicContentLocale;
  body: string;
  excerpt?: string;
  category?: string;
  heroImageUrl?: string;
  heroImageAlt?: string;
  seoTitle?: string;
  metaDescription?: string;
  locationId?: UUID;
}>;

export type JournalPublishInputV1 = Readonly<{
  articleId: UUID;
  expectedRowVersion: number;
  publishedAt: string;
}>;

export type SitemapEntryV1 = Readonly<{
  path: string;
  locale: PublicContentLocale;
  lastModifiedAt?: string;
  changeFrequency?: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}>;

export interface PublicTenantResolverPort {
  resolveFromHostname(hostname: string): Promise<ResolvedPublicTenantV1 | null>;
}

export interface PublicContentRepository {
  findSeoProjection(scope: ResolvedPublicTenantV1, pagePath: string, locale: PublicContentLocale): Promise<PublicSeoProjectionV1 | null>;
  listPublishedJournal(scope: ResolvedPublicTenantV1, locale: PublicContentLocale, limit: number): Promise<readonly PublicJournalArticleV1[]>;
  findPublishedJournalBySlug(scope: ResolvedPublicTenantV1, slug: string, locale: PublicContentLocale): Promise<PublicJournalArticleV1 | null>;
  listSitemapEntries(scope: ResolvedPublicTenantV1): Promise<readonly SitemapEntryV1[]>;
  createJournalDraft(context: SecurityContext, input: JournalDraftInputV1, idempotencyKey: string): Promise<{ articleId: UUID; replayed: boolean }>;
  publishJournal(context: SecurityContext, input: JournalPublishInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
}

export interface PublicContentProductAccessGuard {
  assertRistoAirenAccess(context: SecurityContext): void | Promise<void>;
}
