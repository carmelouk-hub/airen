import { Pool, type PoolClient } from "pg";
import { AppError, type SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  JournalDraftInputV1,
  JournalPublishInputV1,
  PublicContentLocale,
  PublicContentRepository,
  PublicJournalArticleV1,
  PublicSeoProjectionV1,
  ResolvedPublicTenantV1,
  SitemapEntryV1,
} from "../../ristoairen/src/public-content/contracts.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function journalFromRow(row: Record<string, unknown>): PublicJournalArticleV1 {
  return Object.freeze({
    slug: String(row.slug),
    locale: String(row.locale) as PublicContentLocale,
    title: String(row.title),
    ...(row.excerpt == null ? {} : { excerpt: String(row.excerpt) }),
    body: String(row.body),
    ...(row.category == null ? {} : { category: String(row.category) }),
    ...(row.heroImageUrl == null ? {} : { heroImageUrl: String(row.heroImageUrl) }),
    ...(row.heroImageAlt == null ? {} : { heroImageAlt: String(row.heroImageAlt) }),
    ...(row.seoTitle == null ? {} : { seoTitle: String(row.seoTitle) }),
    ...(row.metaDescription == null ? {} : { metaDescription: String(row.metaDescription) }),
    ...(row.publishedAt == null ? {} : { publishedAt: iso(row.publishedAt) }),
    ...(row.updatedAt == null ? {} : { updatedAt: iso(row.updatedAt) }),
  });
}

function seoFromRow(row: Record<string, unknown>): PublicSeoProjectionV1 {
  return Object.freeze({
    pagePath: String(row.pagePath),
    locale: String(row.locale) as PublicContentLocale,
    seoTitle: String(row.seoTitle),
    ...(row.metaDescription == null ? {} : { metaDescription: String(row.metaDescription) }),
    ...(row.h1 == null ? {} : { h1: String(row.h1) }),
    ...(row.canonicalUrl == null ? {} : { canonicalUrl: String(row.canonicalUrl) }),
    ...(row.openGraphTitle == null ? {} : { openGraphTitle: String(row.openGraphTitle) }),
    ...(row.openGraphDescription == null ? {} : { openGraphDescription: String(row.openGraphDescription) }),
    ...(row.openGraphImageUrl == null ? {} : { openGraphImageUrl: String(row.openGraphImageUrl) }),
    ...(row.schemaType == null ? {} : { schemaType: String(row.schemaType) }),
    noindex: Boolean(row.noindex),
  });
}

function sameNullable(left: unknown, right: unknown): boolean {
  const normalizedLeft = left == null || left === "" ? null : String(left);
  const normalizedRight = right == null || right === "" ? null : String(right);
  return normalizedLeft === normalizedRight;
}

function assertDraftReplayMatches(
  row: Record<string, unknown>,
  context: SecurityContext,
  input: JournalDraftInputV1,
): void {
  const matches =
    String(row.createdByIdentityId) === context.actorIdentityId &&
    String(row.title) === input.title &&
    String(row.slug) === input.slug &&
    String(row.locale) === input.locale &&
    String(row.body) === input.body &&
    sameNullable(row.excerpt, input.excerpt) &&
    sameNullable(row.category, input.category) &&
    sameNullable(row.heroImageUrl, input.heroImageUrl) &&
    sameNullable(row.heroImageAlt, input.heroImageAlt) &&
    sameNullable(row.seoTitle, input.seoTitle) &&
    sameNullable(row.metaDescription, input.metaDescription);
  if (!matches) throw new AppError("IDEMPOTENCY_CONFLICT", "JOURNAL_DRAFT_IDEMPOTENCY_PAYLOAD_MISMATCH");
}

