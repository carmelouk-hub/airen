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
  nodeInternalRoot: "71000000-0000-4000-8000-000000000001",
  nodeInternalChild: "71000000-0000-4000-8000-000000000002",
  nodeTenantARoot: "71000000-0000-4000-8000-000000000003",
  nodeTenantAChild: "71000000-0000-4000-8000-000000000004",
  nodeTenantADeny: "71000000-0000-4000-8000-000000000005",
  nodeTenantB: "71000000-0000-4000-8000-000000000006",
  relationInternal: "81000000-0000-4000-8000-000000000001",
  relationTenantA: "81000000-0000-4000-8000-000000000002",
  relationDenied: "81000000-0000-4000-8000-000000000003",
  relationCrossTenant: "81000000-0000-4000-8000-000000000004",
  eventTenantA: "91000000-0000-4000-8000-000000000001",
  eventTenantDeny: "91000000-0000-4000-8000-000000000002",
});

async function inAppScope(
  pool: Pool,
  input: { identityId: string; tenantId?: string },
  fn: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
      [input.identityId,input.tenantId ?? "","","k4a-graph-runtime"],
    );
    await fn(client);
    await client.query("ROLLBACK");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}

test("K4-A secured graph exposes only authorized nodes and edges", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  try {
    await pool.query(`
      INSERT INTO identity.identities(id,display_name,status) VALUES
        ('${IDS.platformIdentity}','K4 Platform Test','active'),
        ('${IDS.tenantIdentity}','K4 Tenant Test','active');

      INSERT INTO platform.tenants(id,slug,name,status) VALUES
        ('${IDS.tenantA}','k4-tenant-a','K4 Tenant A','active'),
        ('${IDS.tenantB}','k4-tenant-b','K4 Tenant B','active');

      INSERT INTO authz.platform_role_assignments(identity_id,role_key,status)
      VALUES ('${IDS.platformIdentity}','k4_test_admin','active');
      INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
      VALUES ('platform','k4_test_admin','kairos.knowledge.read.internal','allow');

      INSERT INTO authz.tenant_memberships(id,tenant_id,identity_id,role_key,status)
      VALUES ('${IDS.membershipA}','${IDS.tenantA}','${IDS.tenantIdentity}','manager','active');

      INSERT INTO kairos.knowledge_sources(id,source_key,source_type,canonical_pointer,title,visibility_class,tenant_id,status) VALUES
        ('${IDS.sourceInternal}','k4a:internal','AIRENOS_INTERNAL','aos://k4/internal','K4 Internal Source','PLATFORM_INTERNAL',NULL,'CURRENT'),
        ('${IDS.sourceTenantA}','k4a:tenant-a','AIRENOS_INTERNAL','aos://k4/tenant-a','K4 Tenant A Source','TENANT_AUTHORIZED','${IDS.tenantA}','CURRENT'),
        ('${IDS.sourceTenantB}','k4a:tenant-b','AIRENOS_INTERNAL','aos://k4/tenant-b','K4 Tenant B Source','TENANT_AUTHORIZED','${IDS.tenantB}','CURRENT');

      INSERT INTO kairos.knowledge_source_revisions(
        id,source_id,revision_key,content_hash,parser_kind,native_text_available,secret_scan_status,contains_secret_values,observed_at,is_current
      ) VALUES
        ('${IDS.revisionInternal}','${IDS.sourceInternal}','r1','${"a".repeat(64)}','native-test',true,'PASS',false,now(),true),
        ('${IDS.revisionTenantA}','${IDS.sourceTenantA}','r1','${"b".repeat(64)}','native-test',true,'PASS',false,now(),true),
        ('${IDS.revisionTenantB}','${IDS.sourceTenantB}','r1','${"c".repeat(64)}','native-test',true,'PASS',false,now(),true);

      INSERT INTO kairos.knowledge_documents(
        id,source_revision_id,title,document_kind,authority_state,authority_weight,visibility_class,tenant_id,source_anchor,required_platform_permission,status
      ) VALUES
        ('${IDS.docInternal}','${IDS.revisionInternal}','K4 Internal','TEST','CURRENT_CANONICAL',115,'PLATFORM_INTERNAL',NULL,'internal-root','kairos.knowledge.read.internal','ACTIVE'),
        ('${IDS.docTenantA}','${IDS.revisionTenantA}','K4 Tenant A','TEST','CURRENT',100,'TENANT_AUTHORIZED','${IDS.tenantA}','tenant-a-root',NULL,'ACTIVE'),
        ('${IDS.docTenantB}','${IDS.revisionTenantB}','K4 Tenant B','TEST','CURRENT',100,'TENANT_AUTHORIZED','${IDS.tenantB}','tenant-b-root',NULL,'ACTIVE');

      INSERT INTO kairos.knowledge_nodes(id,document_id,node_type,title,body_text,source_anchor) VALUES
        ('${IDS.nodeInternalRoot}','${IDS.docInternal}','DOMAIN','Kairos','internal kairos root','internal-root-node'),
        ('${IDS.nodeInternalChild}','${IDS.docInternal}','MODULE','Kairos Map','internal kairos map','internal-child-node'),
        ('${IDS.nodeTenantARoot}','${IDS.docTenantA}','MODULE','Booking Learn','tenant A booking learn','tenant-a-root-node'),
        ('${IDS.nodeTenantAChild}','${IDS.docTenantA}','PROCEDURE','Booking Hold Learn','tenant A booking hold learn','tenant-a-child-node'),
        ('${IDS.nodeTenantADeny}','${IDS.docTenantA}','PROCEDURE','Restricted Learn','tenant A denied knowledge','tenant-a-deny-node'),
        ('${IDS.nodeTenantB}','${IDS.docTenantB}','PROCEDURE','Tenant B Private','tenant B private knowledge','tenant-b-node');

      INSERT INTO kairos.knowledge_acl(document_id,subject_kind,subject_key,effect) VALUES
        ('${IDS.docTenantA}','TENANT_ROLE','manager','ALLOW'),
        ('${IDS.docTenantB}','TENANT_ROLE','manager','ALLOW');
      INSERT INTO kairos.knowledge_acl(node_id,subject_kind,subject_key,effect) VALUES
        ('${IDS.nodeTenantADeny}','TENANT_ROLE','manager','ALLOW'),
        ('${IDS.nodeTenantADeny}','IDENTITY','${IDS.tenantIdentity}','DENY');

      INSERT INTO kairos.knowledge_coordinates(coordinate,node_id,status) VALUES
        ('AOS.KAIROS.K4','${IDS.nodeInternalRoot}','ACTIVE'),
        ('AOS.KAIROS.K4.MAP','${IDS.nodeInternalChild}','ACTIVE'),
        ('AOS.RISTOAIREN.LEARN','${IDS.nodeTenantARoot}','ACTIVE'),
        ('AOS.RISTOAIREN.LEARN.BOOKING','${IDS.nodeTenantAChild}','ACTIVE'),
        ('AOS.RISTOAIREN.LEARN.RESTRICTED','${IDS.nodeTenantADeny}','ACTIVE'),
        ('AOS.RISTOAIREN.LEARN.TENANT_B','${IDS.nodeTenantB}','ACTIVE');

      INSERT INTO kairos.knowledge_relations(id,from_node_id,to_node_id,relation_type,confidence,metadata) VALUES
        ('${IDS.relationInternal}','${IDS.nodeInternalRoot}','${IDS.nodeInternalChild}','IMPLEMENTS',1.0,'{}'),
        ('${IDS.relationTenantA}','${IDS.nodeTenantARoot}','${IDS.nodeTenantAChild}','DERIVED_FROM',1.0,'{}'),
        ('${IDS.relationDenied}','${IDS.nodeTenantARoot}','${IDS.nodeTenantADeny}','DERIVED_FROM',1.0,'{}'),
        ('${IDS.relationCrossTenant}','${IDS.nodeTenantAChild}','${IDS.nodeTenantB}','MIRRORS',1.0,'{}');

      INSERT INTO kairos.knowledge_provenance_events(id,event_type,document_id,node_id,correlation_id,metadata,occurred_at) VALUES
        ('${IDS.eventTenantA}','INDEXED','${IDS.docTenantA}','${IDS.nodeTenantAChild}','k4a-visible-event','{}',now()),
        ('${IDS.eventTenantDeny}','INDEXED','${IDS.docTenantA}','${IDS.nodeTenantADeny}','k4a-hidden-event','{}',now());
    `);

    await inAppScope(pool,{ identityId: IDS.platformIdentity },async (client) => {
      const nodes=await client.query("SELECT * FROM security.kairos_graph_nodes('AOS.KAIROS.K4',20)");
      assert.equal(nodes.rowCount,2);
      assert.deepEqual(new Set(nodes.rows.map((r)=>r.node_id)),new Set([IDS.nodeInternalRoot,IDS.nodeInternalChild]));
      const edges=await client.query("SELECT * FROM security.kairos_graph_edges('AOS.KAIROS.K4',20,40)");
      assert.ok(edges.rows.some((r)=>r.relation_type==='IMPLEMENTS'));
      assert.ok(edges.rows.some((r)=>r.relation_type==='COORDINATE_PARENT'));
    });

    await inAppScope(pool,{ identityId: IDS.tenantIdentity,tenantId: IDS.tenantA },async (client) => {
      const nodes=await client.query("SELECT * FROM security.kairos_graph_nodes('AOS.RISTOAIREN.LEARN',20)");
      assert.deepEqual(new Set(nodes.rows.map((r)=>r.node_id)),new Set([IDS.nodeTenantARoot,IDS.nodeTenantAChild]));
      assert.ok(!nodes.rows.some((r)=>r.node_id===IDS.nodeTenantADeny));
      assert.ok(!nodes.rows.some((r)=>r.node_id===IDS.nodeTenantB));

      const edges=await client.query("SELECT * FROM security.kairos_graph_edges('AOS.RISTOAIREN.LEARN',20,40)");
      assert.ok(edges.rows.some((r)=>r.from_node_id===IDS.nodeTenantARoot && r.to_node_id===IDS.nodeTenantAChild));
      assert.ok(!edges.rows.some((r)=>r.to_node_id===IDS.nodeTenantADeny),"edge to explicitly denied node must not leak");
      assert.ok(!edges.rows.some((r)=>r.to_node_id===IDS.nodeTenantB),"cross-tenant edge endpoint must not leak");

      const visibleDetail=await client.query("SELECT * FROM security.kairos_graph_node_detail($1)",[IDS.nodeTenantAChild]);
      assert.equal(visibleDetail.rowCount,1);
      const deniedDetail=await client.query("SELECT * FROM security.kairos_graph_node_detail($1)",[IDS.nodeTenantADeny]);
      assert.equal(deniedDetail.rowCount,0,"unauthorized and missing node must be indistinguishable");

      const timeline=await client.query("SELECT * FROM security.kairos_graph_timeline($1,20)",[IDS.nodeTenantAChild]);
      assert.equal(timeline.rowCount,1);
      assert.equal(timeline.rows[0].correlation_id,'k4a-visible-event');
      const deniedTimeline=await client.query("SELECT * FROM security.kairos_graph_timeline($1,20)",[IDS.nodeTenantADeny]);
      assert.equal(deniedTimeline.rowCount,0);

      await assert.rejects(
        () => client.query("SELECT id FROM kairos.knowledge_relations LIMIT 1"),
        /permission denied|does not exist/i,
        "airen_app must not receive direct graph-table access",
      );
    });

    await inAppScope(pool,{ identityId: IDS.tenantIdentity,tenantId: IDS.tenantB },async (client) => {
      const nodes=await client.query("SELECT * FROM security.kairos_graph_nodes(NULL,50)");
      assert.equal(nodes.rowCount,0,"tenant context without active membership must fail closed");
    });
  } finally {
    await pool.end();
  }
});
