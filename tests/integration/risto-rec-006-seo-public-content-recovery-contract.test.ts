import test from "node:test";
import assert from "node:assert/strict";
import {
  EX_CORTE_PUBLIC_CONTENT_RECOVERY_RULES,
  FORBIDDEN_DONOR_PUBLIC_CONTENT_FIELDS,
  REC006_PUBLIC_CONTENT_RECOVERY_EVIDENCE,
  recoverPublicContentPattern,
  validateJournalDraft,
  validateJournalPublish,
  validatePublicPageRequest,
} from "../../packages/ristoairen/src/public-content/index.ts";

test("REC-006 recovers SEO/public-content patterns without donor content or branding", () => {
  const recovered = recoverPublicContentPattern({
    hasSeoSettings: true,
    hasJournalLifecycle: true,
    hasPublishedJournalProjection: true,
    hasSitemap: true,
  });
  assert.equal(recovered.supportsSeoProjection, true);
  assert.equal(recovered.supportsJournalDraftPublishLifecycle, true);
  assert.equal(recovered.supportsPublishedJournalProjection, true);
  assert.equal(recovered.supportsSitemapProjection, true);
  assert.equal(EX_CORTE_PUBLIC_CONTENT_RECOVERY_RULES.migrateContentRecords, false);
  assert.equal(EX_CORTE_PUBLIC_CONTENT_RECOVERY_RULES.migrateBranding, false);
});

test("REC-006 rejects donor identity, domain, keyword metrics and analytics authority", () => {
  for (const field of FORBIDDEN_DONOR_PUBLIC_CONTENT_FIELDS) {
    assert.throws(
      () => recoverPublicContentPattern({ [field]: "legacy-value" }),
      new RegExp(`FORBIDDEN_DONOR_PUBLIC_CONTENT_FIELD:${field}`),
    );
  }
});

test("REC-006 public request carries hostname/path/locale but no caller tenant id", () => {
  const request = validatePublicPageRequest({ hostname: "tenant.example.com", pagePath: "/journal", locale: "it" });
  assert.equal(request.hostname, "tenant.example.com");
  assert.equal(request.pagePath, "/journal");
  assert.equal(Object.prototype.hasOwnProperty.call(request, "tenantId"), false);
  assert.throws(() => validatePublicPageRequest({ hostname: "bad host", pagePath: "/", locale: "it" }));
});

test("REC-006 journal drafts remain unpublished until explicit publish action", () => {
  const draft = validateJournalDraft({ title: "Autumn Notes", slug: "autumn-notes", locale: "en", body: "A sufficiently explicit editorial draft." });
  assert.equal(draft.slug, "autumn-notes");
  const publish = validateJournalPublish({ articleId: "article-1", expectedRowVersion: 3, publishedAt: "2026-10-01T12:00:00Z" });
  assert.equal(publish.expectedRowVersion, 3);
  assert.throws(() => validateJournalPublish({ articleId: "article-1", expectedRowVersion: -1, publishedAt: "2026-10-01T12:00:00Z" }));
});

test("REC-006 acceptance obligations remain runtime-pending", () => {
  assert.deepEqual(REC006_PUBLIC_CONTENT_RECOVERY_EVIDENCE.acceptanceTests, ["GJ2-002", "GJ2-036"]);
  assert.equal(REC006_PUBLIC_CONTENT_RECOVERY_EVIDENCE.runtimeState, "RUNTIME_PENDING");
  assert.equal(REC006_PUBLIC_CONTENT_RECOVERY_EVIDENCE.publicAuthority, "AIRENOS_TENANT_DOMAIN_RESOLUTION");
});
