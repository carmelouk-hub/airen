import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import { KairosIngestionPipeline } from "../../packages/kairos/src/ingestion.ts";
import type { KnowledgeSourceAdapter, KairosSourceSnapshot } from "../../packages/kairos/src/source-adapters.ts";
import { KairosGovernedIngestionService, PostgresKairosHybridSearch, PostgresKairosKnowledgePersistence } from "../../packages/kairos/src/runtime.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const IDS = Object.freeze({
  ingestor: "12000000-0000-4000-8000-000000000001",
});

const SNAPSHOT: KairosSourceSnapshot = Object.freeze({
  sourceKey: "github:k3d/runtime:docs/governed.md",
  sourceType: "GITHUB",
  canonicalPointer: "https://github.com/k3d/runtime/blob/main/docs/governed.md",
  title: "governed.md",
  revisionKey: "a".repeat(40),
  observedAt: "2026-08-30T14:40:00.000Z",
  nativeText: "## Governed ingestion\nhybridneedle persistence provenance boundary",
  nativeContentType: "MARKDOWN",
  metadata: Object.freeze({ repository: "k3d/runtime", path: "docs/governed.md" }),
});

class StaticAdapter implements KnowledgeSourceAdapter<Readonly<{}>> {
  readonly snapshot: KairosSourceSnapshot;
  constructor(snapshot: KairosSourceSnapshot) { this.snapshot = snapshot; }
  async read(): Promise<KairosSourceSnapshot> { return this.snapshot; }
}

const POLICY = Object.freeze({
  documentKind: "GOVERNED_SOURCE",
  authorityState: "CURRENT" as const,
  visibilityClass: "PLATFORM_INTERNAL" as const,
  requiredPlatformPermission: "kairos.knowledge.read.internal",
});

async function inAppScope(
  pool: Pool,
  fn: (client: PoolClient) => Promise<void>,
  commit = false,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id','',true),set_config('airen.correlation_id',$2,true)",
      [IDS.ingestor,"k3d-ingestion-runtime"],
    );
    await fn(client);
    await client.query(commit ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("K3-D K3-B pipeline commits through governed K3-A persistence, provenance and lexical authority", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  try {
    await pool.query(`
      INSERT INTO identity.identities(id,display_name,status)
      VALUES ('${IDS.ingestor}','K3-D Ingestor','active');
      INSERT INTO authz.platform_role_assignments(identity_id,role_key,status)
      VALUES ('${IDS.ingestor}','k3d_ingestor','active');
      INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES
        ('platform','k3d_ingestor','kairos.knowledge.ingest','allow'),
        ('platform','k3d_ingestor','kairos.knowledge.read.internal','allow');
    `);

    const pipeline = new KairosIngestionPipeline(new StaticAdapter(SNAPSHOT));

    await inAppScope(pool, async (client) => {
      const service = new KairosGovernedIngestionService(pipeline, new PostgresKairosKnowledgePersistence(client));
      const result = await service.ingest({}, POLICY, "k3d-first-commit");
      assert.equal(result.envelope.status, "READY_NEW_SOURCE");
      assert.equal(result.receipt?.changed, true);
      assert.equal(result.receipt?.unitCount, 1);
    }, true);

    await inAppScope(pool, async (client) => {
      const store = new PostgresKairosKnowledgePersistence(client);
      const checkpoint = await store.getCheckpoint(SNAPSHOT.sourceKey);
      assert.equal(checkpoint?.revisionKey, SNAPSHOT.revisionKey);
      assert.match(checkpoint?.contentHash ?? "", /^[0-9a-f]{64}$/);

      const service = new KairosGovernedIngestionService(pipeline, store);
      const unchanged = await service.ingest({}, POLICY, "k3d-unchanged");
      assert.equal(unchanged.envelope.status, "UNCHANGED");
      assert.equal(unchanged.receipt, undefined);

      const lexical = await client.query("SELECT * FROM security.kairos_search_lexical('hybridneedle',10)");
      assert.equal(lexical.rowCount, 1);
      assert.equal(lexical.rows[0].canonical_pointer, SNAPSHOT.canonicalPointer);
    });

    const provenance = await pool.query(
      "SELECT event_type FROM kairos.knowledge_provenance_events p JOIN kairos.knowledge_sources s ON s.id=p.source_id WHERE s.source_key=$1 ORDER BY p.occurred_at,p.id",
      [SNAPSHOT.sourceKey],
    );
    assert.deepEqual(provenance.rows.map((row) => row.event_type), ["INGESTED","PARSED_NATIVE","INDEXED"]);

    const changedSnapshot = Object.freeze({ ...SNAPSHOT, nativeText: "## Governed ingestion\nchanged content under reused revision key" });
    await inAppScope(pool, async (client) => {
      const service = new KairosGovernedIngestionService(
        new KairosIngestionPipeline(new StaticAdapter(changedSnapshot)),
        new PostgresKairosKnowledgePersistence(client),
      );
      await assert.rejects(() => service.ingest({}, POLICY, "k3d-revision-conflict"), /revision key was reused for different content/);
    });

    await inAppScope(pool, async (client) => {
      const hybrid = new PostgresKairosHybridSearch(client);
      await assert.rejects(() => hybrid.search({
        query: "hybridneedle",
        model: { modelKey: "k3d.synthetic.3d", providerKey: "synthetic-test", dimensions: 3, distanceMetric: "COSINE" },
        embedding: [1,0,0],
      }), /AIRENOS_KAIROS_VECTOR_RUNTIME_UNAVAILABLE/);
    });

    await inAppScope(pool, async (client) => {
      await assert.rejects(
        () => client.query("INSERT INTO kairos.knowledge_nodes(document_id,node_type,body_text,source_anchor) VALUES (gen_random_uuid(),'TEST','forbidden','forbidden')"),
        /permission denied|violates|does not exist/i,
        "airen_app must still have no direct raw Kairos mutation authority",
      );
    });
  } finally {
    await pool.end();
  }
});
