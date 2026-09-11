import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  assignCorrectiveAction,
  closeCorrectiveAction,
  getCaseSnapshot,
  raiseIncident,
  raiseNonCompliance,
  recordCheck
} from "../../packages/ristoairen/src/compliance/haccp-compliance-incident-corrective-action.ts";
import { PostgresComplianceUnitOfWork } from "../../packages/persistence-postgres/src/risto-haccp-compliance-incident-corrective-action.ts";

const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL)throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:DATABASE_URL,max:20});
const uow=new PostgresComplianceUnitOfWork(pool);

const TENANT_A="31313131-1111-4111-8111-111111111111";
const LOCATION_A="31313131-2222-4222-8222-222222222221";
const LOCATION_A2="31313131-2222-4222-8222-222222222222";
const TENANT_B="31313131-3333-4333-8333-333333333333";
const LOCATION_B="31313131-4444-4444-8444-444444444444";
const STAFF_A="31313131-5555-4555-8555-555555555551";
const MANAGER_A="31313131-5555-4555-8555-555555555552";
const OFFICER_A="31313131-5555-4555-8555-555555555553";
const STELLA_A="31313131-5555-4555-8555-555555555554";
const PLAN_A="31313131-6666-4666-8666-666666666661";
const PLAN_A2="31313131-6666-4666-8666-666666666662";
const PLAN_B="31313131-6666-4666-8666-666666666663";
const CONTROL_A="31313131-7777-4777-8777-777777777771";
const CONTROL_A2="31313131-7777-4777-8777-777777777772";
const CONTROL_B="31313131-7777-4777-8777-777777777773";
const TENANT_MEMBERSHIP="31313131-8888-4888-8888-888888888881";
const LOCATION_MEMBERSHIP="31313131-9999-4999-8999-999999999991";

const ENTITLEMENTS=["vertical.ristoairen","compliance.enabled"] as const;
const STAFF_PERMISSIONS=["compliance.check.read","compliance.check.record","compliance.noncompliance.raise","compliance.incident.raise"] as const;
const MANAGER_PERMISSIONS=["compliance.corrective_action.read","compliance.corrective_action.assign","compliance.corrective_action.close"] as const;
const OFFICER_PERMISSIONS=["compliance.corrective_action.read","compliance.corrective_action.assign","compliance.corrective_action.close","compliance.corrective_action.close_critical"] as const;

type ContextOptions=Readonly<{tenantId?:string;locationId?:string;entitlements?:readonly string[];tenantMembership?:boolean;locationMembership?:boolean;tenantRole?:string;locationRole?:string}>;
function context(actorIdentityId:string,correlationId:string,permissions:readonly string[],options:ContextOptions={}):SecurityContext{
  const tenantId=options.tenantId??TENANT_A,locationId=options.locationId??LOCATION_A;
  const tenantMembership=options.tenantMembership??true,locationMembership=options.locationMembership??true;
  return Object.freeze({
    correlationId,actorIdentityId,platformRoles:[],platformPermissions:[],tenantId,locationId,
    ...(tenantMembership?{tenantMembershipId:TENANT_MEMBERSHIP,tenantRole:options.tenantRole??"staff"}:{}),
    ...(locationMembership?{locationMembershipId:LOCATION_MEMBERSHIP,locationRole:options.locationRole??"staff"}:{}),
    permissions,entitlements:options.entitlements??ENTITLEMENTS
  });
}
function deps(at:string,faultInjector?:(point:"after_check_insert"|"after_non_compliance_insert"|"after_incident_insert"|"after_corrective_action_insert"|"after_corrective_action_close")=>void|Promise<void>){return Object.freeze({unitOfWork:uow,now:()=>at,environmentClass:"TEST_TEMPORARY" as const,...(faultInjector?{faultInjector}:{})});}
function hasCode(error:unknown,code:string):boolean{return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code===code);}