function sameInstant(left: unknown, right: string): boolean {
  const leftTime = new Date(String(left)).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

const JOURNAL_PUBLIC_SELECT = `SELECT slug,locale,title,excerpt,body,category,
 hero_image_url AS "heroImageUrl",hero_image_alt AS "heroImageAlt",seo_title AS "seoTitle",
 meta_description AS "metaDescription",published_at AS "publishedAt",updated_at AS "updatedAt"
 FROM ristoairen.journal_articles`;

export class PostgresPublicContentRepository implements PublicContentRepository {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assertRoleIdentifier(assumeRole);
  }

  private async withScope<T>(
    tenantId: string,
    locationId: string,
    readOnly: boolean,
    actorIdentityId: string,
    correlationId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!tenantId || !locationId) throw new AppError("TENANT_RESOLUTION_FAILED", "PUBLIC_CONTENT_SCOPE_REQUIRED");
    const client = await this.pool.connect();
    try {
      await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await client.query(`SET LOCAL ROLE ${this.assumeRole}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
        [actorIdentityId, tenantId, locationId, correlationId],
      );
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private withPublicScope<T>(scope: ResolvedPublicTenantV1, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!scope.tenantId || !scope.locationId) {
      throw new AppError("TENANT_RESOLUTION_FAILED", "PUBLIC_CONTENT_SCOPE_REQUIRED");
    }
    return this.withScope(scope.tenantId, scope.locationId, true, "", "public-content-read", fn);
  }

  private withEditorialScope<T>(
    context: SecurityContext,
    locationId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (locationId !== context.locationId && !context.platformPermissions.includes("platform.override_tenant_scope")) {
      throw new AppError("LOCATION_SCOPE_VIOLATION", "Journal location does not match resolved location context");
    }
    return this.withScope(
      context.tenantId,
      locationId,
      false,
      context.actorIdentityId,
      context.correlationId,
      fn,
    );
  }

  async findSeoProjection(
    scope: ResolvedPublicTenantV1,
    pagePath: string,
    locale: PublicContentLocale,
  ): Promise<PublicSeoProjectionV1 | null> {
    return this.withPublicScope(scope, async (client) => {
      const result = await client.query(
        `SELECT page_path AS "pagePath",locale,seo_title AS "seoTitle",meta_description AS "metaDescription",h1,
          canonical_url AS "canonicalUrl",open_graph_title AS "openGraphTitle",
          open_graph_description AS "openGraphDescription",open_graph_image_url AS "openGraphImageUrl",
          schema_type AS "schemaType",noindex
         FROM ristoairen.public_seo_projections
         WHERE page_path=$1 AND locale=$2 AND status='PUBLISHED'
         LIMIT 1`,
        [pagePath, locale],
      );
      return result.rows[0] ? seoFromRow(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listPublishedJournal(
    scope: ResolvedPublicTenantV1,
    locale: PublicContentLocale,
    limit: number,
  ): Promise<readonly PublicJournalArticleV1[]> {
    return this.withPublicScope(scope, async (client) => {
      const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      const result = await client.query(
        `${JOURNAL_PUBLIC_SELECT}
         WHERE locale=$1 AND status='PUBLISHED'
         ORDER BY published_at DESC,slug ASC
         LIMIT $2`,
        [locale, boundedLimit],
      );
      return Object.freeze(result.rows.map((row) => journalFromRow(row as Record<string, unknown>)));
    });
  }

  async findPublishedJournalBySlug(
    scope: ResolvedPublicTenantV1,
    slug: string,
    locale: PublicContentLocale,
  ): Promise<PublicJournalArticleV1 | null> {
    return this.withPublicScope(scope, async (client) => {
      const result = await client.query(
        `${JOURNAL_PUBLIC_SELECT}
         WHERE slug=$1 AND locale=$2 AND status='PUBLISHED'
         LIMIT 1`,
        [slug, locale],
      );
      return result.rows[0] ? journalFromRow(result.rows[0] as Record<string, unknown>) : null;
    });
  }

  async listSitemapEntries(scope: ResolvedPublicTenantV1): Promise<readonly SitemapEntryV1[]> {
    return this.withPublicScope(scope, async (client) => {
      const result = await client.query(
        `WITH candidates AS (
           SELECT page_path AS path,locale,updated_at AS last_modified_at,0 AS source_priority
             FROM ristoairen.public_seo_projections
            WHERE status='PUBLISHED' AND noindex=false
           UNION ALL
           SELECT '/journal/' || slug AS path,locale,updated_at AS last_modified_at,1 AS source_priority
             FROM ristoairen.journal_articles
            WHERE status='PUBLISHED'
         ),deduplicated AS (
           SELECT DISTINCT ON (path,locale) path,locale,last_modified_at
             FROM candidates
            ORDER BY path,locale,source_priority
         )
         SELECT path,locale,last_modified_at AS "lastModifiedAt"
           FROM deduplicated
          ORDER BY path,locale`,
      );
      return Object.freeze(result.rows.map((row) => Object.freeze({
        path: String(row.path),
        locale: String(row.locale) as PublicContentLocale,
        ...(row.lastModifiedAt == null ? {} : { lastModifiedAt: iso(row.lastModifiedAt) }),
      })));
    });
  }

  async createJournalDraft(
    context: SecurityContext,
    input: JournalDraftInputV1,
    idempotencyKey: string,
  ): Promise<{ articleId: string; replayed: boolean }> {
    const locationId = input.locationId ?? context.locationId;
    return this.withEditorialScope(context, locationId, async (client) => {
      const existingResult = await client.query(
        `SELECT id::text AS id,created_by_identity_id::text AS "createdByIdentityId",title,slug,locale,body,excerpt,category,
          hero_image_url AS "heroImageUrl",hero_image_alt AS "heroImageAlt",seo_title AS "seoTitle",
          meta_description AS "metaDescription"
         FROM ristoairen.journal_articles
         WHERE draft_request_key=$1
         LIMIT 1`,
        [idempotencyKey],
      );
      if (existingResult.rows[0]) {
        const existing = existingResult.rows[0] as Record<string, unknown>;
        assertDraftReplayMatches(existing, context, input);
        return Object.freeze({ articleId: String(existing.id), replayed: true });
      }

      try {
        const insertResult = await client.query(
          `INSERT INTO ristoairen.journal_articles
           (tenant_id,location_id,slug,locale,title,excerpt,body,category,hero_image_url,hero_image_alt,
            seo_title,meta_description,status,published_at,created_by_identity_id,draft_request_key,publish_request_key)
           VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAFT',NULL,$13::uuid,$14,NULL)
           ON CONFLICT (tenant_id,location_id,draft_request_key) DO NOTHING
           RETURNING id::text AS id`,
          [
            context.tenantId,
            locationId,
            input.slug,
            input.locale,
            input.title,
            optionalString(input.excerpt) ?? null,
            input.body,
            optionalString(input.category) ?? null,
            optionalString(input.heroImageUrl) ?? null,
            optionalString(input.heroImageAlt) ?? null,
            optionalString(input.seoTitle) ?? null,
            optionalString(input.metaDescription) ?? null,
            context.actorIdentityId,
            idempotencyKey,
          ],
        );
        if (insertResult.rows[0]) {
          return Object.freeze({ articleId: String(insertResult.rows[0].id), replayed: false });
        }
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
      }

      const replayResult = await client.query(
        `SELECT id::text AS id,created_by_identity_id::text AS "createdByIdentityId",title,slug,locale,body,excerpt,category,
          hero_image_url AS "heroImageUrl",hero_image_alt AS "heroImageAlt",seo_title AS "seoTitle",
          meta_description AS "metaDescription"
         FROM ristoairen.journal_articles
         WHERE draft_request_key=$1
         LIMIT 1`,
        [idempotencyKey],
      );
      if (replayResult.rows[0]) {
        const replay = replayResult.rows[0] as Record<string, unknown>;
        assertDraftReplayMatches(replay, context, input);
        return Object.freeze({ articleId: String(replay.id), replayed: true });
      }
      throw new AppError("CONFLICT", "JOURNAL_DRAFT_SLUG_OR_SCOPE_CONFLICT");
    });
  }

  async publishJournal(
    context: SecurityContext,
    input: JournalPublishInputV1,
    idempotencyKey: string,
  ): Promise<{ replayed: boolean }> {
    return this.withEditorialScope(context, context.locationId, async (client) => {
      const byKey = await client.query(
        `SELECT id::text AS id,status,published_at AS "publishedAt"
         FROM ristoairen.journal_articles
         WHERE publish_request_key=$1
         LIMIT 1`,
        [idempotencyKey],
      );
      if (byKey.rows[0]) {
        const existing = byKey.rows[0] as Record<string, unknown>;
        if (String(existing.id) !== input.articleId || !sameInstant(existing.publishedAt, input.publishedAt)) {
          throw new AppError("IDEMPOTENCY_CONFLICT", "JOURNAL_PUBLISH_IDEMPOTENCY_PAYLOAD_MISMATCH");
        }
        return Object.freeze({ replayed: true });
      }

      try {
        const updateResult = await client.query(
          `UPDATE ristoairen.journal_articles
              SET status='PUBLISHED',published_at=$3::timestamptz,publish_request_key=$4
            WHERE id=$1::uuid AND row_version=$2 AND status='DRAFT'
            RETURNING id::text AS id`,
          [input.articleId, input.expectedRowVersion, input.publishedAt, idempotencyKey],
        );
        if (updateResult.rows[0]) return Object.freeze({ replayed: false });
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
        const conflictingKey = await client.query(
          `SELECT id::text AS id,published_at AS "publishedAt"
           FROM ristoairen.journal_articles
           WHERE publish_request_key=$1
           LIMIT 1`,
          [idempotencyKey],
        );
        if (conflictingKey.rows[0]) {
          const conflict = conflictingKey.rows[0] as Record<string, unknown>;
          if (String(conflict.id) !== input.articleId || !sameInstant(conflict.publishedAt, input.publishedAt)) {
            throw new AppError("IDEMPOTENCY_CONFLICT", "JOURNAL_PUBLISH_IDEMPOTENCY_PAYLOAD_MISMATCH");
          }
          return Object.freeze({ replayed: true });
        }
      }

      const articleResult = await client.query(
        `SELECT id::text AS id,status,row_version AS "rowVersion",publish_request_key AS "publishRequestKey",
          published_at AS "publishedAt"
         FROM ristoairen.journal_articles
         WHERE id=$1::uuid
         LIMIT 1`,
        [input.articleId],
      );
      if (!articleResult.rows[0]) throw new AppError("NOT_FOUND", "JOURNAL_ARTICLE_NOT_FOUND");
      const article = articleResult.rows[0] as Record<string, unknown>;
      if (
        String(article.publishRequestKey || "") === idempotencyKey &&
        sameInstant(article.publishedAt, input.publishedAt)
      ) {
        return Object.freeze({ replayed: true });
      }
      if (String(article.publishRequestKey || "") === idempotencyKey) {
        throw new AppError("IDEMPOTENCY_CONFLICT", "JOURNAL_PUBLISH_IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      throw new AppError("CONFLICT", "JOURNAL_ROW_VERSION_STALE_OR_STATE_CHANGED", {
        currentRowVersion: Number(article.rowVersion),
        currentStatus: String(article.status),
      });
    });
  }
}
