import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { KairosIngestionPipeline } from "../../packages/kairos/src/ingestion.ts";
import type { KnowledgeSourceAdapter, KairosSourceSnapshot } from "../../packages/kairos/src/source-adapters.ts";
import { KairosGovernedIngestionService, PostgresKairosHybridSearch, PostgresKairosKnowledgePersistence } from "../../packages/kairos/src/runtime.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const IDS = Object.freeze({
  ingestor: "13000000-0000-4000-8000-000000000001",
  tenantUser: "13000000-0000-4000-8000-000000000002",
  tenantA: "23000000-0000-4000-8000-000000000001",
  tenantB: "23000000-0000-4000-8000-000000000002",
  membershipA: "33000000-0000-4000-8000-000000000001",
});

function snapshot(key: "a" | "b"): KairosSourceSnapshot {
  const tenant = key === "a" ? "tenant-a" : "tenant-b";
  return Object.freeze({
    sourceKey: `github:k3d/vector:${tenant}.md`,
    sourceType: "GITHUB" as const,
    canonicalPointer: `https://github.com/k3d/vector/blob/main/${tenant}.md`,
    title: `${tenant}.md`,
    revisionKey: (key === "a" ? "b" : "c").repeat(40),
    observedAt: "2026-08-30T14:45:00.000Z",
    nativeText: key === "a" ? "## Tenant A\nhybridneedle authorized semantic knowledge" : "## Tenant B\nhybridneedle cross tenant private knowledge",
    nativeContentType: "MARKDOWN" as const,
    metadata: Object.freeze({ tenant }),
  });
}

class StaticAdapter implements KnowledgeSourceAdapter<Readonly<{}>> {
  readonly value: KairosSourceSnapshot;
  constructor(value: KairosSourceSnapshot) { this.value = value; }
  async read(): Promise<KairosSourceSnapshot> { return this.value; }
}

async function inAppScope(
  pool: Pool,
  input: { identityId: string; tenantId?: string },
  fn: (client: PoolClient) => Promise<void>,
  commit = false,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.correlation_id',$3,true)",
      [input.identityId,input.tenantId ?? "","k3d-hybrid-runtime"],
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

function policy(tenantId: string) {
  return Object.freeze({
    documentKind: "TENANT_MANUAL",
    authorityState: "CURRENT" as const,
    visibilityClass: "TENANT_AUTHORIZED" as const,
    tenantId,
    documentAcl: Object.freeze([{ subjectKind: "TENANT_ROLE" as const, subjectKey: "manager", effect: "ALLOW" as const }]),
  });
}

test("K3-D committed tenant knowledge flows into hybrid lexical+semantic retrieval without cross-tenant expansion", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  try {
    const available = await pool.query<{ available: boolean }>("SELECT security.kairos_vector_runtime_available() AS available");
    assert.equal(available.rows[0]?.available, true);

    await pool.query(`
      INSERT INTO identity.identities(id,display_name,status) VALUES
        ('${IDS.ingestor}','K3-D Vector Ingestor','active'),
        ('${IDS.tenantUser}','K3-D Tenant User','active');
      INSERT INTO platform.tenants(id,slug,name,status) VALUES
        ('${IDS.tenantA}','k3d-vector-a','K3-D Vector A','active'),
        ('${IDS.tenantB}','k3d-vector-b','K3-D Vector B','active');
      INSERT INTO authz.platform_role_assignments(identity_id,role_key,status)
      VALUES ('${IDS.ingestor}','k3d_vector_ingestor','active');
      INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
      VALUES ('platform','k3d_vector_ingestor','kairos.knowledge.ingest','allow');
      INSERT INTO authz.tenant_memberships(id,tenant_id,identity_id,role_key,status)
      VALUES ('${IDS.membershipA}','${IDS.tenantA}','${IDS.tenantUser}','manager','active');
    `);

    for (const entry of [
      { source: snapshot("a"), tenantId: IDS.tenantA, correlation: "k3d-vector-a" },
      { source: snapshot("b"), tenantId: IDS.tenantB, correlation: "k3d-vector-b" },
    ]) {
      await inAppScope(pool, { identityId: IDS.ingestor }, async (client) => {
        const service = new KairosGovernedIngestionService(
          new KairosIngestionPipeline(new StaticAdapter(entry.source)),
          new PostgresKairosKnowledgePersistence(client),
        );
        const result = await service.ingest({}, policy(entry.tenantId), entry.correlation);
        assert.equal(result.receipt?.changed, true);
      }, true);
    }

    await pool.query(`
      INSERT INTO kairos.embedding_model_registry(model_key,provider_key,dimensions,distance_metric,status)
      VALUES ('k3d.synthetic.3d','synthetic-test',3,'COSINE','ACTIVE');
    `);

    const nodes = await pool.query<{ node_id: string; source_key: string; body_text: string }>(`
      SELECT n.id AS node_id,s.source_key,n.body_text
      FROM kairos.knowledge_nodes n
      JOIN kairos.knowledge_documents d ON d.id=n.document_id
      JOIN kairos.knowledge_source_revisions r ON r.id=d.source_revision_id
      JOIN kairos.knowledge_sources s ON s.id=r.source_id
      WHERE s.source_key IN ('github:k3d/vector:tenant-a.md','github:k3d/vector:tenant-b.md')
      ORDER BY s.source_key
    `);
    assert.equal(nodes.rowCount, 2);
    for (const row of nodes.rows) {
      const contentHash = createHash("sha256").update(row.body_text,"utf8").digest("hex");
      await pool.query(
        "SELECT security.kairos_store_embedding($1,'k3d.synthetic.3d',$2,'[1,0,0]')",
        [row.node_id,contentHash],
      );
    }

    await inAppScope(pool, { identityId: IDS.tenantUser, tenantId: IDS.tenantA }, async (client) => {
      const hybrid = new PostgresKairosHybridSearch(client);
      const hits = await hybrid.search({
        query: "hybridneedle",
        model: { modelKey: "k3d.synthetic.3d", providerKey: "synthetic-test", dimensions: 3, distanceMetric: "COSINE" },
        embedding: [1,0,0],
        limit: 10,
      });
      assert.equal(hits.length, 1, "hybrid retrieval must not expand beyond Tenant A authorized corpus");
      assert.equal(hits[0].canonicalPointer, snapshot("a").canonicalPointer);
      assert.equal(hits[0].matchedLexical, true);
      assert.equal(hits[0].matchedSemantic, true);
      assert.equal(hits[0].fusionScore, 2);
    });

    await inAppScope(pool, { identityId: IDS.tenantUser, tenantId: IDS.tenantB }, async (client) => {
      const hybrid = new PostgresKairosHybridSearch(client);
      const hits = await hybrid.search({
        query: "hybridneedle",
        model: { modelKey: "k3d.synthetic.3d", providerKey: "synthetic-test", dimensions: 3, distanceMetric: "COSINE" },
        embedding: [1,0,0],
      });
      assert.equal(hits.length, 0, "tenant context without active membership must fail closed in both retrieval channels");
    });
  } finally {
    await pool.end();
  }
});
