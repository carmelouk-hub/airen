import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext } from "../../packages/authorization/src/index.ts";
import {
activatePlan, activateSubscription, cancelSubscription, changeSubscriptionPlan, createPlan, createSubscription, expireSubscription,
getPlanAdmin, getSubscriptionAdmin, listPlansAdmin, listSubscriptionsAdmin, reactivateSubscription, resolveCurrentTenantSubscription,
retirePlan, scheduleSubscriptionCancellation, suspendSubscription, unscheduleSubscriptionCancellation, updateDraftPlan
} from "../../packages/billing/src/index.ts";
import { createPostgresPool, PostgresFoundationReadStore } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresBillingControlPlaneStore } from "../../packages/persistence-postgres/src/billing-control-plane.ts";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const reads = new PostgresFoundationReadStore(pool);
const store = new PostgresBillingControlPlaneStore(pool);
const ALICE = "e0000000-0000-4000-8000-000000000001";
const NOAUTH = "e0000000-0000-4000-8000-000000000002";
const tenants = {
A:"e1000000-0000-4000-8000-000000000001", B:"e1000000-0000-4000-8000-000000000002", C:"e1000000-0000-4000-8000-000000000003",
D:"e1000000-0000-4000-8000-000000000004", E:"e1000000-0000-4000-8000-000000000005", F:"e1000000-0000-4000-8000-000000000006",
G:"e1000000-0000-4000-8000-000000000007", H:"e1000000-0000-4000-8000-000000000008", I:"e1000000-0000-4000-8000-000000000009"
} as const;
const locations = Object.fromEntries(Object.entries(tenants).map(([k,v],i)=>[k,`e2000000-0000-4000-8${String(i+1).padStart(3,"0")}-00000000000${i+1}`])) as Record<keyof typeof tenants,string>;
async function seed() {
await pool.query("INSERT INTO identity.identities(id,display_name,primary_email,status) VALUES ($1,'R3E Admin','r3e-admin@example.test','active'),($2,'R3E Tenant Admin Only','r3e-tenant-only@example.test','active') ON CONFLICT (id) DO UPDATE SET status='active'",[ALICE,NOAUTH]);
await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active',updated_at=now()",[ALICE]);
for (const [key,id] of Object.entries(tenants)) {
await pool.query("INSERT INTO platform.tenants(id,slug,name,status,timezone,currency) VALUES ($1,$2,$3,'active','Europe/Rome','EUR') ON CONFLICT (id) DO UPDATE SET status='active',updated_at=now()",[id,`r3e-${key.toLowerCase()}`,`R3E Tenant ${key}`]);
await pool.query("INSERT INTO platform.locations(id,tenant_id,slug,name,status,timezone,is_primary) VALUES ($1,$2,'primary','Primary','active','Europe/Rome',true) ON CONFLICT (id) DO UPDATE SET status='active',is_primary=true,updated_at=now()",[locations[key as keyof typeof tenants],id]);
}
await pool.query("INSERT INTO authz.tenant_memberships(tenant_id,identity_id,role_key,status) VALUES ($1,$2,'tenant_admin','active') ON CONFLICT (tenant_id,identity_id) DO UPDATE SET role_key='tenant_admin',status='active',updated_at=now()",[tenants.F,NOAUTH]);
}
test.before(seed);
test.after(async()=>{ await pool.end(); });
async function admin(correlationId: string): Promise<PlatformSecurityContext> {
return buildPlatformSecurityContext({principal:{identityId:ALICE,providerKey:"synthetic",providerSubject:"r3e-admin",platformRoles:["platform_admin"]},roles:reads,correlationId});
}
function tenantContext(tenantId: string, locationId: string, correlationId: string): SecurityContext {
return {correlationId,actorIdentityId:ALICE,platformRoles:[],platformPermissions:[],tenantId,locationId,permissions:[],entitlements:[]};
}
const iso = (ms:number)=>new Date(ms).toISOString();
const sleep = (ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));
async function entitlementSnapshot() {
const r=await pool.query("SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tenant_id,x.entitlement_key),'[]'::jsonb)::text AS snapshot FROM billing.tenant_entitlements x");
return String(r.rows[0].snapshot);
}
async function createActivePlan(slug:string, defaultTrialDays=0) {
const ctx=await admin(`r3e-plan-${slug}`);
const draft=await createPlan({idempotencyKey:`r3e-plan-${slug}-create`,slug,name:slug.toUpperCase(),currency:"EUR",priceMinor:defaultTrialDays?25000:12000,billingPeriod:"monthly",defaultTrialDays},{context:ctx,unitOfWork:store});
const active=await activatePlan({idempotencyKey:`r3e-plan-${slug}-activate`,planId:draft.plan.id},{context:{...ctx,correlationId:`r3e-plan-${slug}-activate`},unitOfWork:store});
return active.plan;
}
test("R3-E Plan and Subscription lifecycle is governed, auditable, isolated and fail-closed",async()=>{
const entitlementBefore=await entitlementSnapshot();
const ctx=await admin("r3e-main");
for (const permission of [
"platform.plans.read","platform.plans.create","platform.plans.update","platform.plans.activate","platform.plans.retire",
"platform.subscriptions.read","platform.subscriptions.create","platform.subscriptions.change_plan","platform.subscriptions.activate","platform.subscriptions.suspend",
"platform.subscriptions.reactivate","platform.subscriptions.schedule_cancel","platform.subscriptions.unschedule_cancel","platform.subscriptions.cancel","platform.subscriptions.expire"
]) assert.ok(ctx.platformPermissions.includes(permission),`missing ${permission}`);
const draft=await createPlan({idempotencyKey:"r3e-starter-create-v1",slug:"starter-r3e",name:"Starter",description:"Draft",currency:"eur",priceMinor:9900,billingPeriod:"monthly",defaultTrialDays:0},{context:{...ctx,correlationId:"r3e-starter-create"},unitOfWork:store});
assert.equal(draft.plan.status,"draft");
assert.equal(draft.plan.currency,"EUR");
const replay=await createPlan({idempotencyKey:"r3e-starter-create-v1",slug:"starter-r3e",name:"Starter",description:"Draft",currency:"eur",priceMinor:9900,billingPeriod:"monthly",defaultTrialDays:0},{context:{...ctx,correlationId:"r3e-starter-create-replay"},unitOfWork:store});
assert.equal(replay.replayed,true);
assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3e-starter-create-replay'")).rows[0].c),0);
await assert.rejects(()=>createPlan({idempotencyKey:"r3e-starter-create-v1",slug:"starter-r3e-changed",name:"Changed",currency:"EUR",priceMinor:9900,billingPeriod:"monthly"},{context:{...ctx,correlationId:"r3e-plan-idem-conflict"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="IDEMPOTENCY_CONFLICT");
const updated=await updateDraftPlan({idempotencyKey:"r3e-starter-update-v1",planId:draft.plan.id,name:"Starter Plus",description:null,currency:"EUR",priceMinor:10900,billingPeriod:"monthly",defaultTrialDays:0},{context:{...ctx,correlationId:"r3e-starter-update"},unitOfWork:store});
assert.equal(updated.plan.name,"Starter Plus");
const starter=(await activatePlan({idempotencyKey:"r3e-starter-activate-v1",planId:draft.plan.id},{context:{...ctx,correlationId:"r3e-starter-activate"},unitOfWork:store})).plan;
assert.equal(starter.status,"active");
await assert.rejects(()=>updateDraftPlan({idempotencyKey:"r3e-starter-illegal-update-v1",planId:starter.id,name:"Rewrite",currency:"EUR",priceMinor:1,billingPeriod:"monthly",defaultTrialDays:0},{context:{...ctx,correlationId:"r3e-starter-illegal-update"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
const trialPlan=await createActivePlan("trial-r3e",3);
const retiredDraft=await createPlan({idempotencyKey:"r3e-retired-create-v1",slug:"retired-r3e",name:"Retired",currency:"EUR",priceMinor:5000,billingPeriod:"monthly"},{context:{...ctx,correlationId:"r3e-retired-create"},unitOfWork:store});
await activatePlan({idempotencyKey:"r3e-retired-activate-v1",planId:retiredDraft.plan.id},{context:{...ctx,correlationId:"r3e-retired-activate"},unitOfWork:store});
const retired=(await retirePlan({idempotencyKey:"r3e-retired-retire-v1",planId:retiredDraft.plan.id},{context:{...ctx,correlationId:"r3e-retired-retire"},unitOfWork:store})).plan;
assert.equal(retired.status,"retired");
await assert.rejects(()=>createSubscription({idempotencyKey:"r3e-retired-sub-v1",tenantId:tenants.G,planId:retired.id,startsAt:iso(Date.now()-1000),currentPeriodEnd:iso(Date.now()+86400000)},{context:{...ctx,correlationId:"r3e-retired-sub"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
const planDetail=await getPlanAdmin(starter.id,{context:{...ctx,correlationId:"r3e-plan-detail"},queries:store});
assert.equal(planDetail?.slug,"starter-r3e");
const plans=await listPlansAdmin({status:"active",limit:100},{context:{...ctx,correlationId:"r3e-plan-list"},queries:store});
assert.ok(plans.some((p)=>p.id===starter.id));
const now=Date.now();
const subA=(await createSubscription({idempotencyKey:"r3e-sub-a-create-v1",tenantId:tenants.A,planId:starter.id,startsAt:iso(now-86400000),currentPeriodEnd:iso(now+30*86400000)},{context:{...ctx,correlationId:"r3e-sub-a-create"},unitOfWork:store})).subscription;
assert.equal(subA.status,"active");
const subAReplay=await createSubscription({idempotencyKey:"r3e-sub-a-create-v1",tenantId:tenants.A,planId:starter.id,startsAt:iso(now-86400000),currentPeriodEnd:iso(now+30*86400000)},{context:{...ctx,correlationId:"r3e-sub-a-create-replay"},unitOfWork:store});
assert.equal(subAReplay.replayed,true);
assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM billing.subscription_events WHERE subscription_id=$1 AND event_type='created'",[subA.id])).rows[0].c),1);
await assert.rejects(()=>changeSubscriptionPlan({idempotencyKey:"r3e-sub-a-retired-plan-v1",subscriptionId:subA.id,toPlanId:retired.id},{context:{...ctx,correlationId:"r3e-sub-a-retired-plan"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
assert.equal((await changeSubscriptionPlan({idempotencyKey:"r3e-sub-a-change-v1",subscriptionId:subA.id,toPlanId:trialPlan.id},{context:{...ctx,correlationId:"r3e-sub-a-change"},unitOfWork:store})).subscription.planId,trialPlan.id);
assert.equal((await suspendSubscription({idempotencyKey:"r3e-sub-a-suspend-v1",subscriptionId:subA.id,reasonCode:"billing.review"},{context:{...ctx,correlationId:"r3e-sub-a-suspend"},unitOfWork:store})).subscription.status,"suspended");
assert.equal((await reactivateSubscription({idempotencyKey:"r3e-sub-a-reactivate-v1",subscriptionId:subA.id},{context:{...ctx,correlationId:"r3e-sub-a-reactivate"},unitOfWork:store})).subscription.status,"active");
assert.equal((await scheduleSubscriptionCancellation({idempotencyKey:"r3e-sub-a-schedule-v1",subscriptionId:subA.id},{context:{...ctx,correlationId:"r3e-sub-a-schedule"},unitOfWork:store})).subscription.status,"cancel_pending");
await assert.rejects(()=>changeSubscriptionPlan({idempotencyKey:"r3e-sub-a-pending-change-v1",subscriptionId:subA.id,toPlanId:starter.id},{context:{...ctx,correlationId:"r3e-sub-a-pending-change"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
await assert.rejects(()=>cancelSubscription({idempotencyKey:"r3e-sub-a-finalize-early-v1",subscriptionId:subA.id,mode:"finalize_scheduled",reasonCode:"billing.finalize"},{context:{...ctx,correlationId:"r3e-sub-a-finalize-early"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
assert.equal((await unscheduleSubscriptionCancellation({idempotencyKey:"r3e-sub-a-unschedule-v1",subscriptionId:subA.id},{context:{...ctx,correlationId:"r3e-sub-a-unschedule"},unitOfWork:store})).subscription.status,"active");
assert.equal((await cancelSubscription({idempotencyKey:"r3e-sub-a-cancel-v1",subscriptionId:subA.id,mode:"immediate",reasonCode:"billing.customer_cancel"},{context:{...ctx,correlationId:"r3e-sub-a-cancel"},unitOfWork:store})).subscription.status,"canceled");
await assert.rejects(()=>reactivateSubscription({idempotencyKey:"r3e-sub-a-terminal-reactivate-v1",subscriptionId:subA.id},{context:{...ctx,correlationId:"r3e-sub-a-terminal-reactivate"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
const scheduledStart=Date.now()+2000;
const subB=(await createSubscription({idempotencyKey:"r3e-sub-b-create-v1",tenantId:tenants.B,planId:trialPlan.id,startsAt:iso(scheduledStart),currentPeriodEnd:iso(scheduledStart+30*86400000)},{context:{...ctx,correlationId:"r3e-sub-b-create"},unitOfWork:store})).subscription;
assert.equal(subB.status,"scheduled");
await assert.rejects(()=>activateSubscription({idempotencyKey:"r3e-sub-b-too-early-v1",subscriptionId:subB.id},{context:{...ctx,correlationId:"r3e-sub-b-too-early"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
await sleep(2200);
assert.equal((await activateSubscription({idempotencyKey:"r3e-sub-b-start-v1",subscriptionId:subB.id},{context:{...ctx,correlationId:"r3e-sub-b-start"},unitOfWork:store})).subscription.status,"trialing");
assert.equal((await activateSubscription({idempotencyKey:"r3e-sub-b-activate-v1",subscriptionId:subB.id},{context:{...ctx,correlationId:"r3e-sub-b-activate"},unitOfWork:store})).subscription.status,"active");
await cancelSubscription({idempotencyKey:"r3e-sub-b-cancel-v1",subscriptionId:subB.id,mode:"immediate",reasonCode:"billing.fixture_end"},{context:{...ctx,correlationId:"r3e-sub-b-cancel"},unitOfWork:store});
const oldStart=Date.now()-10*86400000, oldEnd=Date.now()-86400000;
const subC=(await createSubscription({idempotencyKey:"r3e-sub-c-create-v1",tenantId:tenants.C,planId:starter.id,startsAt:iso(oldStart),currentPeriodEnd:iso(oldEnd)},{context:{...ctx,correlationId:"r3e-sub-c-create"},unitOfWork:store})).subscription;
assert.equal((await expireSubscription({idempotencyKey:"r3e-sub-c-expire-v1",subscriptionId:subC.id,reasonCode:"billing.period_ended"},{context:{...ctx,correlationId:"r3e-sub-c-expire"},unitOfWork:store})).subscription.status,"expired");
await assert.rejects(()=>reactivateSubscription({idempotencyKey:"r3e-sub-c-reactivate-v1",subscriptionId:subC.id},{context:{...ctx,correlationId:"r3e-sub-c-reactivate"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
const subD=(await createSubscription({idempotencyKey:"r3e-sub-d-create-v1",tenantId:tenants.D,planId:starter.id,startsAt:iso(oldStart),currentPeriodEnd:iso(oldEnd)},{context:{...ctx,correlationId:"r3e-sub-d-create"},unitOfWork:store})).subscription;
await scheduleSubscriptionCancellation({idempotencyKey:"r3e-sub-d-schedule-v1",subscriptionId:subD.id},{context:{...ctx,correlationId:"r3e-sub-d-schedule"},unitOfWork:store});
assert.equal((await cancelSubscription({idempotencyKey:"r3e-sub-d-finalize-v1",subscriptionId:subD.id,mode:"finalize_scheduled",reasonCode:"billing.scheduled_effective"},{context:{...ctx,correlationId:"r3e-sub-d-finalize"},unitOfWork:store})).subscription.status,"canceled");
const concurrency=await Promise.allSettled([
createSubscription({idempotencyKey:"r3e-sub-e-concurrent-a",tenantId:tenants.E,planId:starter.id,startsAt:iso(Date.now()-1000),currentPeriodEnd:iso(Date.now()+86400000)},{context:{...ctx,correlationId:"r3e-sub-e-concurrent-a"},unitOfWork:store}),
createSubscription({idempotencyKey:"r3e-sub-e-concurrent-b",tenantId:tenants.E,planId:trialPlan.id,startsAt:iso(Date.now()-1000),currentPeriodEnd:iso(Date.now()+86400000)},{context:{...ctx,correlationId:"r3e-sub-e-concurrent-b"},unitOfWork:store})
]);
assert.equal(concurrency.filter((x)=>x.status==="fulfilled").length,1);
const rejected=concurrency.find((x)=>x.status==="rejected") as PromiseRejectedResult;
assert.ok(rejected.reason instanceof AppError&&rejected.reason.code==="CONFLICT");
const winner=(concurrency.find((x)=>x.status==="fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof createSubscription>>>).value.subscription;
await cancelSubscription({idempotencyKey:"r3e-sub-e-cleanup-v1",subscriptionId:winner.id,mode:"immediate",reasonCode:"billing.fixture_end"},{context:{...ctx,correlationId:"r3e-sub-e-cleanup"},unitOfWork:store});
const providerF=(await createSubscription({idempotencyKey:"r3e-sub-f-provider-v1",tenantId:tenants.F,planId:starter.id,startsAt:iso(Date.now()-1000),currentPeriodEnd:iso(Date.now()+30*86400000),sourceKind:"provider",providerKey:"stripe",providerSubscriptionRef:"sub_r3e_unique",providerCustomerRef:"cus_r3e_f"},{context:{...ctx,correlationId:"r3e-sub-f-provider"},unitOfWork:store})).subscription;
await assert.rejects(()=>createSubscription({idempotencyKey:"r3e-sub-g-provider-collision-v1",tenantId:tenants.G,planId:starter.id,startsAt:iso(Date.now()-1000),currentPeriodEnd:iso(Date.now()+30*86400000),sourceKind:"provider",providerKey:"stripe",providerSubscriptionRef:"sub_r3e_unique",providerCustomerRef:"cus_r3e_g"},{context:{...ctx,correlationId:"r3e-sub-g-provider-collision"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
const safe=await resolveCurrentTenantSubscription({context:tenantContext(tenants.F,locations.F,"r3e-safe-f"),resolver:store});
assert.equal(safe?.tenantId,tenants.F);
assert.equal(safe?.subscriptionId,providerF.id);
assert.equal(Object.prototype.hasOwnProperty.call(safe ?? {},"providerKey"),false);
assert.equal(await resolveCurrentTenantSubscription({context:tenantContext(tenants.G,locations.G,"r3e-safe-g"),resolver:store}),null);
const subH=(await createSubscription({idempotencyKey:"r3e-sub-h-create-v1",tenantId:tenants.H,planId:starter.id,startsAt:iso(Date.now()-1000),currentPeriodEnd:iso(Date.now()+86400000)},{context:{...ctx,correlationId:"r3e-sub-h-create"},unitOfWork:store})).subscription;
await pool.query("UPDATE platform.tenants SET status='suspended',updated_at=now() WHERE id=$1",[tenants.H]);
assert.equal((await scheduleSubscriptionCancellation({idempotencyKey:"r3e-sub-h-restrictive-v1",subscriptionId:subH.id},{context:{...ctx,correlationId:"r3e-sub-h-restrictive"},unitOfWork:store})).subscription.status,"cancel_pending");
await assert.rejects(()=>unscheduleSubscriptionCancellation({idempotencyKey:"r3e-sub-h-unschedule-denied-v1",subscriptionId:subH.id},{context:{...ctx,correlationId:"r3e-sub-h-unschedule-denied"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
assert.equal((await cancelSubscription({idempotencyKey:"r3e-sub-h-cancel-v1",subscriptionId:subH.id,mode:"immediate",reasonCode:"billing.tenant_restrictive"},{context:{...ctx,correlationId:"r3e-sub-h-cancel"},unitOfWork:store})).subscription.status,"canceled");
const subI=(await createSubscription({idempotencyKey:"r3e-sub-i-create-v1",tenantId:tenants.I,planId:starter.id,startsAt:iso(Date.now()-1000),currentPeriodEnd:iso(Date.now()+86400000)},{context:{...ctx,correlationId:"r3e-sub-i-create"},unitOfWork:store})).subscription;
const beforeRollbackEvents=Number((await pool.query("SELECT count(*)::int AS c FROM billing.subscription_events WHERE subscription_id=$1",[subI.id])).rows[0].c);
await pool.query("CREATE OR REPLACE FUNCTION public.r3e_force_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id='r3e-rollback' THEN RAISE EXCEPTION 'R3E_FORCED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$");
await pool.query("CREATE TRIGGER r3e_force_audit_failure BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.r3e_force_audit_failure()");
try {
await assert.rejects(()=>suspendSubscription({idempotencyKey:"r3e-sub-i-rollback-v1",subscriptionId:subI.id,reasonCode:"billing.rollback_probe"},{context:{...ctx,correlationId:"r3e-rollback"},unitOfWork:store}));
} finally {
await pool.query("DROP TRIGGER IF EXISTS r3e_force_audit_failure ON audit.audit_events");
await pool.query("DROP FUNCTION IF EXISTS public.r3e_force_audit_failure()");
}
assert.equal(String((await pool.query("SELECT status FROM billing.subscriptions WHERE id=$1",[subI.id])).rows[0].status),"active");
assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM billing.lifecycle_idempotency WHERE idempotency_key='r3e-sub-i-rollback-v1'")).rows[0].c),0);
assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM billing.subscription_events WHERE subscription_id=$1",[subI.id])).rows[0].c),beforeRollbackEvents);
assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3e-rollback'")).rows[0].c),0);
const detail=await getSubscriptionAdmin(providerF.id,{context:{...ctx,correlationId:"r3e-sub-detail"},queries:store});
assert.equal(detail?.providerSubscriptionRef,"sub_r3e_unique");
const list=await listSubscriptionsAdmin({tenantId:tenants.F,limit:100},{context:{...ctx,correlationId:"r3e-sub-list"},queries:store});
assert.equal(list.length,1);
assert.equal(list[0]?.id,providerF.id);
const tenantOnly=await buildPlatformSecurityContext({principal:{identityId:NOAUTH,providerKey:"synthetic",providerSubject:"tenant-only",platformRoles:[]},roles:reads,correlationId:"r3e-tenant-only"});
assert.deepEqual(tenantOnly.platformPermissions,[]);
await assert.rejects(()=>createPlan({idempotencyKey:"r3e-tenant-role-shortcut-v1",slug:"should-not-create",name:"No",currency:"EUR",priceMinor:0,billingPeriod:"monthly"},{context:tenantOnly,unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
const forged:PlatformSecurityContext={scopeKind:"platform",correlationId:"r3e-forged-db-recheck",actorIdentityId:NOAUTH,platformRoles:["platform_admin"],platformPermissions:["platform.plans.read"]};
await assert.rejects(()=>getPlanAdmin(starter.id,{context:forged,queries:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
const client=await pool.connect();
try {
await client.query("BEGIN");
await client.query("SET LOCAL ROLE airen_control_plane");
await assert.rejects(()=>client.query("UPDATE billing.plans SET name='ILLEGAL' WHERE id=$1",[starter.id]),(e:any)=>e?.code==="42501");
await client.query("ROLLBACK");
await client.query("BEGIN");
await client.query("SET LOCAL ROLE airen_app");
await assert.rejects(()=>client.query("SELECT * FROM security.platform_mutate_subscription('suspend','r3e-app-denied-v1',$1,NULL,NULL,'billing.denied')",[subI.id]),(e:any)=>e?.code==="42501");
await client.query("ROLLBACK");
} finally { client.release(); }
const columns=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='billing' AND table_name='subscriptions' ORDER BY ordinal_position")).rows.map((r)=>String(r.column_name));
assert.ok(!columns.some((c)=>/(secret|password|token|credential)/i.test(c)));
assert.equal(await entitlementSnapshot(),entitlementBefore);
const eventCount=Number((await pool.query("SELECT count(*)::int AS c FROM billing.subscription_events WHERE tenant_id = ANY($1::uuid[])",[Object.values(tenants)])).rows[0].c);
const auditCount=Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE action_key LIKE 'billing.%' AND actor_identity_id=$1",[ALICE])).rows[0].c);
const outboxCount=Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE event_type LIKE 'billing.%'")).rows[0].c);
assert.ok(eventCount>=20);
assert.ok(auditCount>=25);
assert.ok(outboxCount>=25);
});
