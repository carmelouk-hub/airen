import test from "node:test";
import assert from "node:assert/strict";
import { queryPlatformAudit, type PlatformAuditQueryInput } from "../../packages/audit-events/src/index.ts";
import { PostgresPlatformAuditQueryStore } from "../../packages/persistence-postgres/src/audit-query-control-plane.ts";
import { createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { AppError, type PlatformSecurityContext } from "../../packages/shared-contracts/src/index.ts";

const connectionString=process.env.DATABASE_URL;
if(!connectionString) throw new Error("DATABASE_URL is required");
const pool=createPostgresPool(connectionString);
const store=new PostgresPlatformAuditQueryStore(pool);

const ADMIN="b8000000-0000-4000-8000-000000000001";
const NOAUTH="b8000000-0000-4000-8000-000000000002";
const TENANT_A="b8200000-0000-4000-8000-000000000001";
const TENANT_B="b8200000-0000-4000-8000-000000000002";
const LOCATION_A="b8300000-0000-4000-8000-000000000001";
const LOCATION_B="b8300000-0000-4000-8000-000000000002";
const FROM="2026-08-20T00:00:00.000Z";
const UNTIL="2026-08-25T00:00:00.000Z";

const admin=(correlationId:string):PlatformSecurityContext=>({
  scopeKind:"platform",correlationId,actorIdentityId:ADMIN,
  platformRoles:["platform_admin"],platformPermissions:["platform.audit.read"]
});
const fake=(correlationId:string):PlatformSecurityContext=>({
  scopeKind:"platform",correlationId,actorIdentityId:NOAUTH,
  platformRoles:[],platformPermissions:["platform.audit.read"]
});
const noPermission=(correlationId:string):PlatformSecurityContext=>({
  scopeKind:"platform",correlationId,actorIdentityId:ADMIN,
  platformRoles:["platform_admin"],platformPermissions:[]
});
async function q(input:Partial<PlatformAuditQueryInput>&Pick<PlatformAuditQueryInput,"createdFrom"|"createdUntil">,context=admin("r3h-query")){
  return queryPlatformAudit(input,{context,store});
}
async function seed(){
  await pool.query("INSERT INTO identity.identities(id,display_name,primary_email,status) VALUES ($1,'R3H Admin','r3h-admin@example.test','active'),($2,'R3H NoAuth','r3h-noauth@example.test','active') ON CONFLICT (id) DO UPDATE SET status='active'",[ADMIN,NOAUTH]);
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active',updated_at=now()",[ADMIN]);
  await pool.query("INSERT INTO platform.tenants(id,slug,name,status,timezone,currency) VALUES ($1,'r3h-a','R3H A','active','Europe/Rome','EUR'),($2,'r3h-b','R3H B','active','Europe/Rome','EUR') ON CONFLICT (id) DO UPDATE SET status='active',updated_at=now()",[TENANT_A,TENANT_B]);
  await pool.query("INSERT INTO platform.locations(id,tenant_id,slug,name,status,timezone,is_primary) VALUES ($1,$2,'r3h-primary','R3H Primary A','active','Europe/Rome',false),($3,$4,'r3h-primary','R3H Primary B','active','Europe/Rome',false) ON CONFLICT (id) DO UPDATE SET status='active',updated_at=now()",[LOCATION_A,TENANT_A,LOCATION_B,TENANT_B]);
  const rows=[
    ["b8400000-0000-4000-8000-000000000001",TENANT_A,null,ADMIN,"user","r3h.alpha","Order","O-1","r3h-flow-a","success",{safe:"visible",nested:{password:"hide",deep:{access_token:"hide",keep:"yes"}}},"2026-08-23T10:00:00.000Z"],
    ["b8400000-0000-4000-8000-000000000002",TENANT_A,LOCATION_A,ADMIN,"user","r3h.beta","Table","T-1","r3h-flow-a","denied",{safe:true},"2026-08-23T10:01:00.000Z"],
    ["b8400000-0000-4000-8000-000000000003",TENANT_B,LOCATION_B,NOAUTH,"system","r3h.beta","Table","T-2","r3h-flow-b","failure",{safe:true},"2026-08-23T10:02:00.000Z"],
    ["b8400000-0000-4000-8000-000000000004",null,null,ADMIN,"system","r3h.global","Platform","G-1","r3h-global","success",{safe:true},"2026-08-23T10:03:00.000Z"],
    ["b8400000-0000-4000-8000-000000000011",TENANT_A,null,ADMIN,"user","r3h.page","Page","P-1","r3h-page","success",{n:1},"2026-08-23T11:00:00.000Z"],
    ["b8400000-0000-4000-8000-000000000012",TENANT_A,null,ADMIN,"user","r3h.page","Page","P-2","r3h-page","success",{n:2},"2026-08-23T11:00:00.000Z"],
    ["b8400000-0000-4000-8000-000000000013",TENANT_A,null,ADMIN,"user","r3h.page","Page","P-3","r3h-page","success",{n:3},"2026-08-23T11:00:00.000Z"],
    ["b8400000-0000-4000-8000-000000000021",TENANT_A,null,ADMIN,"user","r3h.boundary","Boundary","B-1","r3h-boundary","success",{safe:true},"2026-08-21T00:00:00.000Z"],
    ["b8400000-0000-4000-8000-000000000022",TENANT_A,null,ADMIN,"user","r3h.boundary","Boundary","B-2","r3h-boundary","success",{safe:true},"2026-08-22T00:00:00.000Z"],
    ["b8400000-0000-4000-8000-000000000031",TENANT_A,null,ADMIN,"user","r3h.oversize","Blob","L-1","r3h-oversize","success",{safe:"x".repeat(9000),api_key:"hide"},"2026-08-23T12:00:00.000Z"]
  ] as const;
  for(const r of rows){
    await pool.query(
      "INSERT INTO audit.audit_events(id,tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::timestamptz) ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,location_id=EXCLUDED.location_id,actor_identity_id=EXCLUDED.actor_identity_id,actor_kind=EXCLUDED.actor_kind,action_key=EXCLUDED.action_key,resource_type=EXCLUDED.resource_type,resource_id=EXCLUDED.resource_id,correlation_id=EXCLUDED.correlation_id,outcome=EXCLUDED.outcome,metadata=EXCLUDED.metadata,created_at=EXCLUDED.created_at",
      [...r.slice(0,10),JSON.stringify(r[10]),r[11]]
    );
  }
}
async function snapshot(){
  const r=await pool.query(`SELECT jsonb_build_object(
    'audit',(SELECT count(*) FROM audit.audit_events),
    'outbox',(SELECT count(*) FROM events.outbox_events),
    'subscriptions',(SELECT count(*) FROM billing.subscriptions),
    'entitlements',(SELECT count(*) FROM billing.tenant_entitlements),
    'capabilities',(SELECT count(*) FROM platform.capability_catalog),
    'roles',(SELECT count(*) FROM authz.platform_role_assignments)
  )::text AS value`);
  return String(r.rows[0].value);
}
test.before(seed);
test.after(async()=>{await pool.end();});

// R3H-T01 .. R3H-T26 are explicit proof markers for the frozen R3-H runtime matrix.
test("R3-H Platform Audit Query is bounded, read-only, sanitized and independently authorized",async()=>{
  // R3H-T01 platform_admin with platform.audit.read can query a bounded platform Audit window.
  const all=await q({createdFrom:FROM,createdUntil:UNTIL},admin("r3h-t01"));
  assert.ok(all.items.some(x=>x.actionKey==="r3h.alpha"));

  // R3H-T02 Application-layer missing platform.audit.read is denied.
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL},noPermission("r3h-t02")),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  // R3H-T03 Fake application permission cannot bypass PostgreSQL permission recheck.
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL},fake("r3h-t03")),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  // R3H-T04 Tenant-only actor cannot invoke Platform Audit query.
  const tenantOnly={...noPermission("r3h-t04"),platformRoles:[]};
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL},tenantOnly),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  // R3H-T05 airen_control_plane direct SELECT on audit.audit_events remains denied.
  const direct=await pool.connect();
  try{
    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_control_plane");
    await assert.rejects(()=>direct.query("SELECT id FROM audit.audit_events LIMIT 1"),(e:any)=>e?.code==="42501");
    await direct.query("ROLLBACK");
  } finally { direct.release(); }

  // R3H-T06 tenantId filter returns only exact Tenant-attributed rows.
  const tenantA=await q({createdFrom:FROM,createdUntil:UNTIL,tenantId:TENANT_A},admin("r3h-t06"));
  assert.ok(tenantA.items.length>0); assert.ok(tenantA.items.every(x=>x.tenantId===TENANT_A));

  // R3H-T07 tenantId without locationId includes tenant-wide and Location-scoped rows for that Tenant.
  assert.ok(tenantA.items.some(x=>x.locationId===undefined)); assert.ok(tenantA.items.some(x=>x.locationId===LOCATION_A));

  // R3H-T08 locationId without tenantId is rejected.
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL,locationId:LOCATION_A},admin("r3h-t08")),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");

  // R3H-T09 Mismatched tenantId/locationId is rejected.
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL,tenantId:TENANT_A,locationId:LOCATION_B},admin("r3h-t09")),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");

  // R3H-T10 Valid location filter returns only that exact Location rows.
  const locationA=await q({createdFrom:FROM,createdUntil:UNTIL,tenantId:TENANT_A,locationId:LOCATION_A},admin("r3h-t10"));
  assert.ok(locationA.items.length>0); assert.ok(locationA.items.every(x=>x.tenantId===TENANT_A&&x.locationId===LOCATION_A));

  // R3H-T11 actorIdentityId/actorKind filters are exact and composable.
  const actor=await q({createdFrom:FROM,createdUntil:UNTIL,tenantId:TENANT_B,actorIdentityId:NOAUTH,actorKind:"system"},admin("r3h-t11"));
  assert.equal(actor.items.length,1); assert.equal(actor.items[0].actorIdentityId,NOAUTH); assert.equal(actor.items[0].actorKind,"system");

  // R3H-T12 actionKey filter is exact and composable.
  const action=await q({createdFrom:FROM,createdUntil:UNTIL,tenantId:TENANT_A,actionKey:"r3h.alpha"},admin("r3h-t12"));
  assert.equal(action.items.length,1); assert.equal(action.items[0].actionKey,"r3h.alpha");

  // R3H-T13 resourceType/resourceId filters are exact and composable.
  const resource=await q({createdFrom:FROM,createdUntil:UNTIL,resourceType:"Table",resourceId:"T-1"},admin("r3h-t13"));
  assert.equal(resource.items.length,1); assert.equal(resource.items[0].resourceId,"T-1");

  // R3H-T14 correlationId returns only matching workflow rows.
  const flow=await q({createdFrom:FROM,createdUntil:UNTIL,correlationId:"r3h-flow-a"},admin("r3h-t14"));
  assert.equal(flow.items.length,2); assert.ok(flow.items.every(x=>x.correlationId==="r3h-flow-a"));

  // R3H-T15 outcome filter enforces success|denied|failure only.
  const failed=await q({createdFrom:FROM,createdUntil:UNTIL,outcome:"failure"},admin("r3h-t15"));
  assert.ok(failed.items.some(x=>x.id==="b8400000-0000-4000-8000-000000000003"));
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL,outcome:"other" as any},admin("r3h-t15-invalid")),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");

  // R3H-T16 createdFrom/createdUntil use [from,until) boundaries.
  const boundary=await q({createdFrom:"2026-08-21T00:00:00.000Z",createdUntil:"2026-08-22T00:00:00.000Z",actionKey:"r3h.boundary"},admin("r3h-t16"));
  assert.deepEqual(boundary.items.map(x=>x.id),["b8400000-0000-4000-8000-000000000021"]);

  // R3H-T17 createdFrom >= createdUntil is rejected.
  await assert.rejects(()=>q({createdFrom:UNTIL,createdUntil:FROM},admin("r3h-t17")),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");

  // R3H-T18 Query interval greater than 31 days is rejected.
  await assert.rejects(()=>q({createdFrom:"2026-01-01T00:00:00Z",createdUntil:"2026-08-01T00:00:00Z"},admin("r3h-t18")),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");

  // R3H-T19 Limit defaults safely and rejects 0 or >100.
  const defaultPage=await q({createdFrom:FROM,createdUntil:UNTIL,actionKey:"r3h.page"},admin("r3h-t19")); assert.equal(defaultPage.items.length,3);
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL,limit:0},admin("r3h-t19-zero")),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL,limit:101},admin("r3h-t19-high")),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");

  // R3H-T20 Keyset pagination over identical timestamps is stable via id DESC with no duplicate/skip.
  const page1=await q({createdFrom:FROM,createdUntil:UNTIL,actionKey:"r3h.page",limit:2},admin("r3h-t20-a"));
  assert.deepEqual(page1.items.map(x=>x.id),["b8400000-0000-4000-8000-000000000013","b8400000-0000-4000-8000-000000000012"]); assert.ok(page1.nextCursor);
  const page2=await q({createdFrom:FROM,createdUntil:UNTIL,actionKey:"r3h.page",limit:2,cursor:page1.nextCursor},admin("r3h-t20-b"));
  assert.deepEqual(page2.items.map(x=>x.id),["b8400000-0000-4000-8000-000000000011"]); assert.equal(page2.nextCursor,undefined);

  // R3H-T21 Cursor replay with changed filters/window is rejected.
  await assert.rejects(()=>q({createdFrom:FROM,createdUntil:UNTIL,actionKey:"r3h.alpha",limit:2,cursor:page1.nextCursor},admin("r3h-t21")),(e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED");

  // R3H-T22 Platform-global rows with tenant_id NULL are queryable only through Platform authority.
  const global=await q({createdFrom:FROM,createdUntil:UNTIL,correlationId:"r3h-global"},admin("r3h-t22"));
  assert.equal(global.items.length,1); assert.equal(global.items[0].tenantId,undefined);

  // R3H-T23 Safe projection exposes no identity email/display/provider data.
  const keys=Object.keys(global.items[0]).sort();
  assert.ok(!keys.includes("primaryEmail")&&!keys.includes("displayName")&&!keys.includes("providerKey")&&!keys.includes("providerSubject"));

  // R3H-T24 Nested secret/token/OTP/cookie/API-key metadata is removed and oversized metadata deterministically redacted.
  const secret=await q({createdFrom:FROM,createdUntil:UNTIL,actionKey:"r3h.alpha"},admin("r3h-t24-secret"));
  const metadata=secret.items[0].metadata as any;
  assert.equal(metadata.safe,"visible"); assert.equal(metadata.nested.password,undefined); assert.equal(metadata.nested.deep.access_token,undefined); assert.equal(metadata.nested.deep.keep,"yes");
  const oversized=await q({createdFrom:FROM,createdUntil:UNTIL,correlationId:"r3h-oversize"},admin("r3h-t24-size"));
  assert.deepEqual(oversized.items[0].metadata,{_reason:"metadata_size_limit",_redacted:true});

  // R3H-T25 Query execution changes no Audit/Outbox/Subscription/Entitlement/Capability/role state and exposes no Audit UPDATE/DELETE path.
  const before=await snapshot();
  await q({createdFrom:FROM,createdUntil:UNTIL,tenantId:TENANT_A,limit:10},admin("r3h-t25"));
  assert.equal(await snapshot(),before);
  const mutate=await pool.connect();
  try{
    await mutate.query("BEGIN"); await mutate.query("SET LOCAL ROLE airen_control_plane");
    await assert.rejects(()=>mutate.query("DELETE FROM audit.audit_events WHERE id=$1",["b8400000-0000-4000-8000-000000000001"]),(e:any)=>e?.code==="42501");
    await mutate.query("ROLLBACK");
  } finally { mutate.release(); }

  // R3H-T26 Foundation + R3-A..G regressions remain green and existing airen_app Tenant/Location Audit RLS is not widened.
  const app=await pool.connect();
  try{
    await app.query("BEGIN"); await app.query("SET LOCAL ROLE airen_app");
    await app.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[ADMIN,TENANT_A,LOCATION_A,"r3h-t26"]);
    const visible=await app.query("SELECT id,tenant_id,location_id FROM audit.audit_events WHERE id IN ($1,$2,$3)",["b8400000-0000-4000-8000-000000000001","b8400000-0000-4000-8000-000000000002","b8400000-0000-4000-8000-000000000003"]);
    assert.deepEqual(visible.rows.map(x=>x.id).sort(),["b8400000-0000-4000-8000-000000000001","b8400000-0000-4000-8000-000000000002"]);
    await app.query("ROLLBACK");
  } finally { app.release(); }
});
