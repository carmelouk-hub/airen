import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext } from "../../packages/authorization/src/index.ts";
import {
  changeTenantEntitlementConfig, changeTenantEntitlementLimit, changeTenantEntitlementValidity, createEntitlementCatalogEntry,
  expireTenantEntitlement, getEntitlementCatalogEntryAdmin, getTenantEntitlementAdmin, grantTenantEntitlement, listEntitlementCatalogAdmin,
  listTenantEntitlementsAdmin, requireEntitlement, resolveCurrentTenantEntitlements, retireEntitlementCatalogEntry, revokeTenantEntitlement,
  updateEntitlementCatalogEntry
} from "../../packages/entitlements/src/index.ts";
import { PostgresEntitlementControlPlaneStore } from "../../packages/persistence-postgres/src/entitlement-control-plane.ts";
import { createPostgresPool, PostgresFoundationReadStore } from "../../packages/persistence-postgres/src/index.ts";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";

const connectionString=process.env.DATABASE_URL; if(!connectionString) throw new Error("DATABASE_URL is required");
const pool=createPostgresPool(connectionString); const reads=new PostgresFoundationReadStore(pool); const store=new PostgresEntitlementControlPlaneStore(pool);
const ALICE="f0000000-0000-4000-8000-000000000001", NOAUTH="f0000000-0000-4000-8000-000000000002";
const tenants={A:"f1000000-0000-4000-8000-000000000001",B:"f1000000-0000-4000-8000-000000000002",C:"f1000000-0000-4000-8000-000000000003",D:"f1000000-0000-4000-8000-000000000004"} as const;
const locations={A:"f2000000-0000-4000-8000-000000000001",B:"f2000000-0000-4000-8000-000000000002",C:"f2000000-0000-4000-8000-000000000003",D:"f2000000-0000-4000-8000-000000000004"} as const;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms)); const iso=(ms:number)=>new Date(ms).toISOString();
async function seed(){
  await pool.query("INSERT INTO identity.identities(id,display_name,primary_email,status) VALUES ($1,'R3F Admin','r3f-admin@example.test','active'),($2,'R3F Tenant Only','r3f-tenant@example.test','active') ON CONFLICT (id) DO UPDATE SET status='active'",[ALICE,NOAUTH]);
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active',updated_at=now()",[ALICE]);
  for(const key of Object.keys(tenants) as (keyof typeof tenants)[]){const id=tenants[key];await pool.query("INSERT INTO platform.tenants(id,slug,name,status,timezone,currency) VALUES ($1,$2,$3,'active','Europe/Rome','EUR') ON CONFLICT (id) DO UPDATE SET status='active',updated_at=now()",[id,`r3f-${key.toLowerCase()}`,`R3F ${key}`]);await pool.query("INSERT INTO platform.locations(id,tenant_id,slug,name,status,timezone,is_primary) VALUES ($1,$2,'primary','Primary','active','Europe/Rome',true) ON CONFLICT (id) DO UPDATE SET status='active',is_primary=true,updated_at=now()",[locations[key],id]);}
  await pool.query("INSERT INTO authz.tenant_memberships(tenant_id,identity_id,role_key,status) VALUES ($1,$2,'tenant_admin','active') ON CONFLICT (tenant_id,identity_id) DO UPDATE SET role_key='tenant_admin',status='active',updated_at=now()",[tenants.A,NOAUTH]);
  await pool.query("INSERT INTO billing.entitlement_catalog(entitlement_key,description) VALUES ('legacy.r3f_fixture','Legacy source compatibility') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,enabled) VALUES ($1,'legacy.r3f_fixture','r3b-test',true) ON CONFLICT (tenant_id,entitlement_key) DO UPDATE SET source_kind='r3b-test',enabled=true,valid_from=NULL,valid_until=NULL,revoked_at=NULL,expired_at=NULL",[tenants.D]);
}
test.before(seed); test.after(async()=>{await pool.end();});
async function admin(correlationId:string):Promise<PlatformSecurityContext>{return buildPlatformSecurityContext({principal:{identityId:ALICE,providerKey:"synthetic",providerSubject:"r3f-admin",platformRoles:["platform_admin"]},roles:reads,correlationId});}
function tenantContext(k:keyof typeof tenants,correlationId:string):SecurityContext{return {correlationId,actorIdentityId:ALICE,platformRoles:[],platformPermissions:[],tenantId:tenants[k],locationId:locations[k],permissions:[],entitlements:[]};}
async function r3eSnapshot(){const r=await pool.query("SELECT jsonb_build_object('plans',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM billing.plans p),'[]'::jsonb),'subscriptions',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM billing.subscriptions s),'[]'::jsonb))::text AS s");return String(r.rows[0].s);}

