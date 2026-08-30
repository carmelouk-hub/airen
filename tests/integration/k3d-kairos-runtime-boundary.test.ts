import test from "node:test";
import assert from "node:assert/strict";
import { KairosIngestionPipeline } from "../../packages/kairos/src/ingestion.ts";
import type { KnowledgeSourceAdapter, KairosSourceSnapshot } from "../../packages/kairos/src/source-adapters.ts";
import {
  KairosGovernedIngestionService,
  PostgresKairosHybridSearch,
  PostgresKairosKnowledgePersistence,
  normalizeKairosIngestionPolicy,
  type KairosKnowledgePersistence,
  type KairosPersistenceCheckpoint,
} from "../../packages/kairos/src/runtime.ts";

const SOURCE: KairosSourceSnapshot = Object.freeze({
  sourceKey: "github:test/k3d:docs/manual.md",
  sourceType: "GITHUB",
  canonicalPointer: "https://github.com/test/k3d/blob/main/docs/manual.md",
  title: "manual.md",
  revisionKey: "1".repeat(40),
  observedAt: "2026-08-30T14:30:00.000Z",
  nativeText: "## Espresso\nhybridneedle governed procedure",
  nativeContentType: "MARKDOWN",
  metadata: Object.freeze({ repository: "test/k3d", path: "docs/manual.md" }),
});

class StaticAdapter implements KnowledgeSourceAdapter<Readonly<{}>> {
  private readonly snapshot: KairosSourceSnapshot;
  constructor(snapshot: KairosSourceSnapshot) { this.snapshot = snapshot; }
  async read(): Promise<KairosSourceSnapshot> { return this.snapshot; }
}

class MemoryPersistence implements KairosKnowledgePersistence {
  checkpoint?: KairosPersistenceCheckpoint;
  commits = 0;
  async getCheckpoint(): Promise<KairosPersistenceCheckpoint | undefined> { return this.checkpoint; }
  async commit(envelope: any): Promise<any> {
    this.commits += 1;
    return Object.freeze({
      sourceId: "10000000-0000-4000-8000-000000000001",
      sourceRevisionId: "20000000-0000-4000-8000-000000000001",
      documentId: "30000000-0000-4000-8000-000000000001",
      unitCount: envelope.units.length,
      changed: true,
      ingestionStatus: envelope.status,
    });
  }
}

const POLICY = Object.freeze({
  documentKind: "GOVERNED_SOURCE",
  authorityState: "CURRENT" as const,
  visibilityClass: "PLATFORM_INTERNAL" as const,
  requiredPlatformPermission: "kairos.knowledge.read.internal",
});

test("K3-D governed ingestion reconciles K3-B prepared content against K3-A checkpoint before mutation", async () => {
  const pipeline = new KairosIngestionPipeline(new StaticAdapter(SOURCE));
  const persistence = new MemoryPersistence();
  const service = new KairosGovernedIngestionService(pipeline, persistence);

  const first = await service.ingest({}, POLICY, "k3d-first");
  assert.equal(first.envelope.status, "READY_NEW_SOURCE");
  assert.equal(first.receipt?.changed, true);
  assert.equal(persistence.commits, 1);

  persistence.checkpoint = Object.freeze({
    sourceId: "10000000-0000-4000-8000-000000000001",
    sourceRevisionId: "20000000-0000-4000-8000-000000000001",
    documentId: "30000000-0000-4000-8000-000000000001",
    revisionKey: first.envelope.revision.revisionKey,
    contentHash: first.envelope.revision.contentHash,
  });
  const unchanged = await service.ingest({}, POLICY, "k3d-unchanged");
  assert.equal(unchanged.envelope.status, "UNCHANGED");
  assert.equal(unchanged.receipt, undefined);
  assert.equal(persistence.commits, 1, "unchanged revisions must not execute a persistence mutation");
});

