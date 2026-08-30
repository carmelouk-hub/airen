import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const IDS = Object.freeze({
  platformIdentity: "10000000-0000-4000-8000-000000000001",
  tenantIdentity: "10000000-0000-4000-8000-000000000002",
  tenantA: "20000000-0000-4000-8000-000000000001",
  tenantB: "20000000-0000-4000-8000-000000000002",
  membershipA: "30000000-0000-4000-8000-000000000001",
  sourceInternal: "40000000-0000-4000-8000-000000000001",
  sourceTenantA: "40000000-0000-4000-8000-000000000002",
  sourceTenantB: "40000000-0000-4000-8000-000000000003",
  revisionInternal: "50000000-0000-4000-8000-000000000001",
  revisionTenantA: "50000000-0000-4000-8000-000000000002",
  revisionTenantB: "50000000-0000-4000-8000-000000000003",
  docInternal: "60000000-0000-4000-8000-000000000001",
  docTenantA: "60000000-0000-4000-8000-000000000002",
  docTenantB: "60000000-0000-4000-8000-000000000003",
  nodeInternal: "70000000-0000-4000-8000-000000000001",
  nodeTenantAAllow: "70000000-0000-4000-8000-000000000002",
  nodeTenantADeny: "70000000-0000-4000-8000-000000000003",
  nodeTenantB: "70000000-0000-4000-8000-000000000004",
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
      [input.identityId, input.tenantId ?? "", "k3a-runtime-test"],
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

test("K3-A PostgreSQL knowledge ACL resolves corpus before lexical retrieval", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  try {
    await pool.query(`
      INSERT INTO identity.identities(id,display_name,status) VALUES
        ('${IDS.platformIdentity}','K3 Platform Test','active'),
        ('${IDS.tenantIdentity}','K3 Tenant Test','active');

      INSERT INTO platform.tenants(id,slug,name,status) VALUES
        ('${IDS.tenantA}','k3-tenant-a','K3 Tenant A','active'),
        ('${IDS.tenantB}','k3-tenant-b','K3 Tenant B','active');

      INSERT INTO authz.platform_role_assignments(identity_id,role_key,status)
      VALUES ('${IDS.platformIdentity}','k3_test_admin','active');
      INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
      VALUES ('platform','k3_test_admin','kairos.knowledge.read.internal','allow');

      INSERT INTO authz.tenant_memberships(id,tenant_id,identity_id,role_key,status) VALUES
        ('${IDS.membershipA}','${IDS.tenantA}','${IDS.tenantIdentity}','manager','active');

      INSERT INTO kairos.knowledge_sources(id,source_key,source_type,canonical_pointer,title,visibility_class,tenant_id,status) VALUES
        ('${IDS.sourceInternal}','k3a:internal','AIRENOS_INTERNAL','aos://k3a/internal','K3 Internal Source','PLATFORM_INTERNAL',NULL,'CURRENT'),
        ('${IDS.sourceTenantA}','k3a:tenant-a','AIRENOS_INTERNAL','aos://k3a/tenant-a','K3 Tenant A Source','TENANT_AUTHORIZED','${IDS.tenantA}','CURRENT'),
        ('${IDS.sourceTenantB}','k3a:tenant-b','AIRENOS_INTERNAL','aos://k3a/tenant-b','K3 Tenant B Source','TENANT_AUTHORIZED','${IDS.tenantB}','CURRENT');

      INSERT INTO kairos.knowledge_source_revisions(
        id,source_id,revision_key,content_hash,parser_kind,native_text_available,secret_scan_status,contains_secret_values,observed_at,is_current
      ) VALUES
        ('${IDS.revisionInternal}','${IDS.sourceInternal}','r1','${"1".repeat(64)}','native-test',true,'PASS',false,now(),true),
        ('${IDS.revisionTenantA}','${IDS.sourceTenantA}','r1','${"2".repeat(64)}','native-test',true,'PASS',false,now(),true),
        ('${IDS.revisionTenantB}','${IDS.sourceTenantB}','r1','${"3".repeat(64)}','native-test',true,'PASS',false,now(),true);

      INSERT INTO kairos.knowledge_documents(
        id,source_revision_id,title,document_kind,authority_state,authority_weight,visibility_class,tenant_id,source_anchor,required_platform_permission,status
      ) VALUES
        ('${IDS.docInternal}','${IDS.revisionInternal}','Internal Canonical','TEST','CURRENT_CANONICAL',115,'PLATFORM_INTERNAL',NULL,'internal-root','kairos.knowledge.read.internal','ACTIVE'),
        ('${IDS.docTenantA}','${IDS.revisionTenantA}','Tenant A Manual','TEST','CURRENT',100,'TENANT_AUTHORIZED','${IDS.tenantA}','tenant-a-root',NULL,'ACTIVE'),
        ('${IDS.docTenantB}','${IDS.revisionTenantB}','Tenant B Manual','TEST','CURRENT',100,'TENANT_AUTHORIZED','${IDS.tenantB}','tenant-b-root',NULL,'ACTIVE');

      INSERT INTO kairos.knowledge_nodes(id,document_id,node_type,title,body_text,source_anchor) VALUES
        ('${IDS.nodeInternal}','${IDS.docInternal}','PARAGRAPH','Platform Alpha','platformalpha internal governance evidence','internal-node'),
        ('${IDS.nodeTenantAAllow}','${IDS.docTenantA}','PARAGRAPH','Tenant Allow','tenantallow booking procedure for tenant A','tenant-a-allow'),
        ('${IDS.nodeTenantADeny}','${IDS.docTenantA}','PARAGRAPH','Tenant Deny','tenantdeny restricted procedure for tenant A','tenant-a-deny'),
        ('${IDS.nodeTenantB}','${IDS.docTenantB}','PARAGRAPH','Tenant B','tenantbcross private procedure for tenant B','tenant-b-node');

      INSERT INTO kairos.knowledge_acl(document_id,subject_kind,subject_key,effect) VALUES
        ('${IDS.docTenantA}','TENANT_ROLE','manager','ALLOW'),
        ('${IDS.docTenantB}','TENANT_ROLE','manager','ALLOW');
      INSERT INTO kairos.knowledge_acl(node_id,subject_kind,subject_key,effect) VALUES
        ('${IDS.nodeTenantADeny}','TENANT_ROLE','manager','ALLOW'),
        ('${IDS.nodeTenantADeny}','IDENTITY','${IDS.tenantIdentity}','DENY');

      INSERT INTO kairos.knowledge_coordinates(coordinate,node_id,status) VALUES
        ('AOS.KAIROS.K3A.INTERNAL','${IDS.nodeInternal}','ACTIVE'),
        ('AOS.KAIROS.K3A.TENANT_A','${IDS.nodeTenantAAllow}','ACTIVE');
    `);

    await inAppScope(pool, { identityId: IDS.platformIdentity }, async (client) => {
      const result = await client.query("SELECT * FROM security.kairos_search_lexical('platformalpha',10)");
      assert.equal(result.rowCount, 1);
      assert.equal(result.rows[0].node_id, IDS.nodeInternal);
      assert.equal(result.rows[0].coordinate, "AOS.KAIROS.K3A.INTERNAL");
    });

    await inAppScope(pool, { identityId: IDS.tenantIdentity, tenantId: IDS.tenantA }, async (client) => {
      const allowed = await client.query("SELECT * FROM security.kairos_search_lexical('tenantallow',10)");
      assert.equal(allowed.rowCount, 1);
      assert.equal(allowed.rows[0].node_id, IDS.nodeTenantAAllow);

      const deniedNode = await client.query("SELECT * FROM security.kairos_search_lexical('tenantdeny',10)");
      assert.equal(deniedNode.rowCount, 0, "explicit identity DENY must override matching tenant-role ALLOW");

      const crossTenant = await client.query("SELECT * FROM security.kairos_search_lexical('tenantbcross',10)");
      assert.equal(crossTenant.rowCount, 0, "same role name in another tenant must not expand the authorized corpus");

      await assert.rejects(
        () => client.query("SELECT id FROM kairos.knowledge_nodes LIMIT 1"),
        /permission denied|does not exist/i,
        "airen_app must not receive direct raw corpus access",
      );
    });

    await inAppScope(pool, { identityId: IDS.tenantIdentity, tenantId: IDS.tenantB }, async (client) => {
      const result = await client.query("SELECT * FROM security.kairos_search_lexical('tenantbcross',10)");
      assert.equal(result.rowCount, 0, "tenant context without an active tenant membership must fail closed");
    });

    await assert.rejects(
      () => pool.query(
        `INSERT INTO kairos.knowledge_source_revisions(
          source_id,revision_key,content_hash,parser_kind,native_text_available,secret_scan_status,contains_secret_values,observed_at,is_current
        ) VALUES ($1,'secret-rejected',$2,'native-test',true,'REJECTED',false,now(),false)`,
        [IDS.sourceInternal, "4".repeat(64)],
      ),
      /check constraint|violates/i,
      "a source revision that did not pass secret exclusion must not enter the indexed corpus",
    );
  } finally {
    await pool.end();
  }
});
