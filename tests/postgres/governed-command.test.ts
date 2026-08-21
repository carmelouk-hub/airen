import test from "node:test";
import assert from "node:assert/strict";
import { resolveRequestSecurityContext } from "../../apps/api/src/security-context.ts";
import { createLocation } from "../../packages/tenant/src/commands/create-location.ts";
import { PostgresFoundationReadStore, PostgresLocationRepositoryAdapter, PostgresLocationUnitOfWork, PostgresTenantRepositoryAdapter, createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const connectionString=process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool=createPostgresPool(connectionString);
const reads=new PostgresFoundationReadStore(pool);
const tenants=new PostgresTenantRepositoryAdapter(reads);
const locations=new PostgresLocationRepositoryAdapter(reads);
const uow=new PostgresLocationUnitOfWork(pool,"airen_app");
const ALPHA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALICE="aaaaaaaa-0000-4000-8000-000000000001";

async function seedAuthority() {
  await pool.query("INSERT INTO authz.permission_registry(permission_key,description) VALUES ('tenant.locations.manage','Manage tenant locations') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('tenant','owner','tenant.locations.manage','allow') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO billing.entitlement_catalog(entitlement_key,description) VALUES ('tenant.multi_location','Multi-location capability') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,enabled) VALUES ($1,'tenant.multi_location','test',true) ON CONFLICT (tenant_id,entitlement_key) DO UPDATE SET enabled=true",[ALPHA]);
}
async function context(correlationId:string) {
  return resolveRequestSecurityContext({hostname:"alpha.example.test",principal:{identityId:ALICE,providerKey:"test",providerSubject:"alice",platformRoles:[]},trustedBaseDomain:"ristoairen.test",correlationId,tenants,locations,domains:reads,memberships:reads,roles:reads,entitlements:reads});
}

test.before(seedAuthority);
test.after(async()=>{await pool.end()});

test("CreateLocation persists mutation, audit and outbox atomically under RLS",async()=>{
  const {context:sc}=await context("b44-fx-010-create-location");
  const location=await createLocation({slug:"annex",name:"Alpha Annex",timezone:"Europe/Rome"},{context:sc,unitOfWork:uow});
  assert.equal(location.tenantId,ALPHA);
  assert.equal(location.slug,"annex");
  const locationRows=await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE id=$1 AND tenant_id=$2",[location.id,ALPHA]);
  const auditRows=await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='b44-fx-010-create-location' AND action_key='tenant.location.create' AND resource_id=$1",[location.id]);
  const outboxRows=await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='b44-fx-010-create-location' AND event_type='tenant.location.created' AND aggregate_id=$1",[location.id]);
  assert.equal(locationRows.rows[0].c,1);
  assert.equal(auditRows.rows[0].c,1);
  assert.equal(outboxRows.rows[0].c,1);
});

test("CreateLocation authorization failure produces no mutation, audit or outbox",async()=>{
  const {context:base}=await context("b44-fx-010-denied");
  const denied={...base,permissions:base.permissions.filter((p)=>p!=="tenant.locations.manage")};
  await assert.rejects(()=>createLocation({slug:"forbidden",name:"Forbidden",timezone:"Europe/Rome"},{context:denied,unitOfWork:uow}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
  const locationRows=await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE tenant_id=$1 AND slug='forbidden'",[ALPHA]);
  const auditRows=await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='b44-fx-010-denied'");
  const outboxRows=await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='b44-fx-010-denied'");
  assert.equal(locationRows.rows[0].c,0);
  assert.equal(auditRows.rows[0].c,0);
  assert.equal(outboxRows.rows[0].c,0);
});
