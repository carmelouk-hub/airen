import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const IDS = Object.freeze({
  platformIdentity: "11000000-0000-4000-8000-000000000001",
  tenantIdentity: "11000000-0000-4000-8000-000000000002",
  tenantA: "21000000-0000-4000-8000-000000000001",
  tenantB: "21000000-0000-4000-8000-000000000002",
  membershipA: "31000000-0000-4000-8000-000000000001",
  sourceInternal: "41000000-0000-4000-8000-000000000001",
  sourceTenantA: "41000000-0000-4000-8000-000000000002",
  sourceTenantB: "41000000-0000-4000-8000-000000000003",
  revisionInternal: "51000000-0000-4000-8000-000000000001",
  revisionTenantA: "51000000-0000-4000-8000-000000000002",
  revisionTenantB: "51000000-0000-4000-8000-000000000003",
  docInternal: "61000000-0000-4000-8000-000000000001",
  docTenantA: "61000000-0000-4000-8000-000000000002",
  docTenantB: "61000000-0000-4000-8000-000000000003",
  nodeInternal: "71000000-0000-4000-8000-000000000001",
  nodeTenantAAllow: "71000000-0000-4000-8000-000000000002",
  nodeTenantADeny: "71000000-0000-4000-8000-000000000003",
  nodeTenantB: "71000000-0000-4000-8000-000000000004",
});