async function seed():Promise<void>{
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES
      ('${TENANT_A}','mat031-a','MAT031 A'),('${TENANT_B}','mat031-b','MAT031 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,status) VALUES
      ('${LOCATION_A}','${TENANT_A}','main','MAT031 Main','Europe/Rome','active'),
      ('${LOCATION_A2}','${TENANT_A}','other','MAT031 Other','Europe/Rome','active'),
      ('${LOCATION_B}','${TENANT_B}','main','MAT031 Foreign','Europe/Rome','active');
    INSERT INTO identity.identities (id,display_name) VALUES
      ('${STAFF_A}','MAT031 Staff'),('${MANAGER_A}','MAT031 Manager'),('${OFFICER_A}','MAT031 Compliance Officer'),('${STELLA_A}','MAT031 STELLA Synthetic');
    INSERT INTO ristoairen.food_safety_plans (id,tenant_id,location_id,code,name,status,version,environment_class) VALUES
      ('${PLAN_A}','${TENANT_A}','${LOCATION_A}','HACCP-A','MAT031 Main Plan','ACTIVE',1,'TEST_TEMPORARY'),
      ('${PLAN_A2}','${TENANT_A}','${LOCATION_A2}','HACCP-A2','MAT031 Other Plan','ACTIVE',1,'TEST_TEMPORARY'),
      ('${PLAN_B}','${TENANT_B}','${LOCATION_B}','HACCP-B','MAT031 Foreign Plan','ACTIVE',1,'TEST_TEMPORARY');
    INSERT INTO ristoairen.food_safety_control_definitions
      (id,tenant_id,location_id,food_safety_plan_id,control_code,name,control_type,schedule_reference,active,row_version,environment_class) VALUES
      ('${CONTROL_A}','${TENANT_A}','${LOCATION_A}','${PLAN_A}','TEMP-COLD','Cold storage temperature','TEMPERATURE','every-4h',true,1,'TEST_TEMPORARY'),
      ('${CONTROL_A2}','${TENANT_A}','${LOCATION_A2}','${PLAN_A2}','TEMP-OTHER','Other location control','TEMPERATURE','daily',true,1,'TEST_TEMPORARY'),
      ('${CONTROL_B}','${TENANT_B}','${LOCATION_B}','${PLAN_B}','TEMP-B','Foreign control','TEMPERATURE','daily',true,1,'TEST_TEMPORARY');
  `);
}

async function visibleCount(actor:string,tenantId:string,locationId:string,table:string):Promise<number>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[actor,tenantId,locationId,"mat031-visible"]);
    const result=await client.query(`SELECT count(*)::int AS count FROM ristoairen.${table}`);
    await client.query("COMMIT");
    return Number(result.rows[0].count);
  }finally{client.release();}
}
async function expectRoleMutationDenied(actor:string,sql:string,params:readonly unknown[]):Promise<void>{
  const client:PoolClient=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[actor,TENANT_A,LOCATION_A,"mat031-boundary"]);
    await assert.rejects(client.query(sql,[...params]),/permission denied|row-level security|IMMUTABLE/i);
    await client.query("ROLLBACK");
  }finally{client.release();}
}

test("MAT-031 / GJ2-025 HACCP compliance incident corrective-action runtime",async t=>{
  await seed();
  t.after(async()=>{await pool.end();});
  let passCheckId="",nonCompliantCheckId="",nonComplianceId="",incidentId="",actionId="",criticalActionId="";

  await t.test("permission, entitlement, membership and Location scope fail closed before evidence write",async()=>{
    await assert.rejects(recordCheck(context(STAFF_A,"mat031-no-perm",[]),{controlDefinitionId:CONTROL_A,outcome:"PASS",idempotencyKey:"no-perm"},deps("2026-09-11T09:00:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    await assert.rejects(recordCheck(context(STAFF_A,"mat031-no-entitlement",STAFF_PERMISSIONS,{entitlements:["vertical.ristoairen"]}),{controlDefinitionId:CONTROL_A,outcome:"PASS",idempotencyKey:"no-entitlement"},deps("2026-09-11T09:00:01Z")),e=>hasCode(e,"ENTITLEMENT_REQUIRED"));
    await assert.rejects(recordCheck(context(STAFF_A,"mat031-no-location",STAFF_PERMISSIONS,{locationMembership:false}),{controlDefinitionId:CONTROL_A,outcome:"PASS",idempotencyKey:"no-location"},deps("2026-09-11T09:00:02Z")),e=>hasCode(e,"LOCATION_MEMBERSHIP_REQUIRED"));
    await assert.rejects(recordCheck(context(STAFF_A,"mat031-cross-location",STAFF_PERMISSIONS,{locationId:LOCATION_A2}),{controlDefinitionId:CONTROL_A,outcome:"PASS",idempotencyKey:"cross-location"},deps("2026-09-11T09:00:03Z")),e=>hasCode(e,"NOT_FOUND"));
    const r=await pool.query("SELECT count(*)::int AS count FROM ristoairen.food_safety_checks");assert.equal(r.rows[0].count,0);
  });

  await t.test("UnitOfWork rolls back inserted compliance evidence when a governed step fails",async()=>{
    await assert.rejects(recordCheck(context(STAFF_A,"mat031-rollback",STAFF_PERMISSIONS),{controlDefinitionId:CONTROL_A,outcome:"PASS",notes:"must roll back",idempotencyKey:"rollback-check"},deps("2026-09-11T09:01:00Z",point=>{if(point==="after_check_insert")throw new Error("MAT031_INJECTED_ROLLBACK");})),/MAT031_INJECTED_ROLLBACK/);
    const check=await pool.query("SELECT count(*)::int AS count FROM ristoairen.food_safety_checks WHERE idempotency_key='rollback-check'");assert.equal(check.rows[0].count,0);
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE correlation_id='mat031-rollback'");assert.equal(audit.rows[0].count,0);
  });

  await t.test("FoodSafetyCheck is append-oriented, idempotent and immutable",async()=>{
    const staff=context(STAFF_A,"mat031-pass",STAFF_PERMISSIONS);
    const pass=await recordCheck(staff,{controlDefinitionId:CONTROL_A,scheduledFor:"2026-09-11T09:00:00Z",outcome:"PASS",measuredValueText:"3.2 C",notes:"Within synthetic limit",idempotencyKey:"check-pass-1"},deps("2026-09-11T09:02:00Z"));
    passCheckId=pass.check.id;assert.equal(pass.replayed,false);assert.equal(pass.check.performedByIdentityId,STAFF_A);
    const replay=await recordCheck(context(STAFF_A,"mat031-pass-replay",STAFF_PERMISSIONS),{controlDefinitionId:CONTROL_A,scheduledFor:"2026-09-11T09:00:00Z",outcome:"PASS",measuredValueText:"3.2 C",notes:"Within synthetic limit",idempotencyKey:"check-pass-1"},deps("2026-09-11T09:03:00Z"));
    assert.equal(replay.replayed,true);assert.equal(replay.check.id,passCheckId);
    const nc=await recordCheck(context(STAFF_A,"mat031-nc-check",STAFF_PERMISSIONS),{controlDefinitionId:CONTROL_A,outcome:"NON_COMPLIANT",measuredValueText:"11.8 C",notes:"Synthetic excursion",evidenceReference:"test://mat031/evidence/cold-room",idempotencyKey:"check-nc-1"},deps("2026-09-11T09:04:00Z"));
    nonCompliantCheckId=nc.check.id;
    await assert.rejects(recordCheck(context(STAFF_A,"mat031-idempotency-conflict",STAFF_PERMISSIONS),{controlDefinitionId:CONTROL_A,outcome:"PASS",idempotencyKey:"check-nc-1"},deps("2026-09-11T09:05:00Z")),e=>hasCode(e,"CONFLICT"));
    const snapshot=await getCaseSnapshot(context(STAFF_A,"mat031-check-read",["compliance.check.read"]),{checkId:nonCompliantCheckId},deps("2026-09-11T09:05:01Z"));assert.equal(snapshot.check?.outcome,"NON_COMPLIANT");
    await expectRoleMutationDenied(STAFF_A,"UPDATE ristoairen.food_safety_checks SET notes='tampered' WHERE id=$1::uuid",[passCheckId]);
    await expectRoleMutationDenied(STAFF_A,"DELETE FROM ristoairen.food_safety_checks WHERE id=$1::uuid",[passCheckId]);
    await expectRoleMutationDenied(STAFF_A,"UPDATE ristoairen.food_safety_plans SET name='client authored' WHERE id=$1::uuid",[PLAN_A]);
  });

  await t.test("NonCompliance can only be raised from NON_COMPLIANT evidence and replays by source",async()=>{
    await assert.rejects(raiseNonCompliance(context(STAFF_A,"mat031-nc-from-pass",STAFF_PERMISSIONS),{foodSafetyCheckId:passCheckId,severity:"LOW",summary:"Should fail"},deps("2026-09-11T09:06:00Z")),e=>hasCode(e,"CONFLICT"));
    const raised=await raiseNonCompliance(context(STAFF_A,"mat031-nc",STAFF_PERMISSIONS),{foodSafetyCheckId:nonCompliantCheckId,severity:"HIGH",summary:"Cold-room temperature outside synthetic control limit"},deps("2026-09-11T09:06:01Z"));
    nonComplianceId=raised.nonCompliance.id;assert.equal(raised.replayed,false);
    const replay=await raiseNonCompliance(context(STAFF_A,"mat031-nc-replay",STAFF_PERMISSIONS),{foodSafetyCheckId:nonCompliantCheckId,severity:"HIGH",summary:"Cold-room temperature outside synthetic control limit"},deps("2026-09-11T09:06:02Z"));
    assert.equal(replay.replayed,true);assert.equal(replay.nonCompliance.id,nonComplianceId);
  });

  await t.test("OperationalIncident is trusted-actor scoped and auditable",async()=>{
    const incident=await raiseIncident(context(STAFF_A,"mat031-incident",STAFF_PERMISSIONS),{incidentType:"equipment.failure",severity:"CRITICAL",summary:"Synthetic refrigeration failure requiring immediate action",occurredAt:"2026-09-11T09:06:30Z"},deps("2026-09-11T09:07:00Z"));
    incidentId=incident.id;assert.equal(incident.reportedByIdentityId,STAFF_A);assert.equal(incident.incidentType,"EQUIPMENT.FAILURE");
  });

  await t.test("non-critical CorrectiveAction assignment and closure are version-guarded",async()=>{
    const assigned=await assignCorrectiveAction(context(MANAGER_A,"mat031-action",MANAGER_PERMISSIONS,{tenantRole:"manager",locationRole:"manager"}),{nonComplianceId,actionText:"Isolate affected stock and restore controlled temperature",assignedToIdentityId:STAFF_A,dueAt:"2026-09-11T11:00:00Z",severity:"HIGH"},deps("2026-09-11T09:08:00Z"));
    actionId=assigned.id;assert.equal(assigned.status,"ASSIGNED");assert.equal(assigned.rowVersion,1);
    const snapshot=await getCaseSnapshot(context(MANAGER_A,"mat031-action-read",MANAGER_PERMISSIONS,{tenantRole:"manager",locationRole:"manager"}),{correctiveActionId:actionId},deps("2026-09-11T09:08:01Z"));assert.equal(snapshot.correctiveAction?.id,actionId);
    const closed=await closeCorrectiveAction(context(MANAGER_A,"mat031-close",MANAGER_PERMISSIONS,{tenantRole:"manager",locationRole:"manager"}),{correctiveActionId:actionId,expectedRowVersion:1,closureSummary:"Synthetic corrective work completed and independently recorded",closureEvidenceReference:"test://mat031/closure/high"},deps("2026-09-11T09:09:00Z"));
    assert.equal(closed.status,"CLOSED");assert.equal(closed.rowVersion,2);assert.equal(closed.closedByIdentityId,MANAGER_A);
    await assert.rejects(closeCorrectiveAction(context(MANAGER_A,"mat031-stale",MANAGER_PERMISSIONS,{tenantRole:"manager",locationRole:"manager"}),{correctiveActionId:actionId,expectedRowVersion:1,closureSummary:"stale retry"},deps("2026-09-11T09:10:00Z")),e=>hasCode(e,"CONFLICT"));
  });

  await t.test("CRITICAL closure requires the privileged human permission and STELLA has no Core authority",async()=>{
    const manager=context(MANAGER_A,"mat031-critical-assign",MANAGER_PERMISSIONS,{tenantRole:"manager",locationRole:"manager"});
    const assigned=await assignCorrectiveAction(manager,{operationalIncidentId:incidentId,actionText:"Escalate refrigeration incident and verify containment",assignedToIdentityId:OFFICER_A,severity:"CRITICAL"},deps("2026-09-11T09:11:00Z"));criticalActionId=assigned.id;
    await assert.rejects(closeCorrectiveAction(context(MANAGER_A,"mat031-critical-manager-denied",MANAGER_PERMISSIONS,{tenantRole:"manager",locationRole:"manager"}),{correctiveActionId:criticalActionId,expectedRowVersion:1,closureSummary:"manager must not close critical"},deps("2026-09-11T09:12:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    await assert.rejects(assignCorrectiveAction(context(STELLA_A,"mat031-stella-denied",[],{tenantRole:"stella",locationRole:"stella"}),{operationalIncidentId:incidentId,actionText:"AI must not mutate Core",severity:"CRITICAL"},deps("2026-09-11T09:12:01Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    await assert.rejects(getCaseSnapshot(context(STELLA_A,"mat031-stella-read-denied",[],{tenantRole:"stella",locationRole:"stella"}),{correctiveActionId:criticalActionId},deps("2026-09-11T09:12:02Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    const closed=await closeCorrectiveAction(context(OFFICER_A,"mat031-critical-close",OFFICER_PERMISSIONS,{tenantRole:"compliance_officer",locationRole:"compliance_officer"}),{correctiveActionId:criticalActionId,expectedRowVersion:1,closureSummary:"Privileged synthetic critical closure with retained evidence",closureEvidenceReference:"test://mat031/closure/critical"},deps("2026-09-11T09:13:00Z"));
    assert.equal(closed.status,"CLOSED");assert.equal(closed.closedByIdentityId,OFFICER_A);assert.equal(closed.severity,"CRITICAL");
  });

  await t.test("PostgreSQL RLS isolates Tenant and Location evidence",async()=>{
    assert.equal(await visibleCount(STAFF_A,TENANT_A,LOCATION_A,"food_safety_plans"),1);
    assert.equal(await visibleCount(STAFF_A,TENANT_A,LOCATION_A2,"food_safety_plans"),1);
    assert.equal(await visibleCount(STAFF_A,TENANT_A,LOCATION_A,"food_safety_checks"),2);
    assert.equal(await visibleCount(STAFF_A,TENANT_A,LOCATION_A2,"food_safety_checks"),0);
    assert.equal(await visibleCount(STAFF_A,TENANT_B,LOCATION_B,"food_safety_checks"),0);
    assert.equal(await visibleCount(MANAGER_A,TENANT_A,LOCATION_A,"corrective_actions"),2);
    assert.equal(await visibleCount(MANAGER_A,TENANT_A,LOCATION_A2,"corrective_actions"),0);
  });

  await t.test("material compliance transitions retain AuditEvent provenance",async()=>{
    const result=await pool.query(`SELECT action_key,actor_identity_id::text AS actor,correlation_id FROM audit.audit_events WHERE tenant_id=$1::uuid AND action_key IN ('COMPLIANCE_CHECK_RECORDED','NON_COMPLIANCE_RAISED','OPERATIONAL_INCIDENT_RAISED','CORRECTIVE_ACTION_ASSIGNED','CORRECTIVE_ACTION_CLOSED') ORDER BY created_at,id`,[TENANT_A]);
    const keys=(result.rows as Array<{action_key:string}>).map(row=>row.action_key);
    for(const key of ["COMPLIANCE_CHECK_RECORDED","NON_COMPLIANCE_RAISED","OPERATIONAL_INCIDENT_RAISED","CORRECTIVE_ACTION_ASSIGNED","CORRECTIVE_ACTION_CLOSED"])assert.ok(keys.includes(key),`missing audit ${key}`);
    const critical=result.rows.find((row:{action_key:string;correlation_id:string})=>row.action_key==="CORRECTIVE_ACTION_CLOSED"&&row.correlation_id==="mat031-critical-close");
    assert.equal(critical?.actor,OFFICER_A);
    const replayAudits=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE correlation_id IN ('mat031-pass-replay','mat031-nc-replay')");assert.equal(replayAudits.rows[0].count,0);
  });
});
