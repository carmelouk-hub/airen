import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  PostgresFoundationReadStore,
  PostgresLocationRepositoryAdapter,
  PostgresTenantRepositoryAdapter,
} from "../../packages/persistence-postgres/src/index.ts";
import { PostgresPublicContentRepository } from "../../packages/persistence-postgres/src/risto-public-content.ts";
import { RistoAirenPublicContentService } from "../../packages/ristoairen/src/public-content/application-service.ts";
import {
  AirenOsPublicTenantResolver,
  dispatchPublicContentApiRequest,
  isPublicContentApiRequest,
  type PublicContentApiResponse,
} from "../../apps/api/src/public-content-api.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
const reads = new PostgresFoundationReadStore(pool);
const publicContent = new RistoAirenPublicContentService(
  new AirenOsPublicTenantResolver(Object.freeze({
    trustedBaseDomain: "ristoairen.com",
    tenants: new PostgresTenantRepositoryAdapter(reads),
    locations: new PostgresLocationRepositoryAdapter(reads),
    domains: reads,
    publicRoutes: reads,
  })),
  new PostgresPublicContentRepository(pool),
);

const TENANT_A = "a4000000-0000-4400-8400-000000000001";
const LOCATION_A = "a4000000-0000-4400-8400-000000000002";
const TENANT_B = "b4000000-0000-4400-8400-000000000001";
const LOCATION_B = "b4000000-0000-4400-8400-000000000002";
const ACTOR = "c4000000-0000-4400-8400-000000000001";

const HOST_A = "mat040-public-a.ristoairen.com";
const HOST_B = "mat040-public-b.ristoairen.com";

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function assertSanitized(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    TENANT_A,
    LOCATION_A,
    TENANT_B,
    LOCATION_B,
    ACTOR,
    "tenantId",
    "locationId",
    "createdByIdentityId",
    "draftRequestKey",
    "publishRequestKey",
    "rowVersion",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public payload leaked ${forbidden}`);
  }
}

async function api(host: string | undefined, url: string, method = "GET"): Promise<PublicContentApiResponse> {
  return dispatchPublicContentApiRequest({
    method,
    url,
    headers: Object.freeze({ host }),
  }, publicContent);
}

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name,status) VALUES
      ('${TENANT_A}','mat040-public-a','MAT040 Public Tenant A','active'),
      ('${TENANT_B}','mat040-public-b','MAT040 Public Tenant B','active');

    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,is_primary,status) VALUES
      ('${LOCATION_A}','${TENANT_A}','main','MAT040 A Main','Europe/Rome',true,'active'),
      ('${LOCATION_B}','${TENANT_B}','main','MAT040 B Main','Europe/Rome',true,'active');

    INSERT INTO identity.identities (id,display_name)
    VALUES ('${ACTOR}','MAT040 Synthetic Publisher');

    INSERT INTO ristoairen.public_seo_projections
      (tenant_id,location_id,page_path,locale,seo_title,meta_description,h1,canonical_url,
       open_graph_title,open_graph_description,open_graph_image_url,schema_type,noindex,status,published_at)
    VALUES
      ('${TENANT_A}','${LOCATION_A}','/','it','Tenant A Home','Tenant A public description','Tenant A Public',
       'https://${HOST_A}/','Tenant A OG','Tenant A OG description','https://${HOST_A}/hero.jpg','Restaurant',false,'PUBLISHED','2026-09-15T00:00:00Z'),
      ('${TENANT_A}','${LOCATION_A}','/draft-preview','it','Tenant A Draft SEO','DRAFT_ONLY_MARKER','Tenant A Draft',
       NULL,NULL,NULL,NULL,NULL,false,'DRAFT',NULL),
      ('${TENANT_A}','${LOCATION_A}','/noindex-offer','it','Tenant A Noindex','NOINDEX_MARKER','Tenant A Noindex',
       'https://${HOST_A}/noindex-offer',NULL,NULL,NULL,NULL,true,'PUBLISHED','2026-09-15T00:01:00Z'),
      ('${TENANT_B}','${LOCATION_B}','/','it','Tenant B Home','TENANT_B_ONLY_SEO','Tenant B Public',
       'https://${HOST_B}/','Tenant B OG','TENANT_B_ONLY_OG','https://${HOST_B}/hero.jpg','Restaurant',false,'PUBLISHED','2026-09-15T00:02:00Z');

    INSERT INTO ristoairen.journal_articles
      (tenant_id,location_id,slug,locale,title,excerpt,body,category,hero_image_url,hero_image_alt,
       seo_title,meta_description,status,published_at,created_by_identity_id,draft_request_key,publish_request_key)
    VALUES
      ('${TENANT_A}','${LOCATION_A}','welcome','it','Tenant A Welcome','Tenant A excerpt','TENANT_A_PUBLIC_BODY','news',
       'https://${HOST_A}/journal/welcome.jpg','Tenant A welcome','Tenant A Welcome SEO','Tenant A journal description',
       'PUBLISHED','2026-09-15T01:00:00Z','${ACTOR}','mat040-a-welcome-draft','mat040-a-welcome-publish'),
      ('${TENANT_A}','${LOCATION_A}','private-draft','it','Tenant A Private Draft','PRIVATE_DRAFT_MARKER','PRIVATE_DRAFT_BODY','news',
       NULL,NULL,NULL,NULL,'DRAFT',NULL,'${ACTOR}','mat040-a-private-draft',NULL),
      ('${TENANT_B}','${LOCATION_B}','welcome','it','Tenant B Welcome','TENANT_B_ONLY_EXCERPT','TENANT_B_ONLY_BODY','news',
       'https://${HOST_B}/journal/welcome.jpg','Tenant B welcome','Tenant B Welcome SEO','TENANT_B_ONLY_META',
       'PUBLISHED','2026-09-15T01:02:00Z','${ACTOR}','mat040-b-welcome-draft','mat040-b-welcome-publish');
  `);
}