test("K3-D revision-key reuse with changed content fails before persistence mutation", async () => {
  const changed = Object.freeze({ ...SOURCE, nativeText: "## Espresso\nchanged content under the same revision key" });
  const pipeline = new KairosIngestionPipeline(new StaticAdapter(changed));
  const persistence = new MemoryPersistence();
  persistence.checkpoint = Object.freeze({
    sourceId: "10000000-0000-4000-8000-000000000001",
    sourceRevisionId: "20000000-0000-4000-8000-000000000001",
    revisionKey: SOURCE.revisionKey,
    contentHash: "f".repeat(64),
  });
  const service = new KairosGovernedIngestionService(pipeline, persistence);
  await assert.rejects(() => service.ingest({}, POLICY, "k3d-conflict"), /revision key was reused for different content/);
  assert.equal(persistence.commits, 0);
});

test("K3-D tenant ingestion policy is explicit, ACL-gated and authority weight is derived", () => {
  const normalized = normalizeKairosIngestionPolicy({
    documentKind: "TENANT_MANUAL",
    authorityState: "CERTIFIED",
    visibilityClass: "TENANT_AUTHORIZED",
    tenantId: "20000000-0000-4000-8000-000000000001",
    documentAcl: [{ subjectKind: "TENANT_ROLE", subjectKey: "manager", effect: "ALLOW" }],
  });
  assert.equal(normalized.authorityWeight, 110);
  assert.equal(normalized.documentAcl.length, 1);
  assert.throws(() => normalizeKairosIngestionPolicy({
    documentKind: "TENANT_MANUAL",
    authorityState: "CURRENT",
    visibilityClass: "TENANT_AUTHORIZED",
    tenantId: "20000000-0000-4000-8000-000000000001",
  }), /at least one explicit ALLOW ACL/);
});

test("K3-D PostgreSQL persistence calls only governed security functions and strips duplicate native snapshot material", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const sql = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      if (text.includes("kairos_ingestion_checkpoint")) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          source_id: "10000000-0000-4000-8000-000000000001",
          source_revision_id: "20000000-0000-4000-8000-000000000001",
          document_id: "30000000-0000-4000-8000-000000000001",
          unit_count: 1,
          changed: true,
          ingestion_status: "READY_NEW_SOURCE",
        }],
      };
    },
  };
  const store = new PostgresKairosKnowledgePersistence(sql);
  const pipeline = new KairosIngestionPipeline(new StaticAdapter(SOURCE));
  const prepared = await pipeline.prepare({});
  await store.getCheckpoint(prepared.source.sourceKey);
  await store.commit(prepared, POLICY, "k3d-sql-boundary");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.text.includes("security.kairos_")));
  assert.ok(calls.every((call) => !/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?kairos\./i.test(call.text)));
  const serialized = String(calls[1].values?.[0] ?? "");
  assert.doesNotMatch(serialized, /"nativeText":/);
  assert.doesNotMatch(serialized, /"nativeContentType":/);
  assert.match(serialized, /hybridneedle governed procedure/);
});

test("K3-D hybrid boundary requires explicit model and calls only ACL-first security authority", async () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  const sql = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      return {
        rowCount: 1,
        rows: [{
          node_id: "70000000-0000-4000-8000-000000000001",
          document_id: "60000000-0000-4000-8000-000000000001",
          coordinate: null,
          title: "Hybrid",
          snippet: "hybridneedle",
          lexical_rank: 0.5,
          semantic_distance: 0.1,
          fusion_score: 2,
          authority_state: "CURRENT",
          authority_weight: 100,
          canonical_pointer: "aos://k3d",
          source_anchor: "lines:1-1",
          model_key: "k3d.synthetic.3d",
          matched_lexical: true,
          matched_semantic: true,
        }],
      };
    },
  };
  const search = new PostgresKairosHybridSearch(sql);
  const hits = await search.search({
    query: "hybridneedle",
    model: { modelKey: "k3d.synthetic.3d", providerKey: "synthetic-test", dimensions: 3, distanceMetric: "COSINE" },
    embedding: [1, 0, 0],
    limit: 10,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].matchedLexical, true);
  assert.equal(hits[0].matchedSemantic, true);
  assert.equal(calls[0].text, "SELECT * FROM security.kairos_search_hybrid($1,$2,$3,$4)");
  await assert.rejects(() => search.search({ query: "hybridneedle", model: undefined as any, embedding: [1,0,0] }), /explicit embedding model/);
});