test("R3-F Entitlement lifecycle is governed, effective, auditable and separated from R3-E/R3-G",async()=>{
  const beforeR3E=await r3eSnapshot(); const ctx=await admin("r3f-main");
  for(const p of ["platform.entitlements.read","platform.entitlements.catalog.create","platform.entitlements.catalog.update","platform.entitlements.catalog.retire","platform.entitlements.grant","platform.entitlements.revoke","platform.entitlements.expire","platform.entitlements.change_limit","platform.entitlements.change_config","platform.entitlements.change_validity"]) assert.ok(ctx.platformPermissions.includes(p),`missing ${p}`);

  const cat=await createEntitlementCatalogEntry({idempotencyKey:"r3f-advanced-create-v1",entitlementKey:"product.advanced",description:"Advanced"},{context:{...ctx,correlationId:"r3f-cat-create"},unitOfWork:store});
  assert.equal(cat.catalog.status,"active");
  const catReplay=await createEntitlementCatalogEntry({idempotencyKey:"r3f-advanced-create-v1",entitlementKey:"product.advanced",description:"Advanced"},{context:{...ctx,correlationId:"r3f-cat-replay"},unitOfWork:store});
  assert.equal(catReplay.replayed,true); assert.equal(Number((await pool.query("SELECT count(*)::int c FROM audit.audit_events WHERE correlation_id='r3f-cat-replay'")).rows[0].c),0);
  await assert.rejects(()=>createEntitlementCatalogEntry({idempotencyKey:"r3f-advanced-create-v1",entitlementKey:"product.changed",description:"Changed"},{context:{...ctx,correlationId:"r3f-cat-idem-conflict"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="IDEMPOTENCY_CONFLICT");
  assert.equal((await updateEntitlementCatalogEntry({idempotencyKey:"r3f-advanced-update-v1",entitlementKey:"product.advanced",description:"Advanced v2"},{context:{...ctx,correlationId:"r3f-cat-update"},unitOfWork:store})).catalog.description,"Advanced v2");
  const retiredCat=await createEntitlementCatalogEntry({idempotencyKey:"r3f-retired-create-v1",entitlementKey:"product.retired",description:"Retire me"},{context:{...ctx,correlationId:"r3f-retired-create"},unitOfWork:store});
  assert.equal((await retireEntitlementCatalogEntry({idempotencyKey:"r3f-retired-final-v1",entitlementKey:retiredCat.catalog.entitlementKey},{context:{...ctx,correlationId:"r3f-retired-final"},unitOfWork:store})).catalog.status,"retired");
  await assert.rejects(()=>grantTenantEntitlement({idempotencyKey:"r3f-retired-grant-v1",tenantId:tenants.A,entitlementKey:"product.retired",sourceKind:"manual"},{context:{...ctx,correlationId:"r3f-retired-grant"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  assert.equal((await getEntitlementCatalogEntryAdmin("product.advanced",{context:{...ctx,correlationId:"r3f-cat-detail"},queries:store}))?.description,"Advanced v2");
  assert.ok((await listEntitlementCatalogAdmin({status:"active",limit:100},{context:{...ctx,correlationId:"r3f-cat-list"},queries:store})).some(x=>x.entitlementKey==="product.advanced"));

  const grant=await grantTenantEntitlement({idempotencyKey:"r3f-a-grant-v1",tenantId:tenants.A,entitlementKey:"product.advanced",sourceKind:"manual",sourceRef:"governance:r3f",limitValue:10,config:{tier:"gold"}},{context:{...ctx,correlationId:"r3f-a-grant"},unitOfWork:store});
  assert.equal(grant.entitlement.derivedState,"effective"); assert.equal(grant.entitlement.limitValue,10);
  const replay=await grantTenantEntitlement({idempotencyKey:"r3f-a-grant-v1",tenantId:tenants.A,entitlementKey:"product.advanced",sourceKind:"manual",sourceRef:"governance:r3f",limitValue:10,config:{tier:"gold"}},{context:{...ctx,correlationId:"r3f-a-grant-replay"},unitOfWork:store});
  assert.equal(replay.replayed,true); assert.equal(Number((await pool.query("SELECT count(*)::int c FROM billing.entitlement_events WHERE tenant_id=$1 AND entitlement_key='product.advanced' AND event_type='granted'",[tenants.A])).rows[0].c),1);
  await assert.rejects(()=>grantTenantEntitlement({idempotencyKey:"r3f-a-duplicate-v1",tenantId:tenants.A,entitlementKey:"product.advanced",sourceKind:"manual"},{context:{...ctx,correlationId:"r3f-a-duplicate"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  const effectiveA=await resolveCurrentTenantEntitlements({context:tenantContext("A","r3f-resolve-a"),resolver:store}); assert.equal(effectiveA.find(x=>x.entitlementKey==="product.advanced")?.limitValue,10); assert.equal(Object.prototype.hasOwnProperty.call(effectiveA[0]??{},"sourceRef"),false);
  assert.ok((await reads.enabledForTenant(tenants.A)).includes("product.advanced"));
  const enforcement={...tenantContext("A","r3f-enforce"),entitlements:await reads.enabledForTenant(tenants.A)}; assert.doesNotThrow(()=>requireEntitlement(enforcement,"product.advanced"));

  assert.equal((await changeTenantEntitlementLimit({idempotencyKey:"r3f-a-limit-v1",tenantId:tenants.A,entitlementKey:"product.advanced",limitValue:null},{context:{...ctx,correlationId:"r3f-a-limit"},unitOfWork:store})).entitlement.limitValue,undefined);
  assert.deepEqual((await changeTenantEntitlementConfig({idempotencyKey:"r3f-a-config-v1",tenantId:tenants.A,entitlementKey:"product.advanced",config:{mode:"strict"}},{context:{...ctx,correlationId:"r3f-a-config"},unitOfWork:store})).entitlement.config,{mode:"strict"});
  await assert.rejects(()=>changeTenantEntitlementLimit({idempotencyKey:"r3f-a-source-mutate-v1",tenantId:tenants.A,entitlementKey:"product.advanced",sourceKind:"other",limitValue:5},{context:{...ctx,correlationId:"r3f-a-source-mutate"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  const future=Date.now()+400; await changeTenantEntitlementValidity({idempotencyKey:"r3f-a-validity-v1",tenantId:tenants.A,entitlementKey:"product.advanced",validFrom:iso(future),validUntil:iso(future+86400000)},{context:{...ctx,correlationId:"r3f-a-validity"},unitOfWork:store});
  assert.equal((await resolveCurrentTenantEntitlements({context:tenantContext("A","r3f-a-before-start"),resolver:store})).some(x=>x.entitlementKey==="product.advanced"),false); await sleep(500); assert.equal((await resolveCurrentTenantEntitlements({context:tenantContext("A","r3f-a-after-start"),resolver:store})).some(x=>x.entitlementKey==="product.advanced"),true);

  assert.equal((await revokeTenantEntitlement({idempotencyKey:"r3f-a-revoke-v1",tenantId:tenants.A,entitlementKey:"product.advanced",reasonCode:"entitlement.review"},{context:{...ctx,correlationId:"r3f-a-revoke"},unitOfWork:store})).entitlement.derivedState,"revoked");
  const regrant=await grantTenantEntitlement({idempotencyKey:"r3f-a-regrant-v1",tenantId:tenants.A,entitlementKey:"product.advanced",sourceKind:"migration",sourceRef:"migration:r3f",limitValue:25,config:{tier:"platinum"}},{context:{...ctx,correlationId:"r3f-a-regrant"},unitOfWork:store}); assert.equal(regrant.entitlement.sourceKind,"migration"); assert.equal(regrant.entitlement.derivedState,"effective");

  await grantTenantEntitlement({idempotencyKey:"r3f-b-grant-v1",tenantId:tenants.B,entitlementKey:"product.advanced",sourceKind:"manual",validUntil:iso(Date.now()+450)},{context:{...ctx,correlationId:"r3f-b-grant"},unitOfWork:store});
  await assert.rejects(()=>expireTenantEntitlement({idempotencyKey:"r3f-b-expire-early-v1",tenantId:tenants.B,entitlementKey:"product.advanced"},{context:{...ctx,correlationId:"r3f-b-expire-early"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT"); await sleep(550); assert.equal((await expireTenantEntitlement({idempotencyKey:"r3f-b-expire-v1",tenantId:tenants.B,entitlementKey:"product.advanced"},{context:{...ctx,correlationId:"r3f-b-expire"},unitOfWork:store})).entitlement.derivedState,"expired");

  await grantTenantEntitlement({idempotencyKey:"r3f-c-grant-v1",tenantId:tenants.C,entitlementKey:"product.advanced",sourceKind:"manual"},{context:{...ctx,correlationId:"r3f-c-grant"},unitOfWork:store}); await pool.query("UPDATE platform.tenants SET status='suspended',updated_at=now() WHERE id=$1",[tenants.C]);
  assert.equal((await resolveCurrentTenantEntitlements({context:tenantContext("C","r3f-c-suspended-resolve"),resolver:store})).length,0);
  await assert.rejects(()=>changeTenantEntitlementLimit({idempotencyKey:"r3f-c-limit-denied-v1",tenantId:tenants.C,entitlementKey:"product.advanced",limitValue:1},{context:{...ctx,correlationId:"r3f-c-limit-denied"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  assert.equal((await revokeTenantEntitlement({idempotencyKey:"r3f-c-revoke-v1",tenantId:tenants.C,entitlementKey:"product.advanced"},{context:{...ctx,correlationId:"r3f-c-revoke"},unitOfWork:store})).entitlement.derivedState,"revoked");

  assert.ok((await reads.enabledForTenant(tenants.D)).includes("legacy.r3f_fixture"));
  const legacy=await getTenantEntitlementAdmin(tenants.D,"legacy.r3f_fixture",{context:{...ctx,correlationId:"r3f-legacy-detail"},queries:store}); assert.equal(legacy?.sourceKind,"r3b-test"); assert.equal(legacy?.derivedState,"effective");

  const beforeRollback=await getTenantEntitlementAdmin(tenants.A,"product.advanced",{context:{...ctx,correlationId:"r3f-before-rollback"},queries:store});
  const beforeEvents=Number((await pool.query("SELECT count(*)::int c FROM billing.entitlement_events WHERE tenant_id=$1 AND entitlement_key='product.advanced'",[tenants.A])).rows[0].c);
  await pool.query("CREATE OR REPLACE FUNCTION public.r3f_force_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id='r3f-rollback' THEN RAISE EXCEPTION 'R3F_FORCED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$"); await pool.query("CREATE TRIGGER r3f_force_audit_failure BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.r3f_force_audit_failure()");
  try{await assert.rejects(()=>changeTenantEntitlementLimit({idempotencyKey:"r3f-rollback-limit-v1",tenantId:tenants.A,entitlementKey:"product.advanced",limitValue:99},{context:{...ctx,correlationId:"r3f-rollback"},unitOfWork:store}));}finally{await pool.query("DROP TRIGGER IF EXISTS r3f_force_audit_failure ON audit.audit_events");await pool.query("DROP FUNCTION IF EXISTS public.r3f_force_audit_failure()");}
  assert.equal((await getTenantEntitlementAdmin(tenants.A,"product.advanced",{context:{...ctx,correlationId:"r3f-after-rollback"},queries:store}))?.limitValue,beforeRollback?.limitValue); assert.equal(Number((await pool.query("SELECT count(*)::int c FROM billing.entitlement_lifecycle_idempotency WHERE idempotency_key='r3f-rollback-limit-v1'")).rows[0].c),0); assert.equal(Number((await pool.query("SELECT count(*)::int c FROM billing.entitlement_events WHERE tenant_id=$1 AND entitlement_key='product.advanced'",[tenants.A])).rows[0].c),beforeEvents); assert.equal(Number((await pool.query("SELECT count(*)::int c FROM events.outbox_events WHERE correlation_id='r3f-rollback'")).rows[0].c),0);

  const list=await listTenantEntitlementsAdmin({tenantId:tenants.A,limit:100},{context:{...ctx,correlationId:"r3f-list"},queries:store}); assert.ok(list.some(x=>x.entitlementKey==="product.advanced"));
  const tenantOnly=await buildPlatformSecurityContext({principal:{identityId:NOAUTH,providerKey:"synthetic",providerSubject:"r3f-tenant-only",platformRoles:[]},roles:reads,correlationId:"r3f-tenant-only"}); await assert.rejects(()=>grantTenantEntitlement({idempotencyKey:"r3f-tenant-shortcut-v1",tenantId:tenants.A,entitlementKey:"product.advanced",sourceKind:"manual"},{context:tenantOnly,unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
  const forged:PlatformSecurityContext={scopeKind:"platform",correlationId:"r3f-forged",actorIdentityId:NOAUTH,platformRoles:["platform_admin"],platformPermissions:["platform.entitlements.read"]}; await assert.rejects(()=>getEntitlementCatalogEntryAdmin("product.advanced",{context:forged,queries:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
  const client=await pool.connect(); try{await client.query("BEGIN");await client.query("SET LOCAL ROLE airen_control_plane");await assert.rejects(()=>client.query("UPDATE billing.tenant_entitlements SET enabled=false WHERE tenant_id=$1 AND entitlement_key='product.advanced'",[tenants.A]),(e:any)=>e?.code==="42501");await client.query("ROLLBACK");await client.query("BEGIN");await client.query("SET LOCAL ROLE airen_app");await assert.rejects(()=>client.query("SELECT * FROM security.platform_mutate_tenant_entitlement('revoke','r3f-app-denied',$1,'product.advanced',NULL,NULL,NULL,NULL,NULL,NULL,NULL)",[tenants.A]),(e:any)=>e?.code==="42501");await client.query("ROLLBACK");}finally{client.release();}

  const safeD=await resolveCurrentTenantEntitlements({context:tenantContext("D","r3f-safe-d"),resolver:store}); assert.ok(safeD.some(x=>x.entitlementKey==="legacy.r3f_fixture")); const safeB=await resolveCurrentTenantEntitlements({context:tenantContext("B","r3f-safe-b"),resolver:store}); assert.equal(safeB.some(x=>x.entitlementKey==="legacy.r3f_fixture"),false);
  assert.equal(await r3eSnapshot(),beforeR3E);
  const featureTables=Number((await pool.query("SELECT count(*)::int c FROM information_schema.tables WHERE table_schema='billing' AND table_name IN ('features','capabilities','feature_capabilities','entitlement_capabilities')")).rows[0].c); assert.equal(featureTables,0);
  assert.ok(Number((await pool.query("SELECT count(*)::int c FROM billing.entitlement_events WHERE tenant_id = ANY($1::uuid[])",[Object.values(tenants)])).rows[0].c)>=8); assert.ok(Number((await pool.query("SELECT count(*)::int c FROM audit.audit_events WHERE action_key LIKE 'entitlement.%' AND actor_identity_id=$1",[ALICE])).rows[0].c)>=10); assert.ok(Number((await pool.query("SELECT count(*)::int c FROM events.outbox_events WHERE event_type LIKE 'entitlement.%'")).rows[0].c)>=10);
});