test.before(seed);
test.after(async () => {
  await pool.end();
});

test("MAT-040 / GJ2-002 public tenant experience E2E", async (t) => {
  await t.test("API route classifier recognizes only the public-content namespace", () => {
    assert.equal(isPublicContentApiRequest("/api/public/v1/seo?path=%2F&locale=it"), true);
    assert.equal(isPublicContentApiRequest("/api/public/v1/journal?locale=it"), true);
    assert.equal(isPublicContentApiRequest("/admin/api/v1/tenants"), false);
    assert.equal(isPublicContentApiRequest("/health/live"), false);
  });

  await t.test("hostname resolves tenant A and returns only its sanitized published SEO projection", async () => {
    const response = await api(HOST_A, "/api/public/v1/seo?path=%2F&locale=it");
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "public, max-age=60, stale-while-revalidate=300");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    const data = asRecord(response.body.data);
    assert.equal(data.pagePath, "/");
    assert.equal(data.locale, "it");
    assert.equal(data.seoTitle, "Tenant A Home");
    assert.equal(data.h1, "Tenant A Public");
    assert.equal(data.canonicalUrl, `https://${HOST_A}/`);
    assertSanitized(response.body);
    assert.equal(JSON.stringify(response.body).includes("TENANT_B_ONLY"), false);
  });

  await t.test("caller-controlled tenantId/locationId query parameters cannot override Host scope", async () => {
    const response = await api(
      HOST_A,
      `/api/public/v1/seo?path=%2F&locale=it&tenantId=${encodeURIComponent(TENANT_B)}&locationId=${encodeURIComponent(LOCATION_B)}`,
    );
    assert.equal(response.status, 200);
    const data = asRecord(response.body.data);
    assert.equal(data.seoTitle, "Tenant A Home");
    assert.equal(JSON.stringify(response.body).includes("Tenant B Home"), false);
    assertSanitized(response.body);
  });

  await t.test("tenant B resolves independently and cannot inherit tenant A projection", async () => {
    const response = await api(HOST_B, "/api/public/v1/seo?path=%2F&locale=it");
    assert.equal(response.status, 200);
    const data = asRecord(response.body.data);
    assert.equal(data.seoTitle, "Tenant B Home");
    assert.equal(data.metaDescription, "TENANT_B_ONLY_SEO");
    assert.equal(JSON.stringify(response.body).includes("Tenant A Home"), false);
    assertSanitized(response.body);
  });

  await t.test("draft SEO never becomes public and unknown hosts fail closed without scope disclosure", async () => {
    const draft = await api(HOST_A, "/api/public/v1/seo?path=%2Fdraft-preview&locale=it");
    assert.equal(draft.status, 404);
    assert.deepEqual(draft.body, { error: "NOT_FOUND", message: "Public content not found" });
    assert.equal(JSON.stringify(draft.body).includes("DRAFT_ONLY_MARKER"), false);

    const unknown = await api("unknown-mat040.example.test", "/api/public/v1/seo?path=%2F&locale=it");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers["cache-control"], "no-store");
    assert.equal(JSON.stringify(unknown.body).includes(TENANT_A), false);
    assert.equal(JSON.stringify(unknown.body).includes(TENANT_B), false);

    const missingHost = await api(undefined, "/api/public/v1/seo?path=%2F&locale=it");
    assert.equal(missingHost.status, 404);
    assert.equal(JSON.stringify(missingHost.body).includes("PUBLIC_HOST_REQUIRED"), false);
  });

  await t.test("journal list and article reads expose PUBLISHED content only within resolved tenant", async () => {
    const listA = await api(HOST_A, "/api/public/v1/journal?locale=it&limit=50");
    assert.equal(listA.status, 200);
    const itemsA = asArray(listA.body.items).map(asRecord);
    assert.equal(itemsA.length, 1);
    assert.equal(itemsA[0].slug, "welcome");
    assert.equal(itemsA[0].title, "Tenant A Welcome");
    assert.equal(itemsA[0].body, "TENANT_A_PUBLIC_BODY");
    assert.equal(JSON.stringify(listA.body).includes("PRIVATE_DRAFT_MARKER"), false);
    assert.equal(JSON.stringify(listA.body).includes("TENANT_B_ONLY"), false);
    assertSanitized(listA.body);

    const articleA = await api(HOST_A, "/api/public/v1/journal/welcome?locale=it");
    assert.equal(articleA.status, 200);
    assert.equal(asRecord(articleA.body.data).title, "Tenant A Welcome");
    assertSanitized(articleA.body);

    const articleB = await api(HOST_B, "/api/public/v1/journal/welcome?locale=it");
    assert.equal(articleB.status, 200);
    assert.equal(asRecord(articleB.body.data).title, "Tenant B Welcome");
    assert.equal(JSON.stringify(articleB.body).includes("TENANT_A_PUBLIC_BODY"), false);
    assertSanitized(articleB.body);

    const draftArticle = await api(HOST_A, "/api/public/v1/journal/private-draft?locale=it");
    assert.equal(draftArticle.status, 404);
    assert.equal(JSON.stringify(draftArticle.body).includes("PRIVATE_DRAFT_BODY"), false);
  });

  await t.test("sitemap is host-scoped, published-only and removes noindex projections", async () => {
    const response = await api(HOST_A, "/api/public/v1/sitemap");
    assert.equal(response.status, 200);
    assert.equal(response.body.canonicalOrigin, `https://${HOST_A}`);
    const entries = asArray(response.body.entries).map(asRecord);
    const paths = entries.map((entry) => `${String(entry.path)}:${String(entry.locale)}`);
    assert.ok(paths.includes("/:it"));
    assert.ok(paths.includes("/journal/welcome:it"));
    assert.equal(paths.includes("/draft-preview:it"), false);
    assert.equal(paths.includes("/noindex-offer:it"), false);
    assert.equal(JSON.stringify(response.body).includes("TENANT_B_ONLY"), false);
    assertSanitized(response.body);
  });

  await t.test("public surface is GET-only and validation failures do not expose internal scope", async () => {
    const post = await api(HOST_A, "/api/public/v1/journal?locale=it", "POST");
    assert.equal(post.status, 404);
    assertSanitized(post.body);

    const invalidLocale = await api(HOST_A, "/api/public/v1/journal?locale=xx");
    assert.equal(invalidLocale.status, 400);
    assert.equal(invalidLocale.body.error, "VALIDATION_FAILED");
    assertSanitized(invalidLocale.body);
  });
});