async function inAppScope(
  pool: Pool,
  input: { identityId: string; tenantId?: string },
  fn: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.correlation_id',$3,true)",
      [input.identityId, input.tenantId ?? "", "k3c-pgvector-runtime"],
    );
    await fn(client);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("K3-C pgvector storage, HNSW foundation and ACL-first semantic retrieval", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  try {
    const available = await pool.query<{ available: boolean }>("SELECT security.kairos_vector_runtime_available() AS available");
    assert.equal(available.rows[0]?.available, true, "pgvector CI runtime must expose the vector capability");

    await pool.query(`
      INSERT INTO identity.identities(id,display_name,status) VALUES
        ('${IDS.platformIdentity}','K3-C Platform Test','active'),
        ('${IDS.tenantIdentity}','K3-C Tenant Test','active');

      INSERT INTO platform.tenants(id,slug,name,status) VALUES
        ('${IDS.tenantA}','k3c-tenant-a','K3-C Tenant A','active'),
        ('${IDS.tenantB}','k3c-tenant-b','K3-C Tenant B','active');

      INSERT INTO authz.platform_role_assignments(identity_id,role_key,status)
      VALUES ('${IDS.platformIdentity}','k3c_test_admin','active');
      INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
      VALUES ('platform','k3c_test_admin','kairos.knowledge.read.internal','allow');

      INSERT INTO authz.tenant_memberships(id,tenant_id,identity_id,role_key,status)
      VALUES ('${IDS.membershipA}','${IDS.tenantA}','${IDS.tenantIdentity}','manager','active');

      INSERT INTO kairos.knowledge_sources(id,source_key,source_type,canonical_pointer,title,visibility_class,tenant_id,status) VALUES
        ('${IDS.sourceInternal}','k3c:internal','AIRENOS_INTERNAL','aos://k3c/internal','K3-C Internal Source','PLATFORM_INTERNAL',NULL,'CURRENT'),
        ('${IDS.sourceTenantA}','k3c:tenant-a','AIRENOS_INTERNAL','aos://k3c/tenant-a','K3-C Tenant A Source','TENANT_AUTHORIZED','${IDS.tenantA}','CURRENT'),
        ('${IDS.sourceTenantB}','k3c:tenant-b','AIRENOS_INTERNAL','aos://k3c/tenant-b','K3-C Tenant B Source','TENANT_AUTHORIZED','${IDS.tenantB}','CURRENT');

      INSERT INTO kairos.knowledge_source_revisions(
        id,source_id,revision_key,content_hash,parser_kind,native_text_available,secret_scan_status,contains_secret_values,observed_at,is_current
      ) VALUES
        ('${IDS.revisionInternal}','${IDS.sourceInternal}','k3c-r1','${"1".repeat(64)}','native-test',true,'PASS',false,now(),true),
        ('${IDS.revisionTenantA}','${IDS.sourceTenantA}','k3c-r1','${"2".repeat(64)}','native-test',true,'PASS',false,now(),true),
        ('${IDS.revisionTenantB}','${IDS.sourceTenantB}','k3c-r1','${"3".repeat(64)}','native-test',true,'PASS',false,now(),true);

      INSERT INTO kairos.knowledge_documents(
        id,source_revision_id,title,document_kind,authority_state,authority_weight,visibility_class,tenant_id,source_anchor,required_platform_permission,status
      ) VALUES
        ('${IDS.docInternal}','${IDS.revisionInternal}','K3-C Internal Canonical','TEST','CURRENT_CANONICAL',115,'PLATFORM_INTERNAL',NULL,'internal-root','kairos.knowledge.read.internal','ACTIVE'),
        ('${IDS.docTenantA}','${IDS.revisionTenantA}','K3-C Tenant A Manual','TEST','CURRENT',100,'TENANT_AUTHORIZED','${IDS.tenantA}','tenant-a-root',NULL,'ACTIVE'),
        ('${IDS.docTenantB}','${IDS.revisionTenantB}','K3-C Tenant B Manual','TEST','CURRENT',100,'TENANT_AUTHORIZED','${IDS.tenantB}','tenant-b-root',NULL,'ACTIVE');

      INSERT INTO kairos.knowledge_nodes(id,document_id,node_type,title,body_text,source_anchor) VALUES
        ('${IDS.nodeInternal}','${IDS.docInternal}','PARAGRAPH','Internal Vector Node','internal semantic governance knowledge','internal-node'),
        ('${IDS.nodeTenantAAllow}','${IDS.docTenantA}','PARAGRAPH','Tenant A Vector Node','tenant A semantic procedure','tenant-a-allow'),
        ('${IDS.nodeTenantADeny}','${IDS.docTenantA}','PARAGRAPH','Tenant A Denied Vector Node','tenant A denied semantic procedure','tenant-a-deny'),
        ('${IDS.nodeTenantB}','${IDS.docTenantB}','PARAGRAPH','Tenant B Vector Node','tenant B private semantic procedure','tenant-b-node');

      INSERT INTO kairos.knowledge_acl(document_id,subject_kind,subject_key,effect) VALUES
        ('${IDS.docTenantA}','TENANT_ROLE','manager','ALLOW'),
        ('${IDS.docTenantB}','TENANT_ROLE','manager','ALLOW');
      INSERT INTO kairos.knowledge_acl(node_id,subject_kind,subject_key,effect) VALUES
        ('${IDS.nodeTenantADeny}','TENANT_ROLE','manager','ALLOW'),
        ('${IDS.nodeTenantADeny}','IDENTITY','${IDS.tenantIdentity}','DENY');

      INSERT INTO kairos.knowledge_coordinates(coordinate,node_id,status) VALUES
        ('AOS.KAIROS.K3C.INTERNAL','${IDS.nodeInternal}','ACTIVE'),
        ('AOS.KAIROS.K3C.TENANT_A','${IDS.nodeTenantAAllow}','ACTIVE');

      INSERT INTO kairos.embedding_model_registry(model_key,provider_key,dimensions,distance_metric,status)
      VALUES ('k3.synthetic.3d','synthetic-test',3,'COSINE','ACTIVE');
    `);

    for (const entry of [
      [IDS.nodeInternal, "4".repeat(64), "[0,1,0]"],
      [IDS.nodeTenantAAllow, "5".repeat(64), "[1,0,0]"],
      [IDS.nodeTenantADeny, "6".repeat(64), "[1,0,0]"],
      [IDS.nodeTenantB, "7".repeat(64), "[1,0,0]"],
    ] as const) {
      const stored = await pool.query<{ embedding_id: string }>(
        "SELECT security.kairos_store_embedding($1,$2,$3,$4) AS embedding_id",
        [entry[0], "k3.synthetic.3d", entry[1], entry[2]],
      );
      assert.match(stored.rows[0]?.embedding_id ?? "", /^[0-9a-f-]{36}$/);
    }

    const index = await pool.query<{ index_name: string }>(
      "SELECT security.kairos_build_model_vector_index('k3.synthetic.3d') AS index_name",
    );
    assert.match(index.rows[0]?.index_name ?? "", /^kairos_kemb_[0-9a-f]{16}_hnsw$/);
    const indexDef = await pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_catalog.pg_indexes WHERE schemaname='kairos' AND indexname=$1",
      [index.rows[0]?.index_name],
    );
    assert.equal(indexDef.rowCount, 1);
    assert.match(indexDef.rows[0].indexdef, /USING hnsw/i);
    assert.match(indexDef.rows[0].indexdef, /vector_cosine_ops/i);

    await inAppScope(pool, { identityId: IDS.tenantIdentity, tenantId: IDS.tenantA }, async (client) => {
      const result = await client.query(
        "SELECT * FROM security.kairos_search_semantic('k3.synthetic.3d','[1,0,0]',10)",
      );
      assert.equal(result.rowCount, 1, "semantic retrieval must operate only on the pre-authorized Tenant A corpus");
      assert.equal(result.rows[0].node_id, IDS.nodeTenantAAllow);
      assert.equal(result.rows[0].coordinate, "AOS.KAIROS.K3C.TENANT_A");
      assert.equal(result.rows[0].model_key, "k3.synthetic.3d");
      assert.equal(Number(result.rows[0].semantic_distance), 0);
    });

    await inAppScope(pool, { identityId: IDS.tenantIdentity, tenantId: IDS.tenantA }, async (client) => {
      await assert.rejects(
        () => client.query("SELECT * FROM security.kairos_search_semantic('k3.synthetic.3d','[1,0]',10)"),
        /AIRENOS_KAIROS_EMBEDDING_DIMENSION_MISMATCH/,
      );
    });

    await inAppScope(pool, { identityId: IDS.tenantIdentity, tenantId: IDS.tenantA }, async (client) => {
      await assert.rejects(
        () => client.query("SELECT * FROM security.kairos_search_semantic('unknown.model','[1,0,0]',10)"),
        /AIRENOS_KAIROS_EMBEDDING_MODEL_UNAVAILABLE/,
      );
    });

    await inAppScope(pool, { identityId: IDS.tenantIdentity, tenantId: IDS.tenantA }, async (client) => {
      await assert.rejects(
        () => client.query("SELECT embedding FROM kairos.knowledge_embedding_vectors LIMIT 1"),
        /permission denied|does not exist/i,
        "airen_app must never read the raw global vector corpus",
      );
    });

    await inAppScope(pool, { identityId: IDS.platformIdentity }, async (client) => {
      const result = await client.query(
        "SELECT * FROM security.kairos_search_semantic('k3.synthetic.3d','[0,1,0]',10)",
      );
      assert.equal(result.rowCount, 1);
      assert.equal(result.rows[0].node_id, IDS.nodeInternal);
      assert.equal(result.rows[0].coordinate, "AOS.KAIROS.K3C.INTERNAL");
    });
  } finally {
    await pool.end();
  }
});
