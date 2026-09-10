import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  decideAttendanceException,
  getPreparedPayrollRun,
  getWorkforceSelfSnapshot,
  preparePayrollRun,
  recordSelfAttendance,
  requestSelfAttendanceException
} from "../../packages/ristoairen/src/workforce/workforce-attendance-payroll.ts";
import { PostgresWorkforceUnitOfWork } from "../../packages/persistence-postgres/src/risto-workforce-attendance-payroll.ts";

const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:DATABASE_URL,max:20});
const uow=new PostgresWorkforceUnitOfWork(pool);

const TENANT_A="30303030-1111-4111-8111-111111111111";
const LOCATION_A="30303030-2222-4222-8222-222222222221";
const LOCATION_A2="30303030-2222-4222-8222-222222222222";
const TENANT_B="30303030-3333-4333-8333-333333333333";
const LOCATION_B="30303030-4444-4444-8444-444444444444";
const EMPLOYEE_A="30303030-5555-4555-8555-555555555551";
const OTHER_A="30303030-5555-4555-8555-555555555552";
const MANAGER_A="30303030-6666-4666-8666-666666666661";
const HR_A="30303030-6666-4666-8666-666666666662";
const EMPLOYEE_B="30303030-7777-4777-8777-777777777771";
const PROFILE_A="30303030-8888-4888-8888-888888888881";
const PROFILE_OTHER_A="30303030-8888-4888-8888-888888888882";
const PROFILE_B="30303030-8888-4888-8888-888888888883";
const SHIFT_A="30303030-9999-4999-8999-999999999991";
const SHIFT_A2="30303030-9999-4999-8999-999999999992";
const SHIFT_B="30303030-9999-4999-8999-999999999993";
const ASSIGN_A="30303030-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ASSIGN_A2="30303030-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ASSIGN_OTHER_A="30303030-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const ASSIGN_B="30303030-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

const ALL_ENTITLEMENTS=["vertical.ristoairen","workforce.enabled","workforce.attendance.enabled","workforce.payroll_preparation.enabled"] as const;
const EMPLOYEE_PERMISSIONS=["workforce.self.read","workforce.attendance.record_self","workforce.attendance_exception.request_self"] as const;
const MANAGER_PERMISSIONS=["workforce.attendance.read","workforce.attendance_exception.approve"] as const;
const HR_PERMISSIONS=["workforce.payroll.prepare","workforce.payroll.read_sensitive"] as const;

type ContextOptions=Readonly<{tenantId?:string;locationId?:string;entitlements?:readonly string[];locationMembership?:boolean;tenantMembership?:boolean}>;
function context(actorIdentityId:string,correlationId:string,permissions:readonly string[],options:ContextOptions={}):SecurityContext{
  const tenantId=options.tenantId??TENANT_A,locationId=options.locationId??LOCATION_A;
  const tenantMembership=options.tenantMembership??true,locationMembership=options.locationMembership??true;
  return Object.freeze({
    correlationId,actorIdentityId,platformRoles:[],platformPermissions:[],tenantId,locationId,
    ...(tenantMembership?{tenantMembershipId:"30303030-bbbb-4bbb-8bbb-bbbbbbbbbbb1",tenantRole:"employee"}:{}),
    ...(locationMembership?{locationMembershipId:"30303030-cccc-4ccc-8ccc-ccccccccccc1",locationRole:"employee"}:{}),
    permissions,entitlements:options.entitlements??ALL_ENTITLEMENTS
  });
}
function deps(at:string,faultInjector?:(point:"after_payroll_period_insert")=>void|Promise<void>){return Object.freeze({unitOfWork:uow,now:()=>at,environmentClass:"TEST_TEMPORARY" as const,...(faultInjector?{faultInjector}:{})});}
function hasCode(error:unknown,code:string):boolean{return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code===code);}

async function seed():Promise<void>{
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES
      ('${TENANT_A}','mat030-a','MAT030 A'),('${TENANT_B}','mat030-b','MAT030 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,status) VALUES
      ('${LOCATION_A}','${TENANT_A}','main','MAT030 Main','Europe/Rome','active'),
      ('${LOCATION_A2}','${TENANT_A}','other','MAT030 Other','Europe/Rome','active'),
      ('${LOCATION_B}','${TENANT_B}','main','MAT030 Foreign','Europe/Rome','active');
    INSERT INTO identity.identities (id,display_name) VALUES
      ('${EMPLOYEE_A}','MAT030 Employee A'),('${OTHER_A}','MAT030 Other A'),('${MANAGER_A}','MAT030 Manager A'),
      ('${HR_A}','MAT030 HR A'),('${EMPLOYEE_B}','MAT030 Employee B');
    INSERT INTO ristoairen.workforce_profiles (id,tenant_id,identity_id,status,row_version,environment_class) VALUES
      ('${PROFILE_A}','${TENANT_A}','${EMPLOYEE_A}','ACTIVE',1,'TEST_TEMPORARY'),
      ('${PROFILE_OTHER_A}','${TENANT_A}','${OTHER_A}','ACTIVE',1,'TEST_TEMPORARY'),
      ('${PROFILE_B}','${TENANT_B}','${EMPLOYEE_B}','ACTIVE',1,'TEST_TEMPORARY');
    INSERT INTO ristoairen.work_shifts (id,tenant_id,location_id,starts_at,ends_at,status,row_version,environment_class) VALUES
      ('${SHIFT_A}','${TENANT_A}','${LOCATION_A}','2026-09-11T08:00:00Z','2026-09-11T20:00:00Z','SCHEDULED',1,'TEST_TEMPORARY'),
      ('${SHIFT_A2}','${TENANT_A}','${LOCATION_A2}','2026-09-11T08:00:00Z','2026-09-11T20:00:00Z','SCHEDULED',1,'TEST_TEMPORARY'),
      ('${SHIFT_B}','${TENANT_B}','${LOCATION_B}','2026-09-11T08:00:00Z','2026-09-11T20:00:00Z','SCHEDULED',1,'TEST_TEMPORARY');
    INSERT INTO ristoairen.shift_assignments (id,tenant_id,location_id,work_shift_id,workforce_profile_id,status,row_version,environment_class) VALUES
      ('${ASSIGN_A}','${TENANT_A}','${LOCATION_A}','${SHIFT_A}','${PROFILE_A}','ASSIGNED',1,'TEST_TEMPORARY'),
      ('${ASSIGN_A2}','${TENANT_A}','${LOCATION_A2}','${SHIFT_A2}','${PROFILE_A}','ASSIGNED',1,'TEST_TEMPORARY'),
      ('${ASSIGN_OTHER_A}','${TENANT_A}','${LOCATION_A}','${SHIFT_A}','${PROFILE_OTHER_A}','ASSIGNED',1,'TEST_TEMPORARY'),
      ('${ASSIGN_B}','${TENANT_B}','${LOCATION_B}','${SHIFT_B}','${PROFILE_B}','ASSIGNED',1,'TEST_TEMPORARY');
  `);
}

async function visibleCount(actor:string,tenantId:string,locationId:string,table:string):Promise<number>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[actor,tenantId,locationId,"mat030-visible"]);
    const result=await client.query(`SELECT count(*)::int AS count FROM ristoairen.${table}`);
    await client.query("COMMIT");
    return Number(result.rows[0].count);
  }finally{client.release();}
}

async function expectRoleMutationDenied(actor:string,tenantId:string,locationId:string,sql:string,params:readonly unknown[]):Promise<void>{
  const client:PoolClient=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[actor,tenantId,locationId,"mat030-boundary"]);
    await assert.rejects(client.query(sql,[...params]),/permission denied/i);
    await client.query("ROLLBACK");
  }finally{client.release();}
}

test("MAT-030 / GJ2-024 workforce attendance and payroll preparation runtime",async t=>{
  await seed();
  t.after(async()=>{await pool.end();});

  const employee=context(EMPLOYEE_A,"mat030-employee",EMPLOYEE_PERMISSIONS);
  const manager=context(MANAGER_A,"mat030-manager",MANAGER_PERMISSIONS);
  const hr=context(HR_A,"mat030-hr",HR_PERMISSIONS);
  let clockInId="",clockOutId="",approvedRequestId="",approvedDecisionId="",rejectedRequestId="",payrollRunId="";

  await t.test("authority and entitlement gates fail closed before attendance effects",async()=>{
    await assert.rejects(getWorkforceSelfSnapshot(context(EMPLOYEE_A,"mat030-no-location",["workforce.self.read"],{locationMembership:false}),deps("2026-09-11T08:00:00Z")),e=>hasCode(e,"LOCATION_MEMBERSHIP_REQUIRED"));
    await assert.rejects(recordSelfAttendance(context(EMPLOYEE_A,"mat030-no-ent",["workforce.attendance.record_self"],{entitlements:["vertical.ristoairen","workforce.enabled"]}),{shiftAssignmentId:ASSIGN_A,eventKind:"CLOCK_IN",occurredAt:"2026-09-11T09:00:00Z",idempotencyKey:"mat030-no-ent"},deps("2026-09-11T09:00:00Z")),e=>hasCode(e,"ENTITLEMENT_REQUIRED"));
    await assert.rejects(preparePayrollRun(manager,{periodStart:"2026-09-11",periodEnd:"2026-09-11",targetWorkforceProfileId:PROFILE_A,sourceRequestKey:"mat030-manager-payroll"},deps("2026-09-12T08:00:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    const count=await pool.query("SELECT count(*)::int AS count FROM ristoairen.attendance_events WHERE tenant_id=$1::uuid",[TENANT_A]);
    assert.equal(count.rows[0].count,0);
  });

  await t.test("employee self snapshot is identity-bound and Location-scoped",async()=>{
    const snapshot=await getWorkforceSelfSnapshot(employee,deps("2026-09-11T08:00:00Z"));
    assert.equal(snapshot.profile.id,PROFILE_A);
    assert.deepEqual(snapshot.assignments.map(x=>x.id),[ASSIGN_A]);
    assert.equal(snapshot.attendance.length,0);
  });

  await t.test("self clock evidence is append-only, scoped and replay-idempotent",async()=>{
    await assert.rejects(recordSelfAttendance(employee,{shiftAssignmentId:ASSIGN_OTHER_A,eventKind:"CLOCK_IN",occurredAt:"2026-09-11T09:00:00Z",idempotencyKey:"mat030-other-assignment"},deps("2026-09-11T09:00:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    const clockIn=await recordSelfAttendance(employee,{shiftAssignmentId:ASSIGN_A,eventKind:"CLOCK_IN",occurredAt:"2026-09-11T09:00:00Z",idempotencyKey:"mat030-clock-in"},deps("2026-09-11T09:00:00Z"));
    const replay=await recordSelfAttendance(context(EMPLOYEE_A,"mat030-clock-replay",EMPLOYEE_PERMISSIONS),{shiftAssignmentId:ASSIGN_A,eventKind:"CLOCK_IN",occurredAt:"2026-09-11T09:00:00Z",idempotencyKey:"mat030-clock-in"},deps("2026-09-11T09:01:00Z"));
    assert.equal(clockIn.replayed,false);assert.equal(replay.replayed,true);assert.equal(replay.event.id,clockIn.event.id);clockInId=clockIn.event.id;
    await assert.rejects(recordSelfAttendance(employee,{shiftAssignmentId:ASSIGN_A,eventKind:"CLOCK_OUT",occurredAt:"2026-09-11T09:00:00Z",idempotencyKey:"mat030-clock-in"},deps("2026-09-11T09:02:00Z")),e=>hasCode(e,"CONFLICT"));
    const clockOut=await recordSelfAttendance(employee,{shiftAssignmentId:ASSIGN_A,eventKind:"CLOCK_OUT",occurredAt:"2026-09-11T17:00:00Z",idempotencyKey:"mat030-clock-out"},deps("2026-09-11T17:00:00Z"));clockOutId=clockOut.event.id;
    const rows=await pool.query("SELECT event_kind,occurred_at FROM ristoairen.attendance_events WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND workforce_profile_id=$3::uuid ORDER BY occurred_at,id",[TENANT_A,LOCATION_A,PROFILE_A]);
    assert.deepEqual(rows.rows.map(r=>r.event_kind),["CLOCK_IN","CLOCK_OUT"]);
  });

  await t.test("exception correction is append-only, cannot self-approve and terminal decision converges",async()=>{
    const requested=await requestSelfAttendanceException(employee,{sourceAttendanceEventId:clockOutId,requestedAdjustmentMinutes:15,reasonCode:"LATE_CHECKOUT",idempotencyKey:"mat030-exception-approved"},deps("2026-09-11T17:10:00Z"));approvedRequestId=requested.event.id;
    const selfApprover=context(EMPLOYEE_A,"mat030-self-approve",[...EMPLOYEE_PERMISSIONS,"workforce.attendance_exception.approve"]);
    await assert.rejects(decideAttendanceException(selfApprover,{exceptionRequestEventId:approvedRequestId,decision:"APPROVE",idempotencyKey:"mat030-self-approve"},deps("2026-09-11T17:11:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    await assert.rejects(decideAttendanceException(context(MANAGER_A,"mat030-wrong-location",MANAGER_PERMISSIONS,{locationId:LOCATION_A2}),{exceptionRequestEventId:approvedRequestId,decision:"APPROVE",idempotencyKey:"mat030-wrong-location"},deps("2026-09-11T17:12:00Z")),e=>hasCode(e,"NOT_FOUND"));
    const approved=await decideAttendanceException(manager,{exceptionRequestEventId:approvedRequestId,decision:"APPROVE",reasonCode:"MANAGER_CONFIRMED",idempotencyKey:"mat030-manager-approve"},deps("2026-09-11T17:13:00Z"));approvedDecisionId=approved.event.id;
    const replay=await decideAttendanceException(context(MANAGER_A,"mat030-manager-replay",MANAGER_PERMISSIONS),{exceptionRequestEventId:approvedRequestId,decision:"APPROVE",idempotencyKey:"mat030-manager-approve-replay"},deps("2026-09-11T17:14:00Z"));
    assert.equal(replay.replayed,true);assert.equal(replay.event.id,approvedDecisionId);
    await assert.rejects(decideAttendanceException(manager,{exceptionRequestEventId:approvedRequestId,decision:"REJECT",idempotencyKey:"mat030-late-reject"},deps("2026-09-11T17:15:00Z")),e=>hasCode(e,"CONFLICT"));

    const rejectedRequest=await requestSelfAttendanceException(employee,{sourceAttendanceEventId:clockInId,requestedAdjustmentMinutes:-30,reasonCode:"EARLY_SCAN",idempotencyKey:"mat030-exception-rejected"},deps("2026-09-11T17:16:00Z"));rejectedRequestId=rejectedRequest.event.id;
    const rejected=await decideAttendanceException(manager,{exceptionRequestEventId:rejectedRequestId,decision:"REJECT",reasonCode:"NO_CHANGE",idempotencyKey:"mat030-manager-reject"},deps("2026-09-11T17:17:00Z"));
    assert.equal(rejected.event.eventKind,"EXCEPTION_REJECTED");

    const originals=await pool.query("SELECT id::text AS id,event_kind,occurred_at FROM ristoairen.attendance_events WHERE id=ANY($1::uuid[]) ORDER BY id",[[clockInId,clockOutId]]);
    assert.equal(originals.rows.length,2);assert.deepEqual(originals.rows.map(r=>r.event_kind).sort(),["CLOCK_IN","CLOCK_OUT"]);
    await assert.rejects(pool.query("UPDATE ristoairen.attendance_events SET occurred_at=occurred_at + interval '1 minute' WHERE id=$1::uuid",[clockInId]),/ATTENDANCE_EVENT_IMMUTABLE/);
    await assert.rejects(pool.query("DELETE FROM ristoairen.attendance_events WHERE id=$1::uuid",[clockOutId]),/ATTENDANCE_EVENT_IMMUTABLE/);
    await expectRoleMutationDenied(EMPLOYEE_A,TENANT_A,LOCATION_A,"UPDATE ristoairen.attendance_events SET reason_code='FORGED' WHERE id=$1::uuid",[approvedRequestId]);
  });

  await t.test("RLS isolates attendance by Tenant and Location",async()=>{
    const employeeB=context(EMPLOYEE_B,"mat030-employee-b",["workforce.attendance.record_self"],{tenantId:TENANT_B,locationId:LOCATION_B});
    await recordSelfAttendance(employeeB,{shiftAssignmentId:ASSIGN_B,eventKind:"CLOCK_IN",occurredAt:"2026-09-11T10:00:00Z",idempotencyKey:"mat030-b-clock"},deps("2026-09-11T10:00:00Z"));
    assert.equal(await visibleCount(MANAGER_A,TENANT_A,LOCATION_A,"attendance_events"),6);
    assert.equal(await visibleCount(MANAGER_A,TENANT_A,LOCATION_A2,"attendance_events"),0);
    assert.equal(await visibleCount(EMPLOYEE_B,TENANT_B,LOCATION_B,"attendance_events"),1);
  });

  await t.test("payroll preparation derives non-monetary immutable snapshot from approved evidence only",async()=>{
    const prepared=await preparePayrollRun(hr,{periodStart:"2026-09-11",periodEnd:"2026-09-11",targetWorkforceProfileId:PROFILE_A,sourceRequestKey:"mat030-payroll-main"},deps("2026-09-12T08:00:00Z"));
    payrollRunId=prepared.run.id;
    assert.equal(prepared.replayed,false);assert.equal(prepared.period.status,"PREPARED");assert.equal(prepared.run.status,"PREPARED");
    assert.equal(prepared.run.workedMinutes,480);assert.equal(prepared.run.approvedAdjustmentMinutes,15);assert.equal(prepared.run.payableMinutes,495);
    assert.match(prepared.run.inputsHash,/^[0-9a-f]{64}$/);assert.equal(prepared.run.sourceEventIds.length,6);
    for(const id of [clockInId,clockOutId,approvedRequestId,approvedDecisionId,rejectedRequestId])assert.ok(prepared.run.sourceEventIds.includes(id));

    const replay=await preparePayrollRun(context(HR_A,"mat030-payroll-replay",HR_PERMISSIONS),{periodStart:"2026-09-11",periodEnd:"2026-09-11",targetWorkforceProfileId:PROFILE_A,sourceRequestKey:"mat030-payroll-main"},deps("2026-09-12T09:00:00Z"));
    assert.equal(replay.replayed,true);assert.equal(replay.run.id,prepared.run.id);assert.equal(replay.run.inputsHash,prepared.run.inputsHash);assert.equal(replay.run.payableMinutes,495);

    await assert.rejects(getPreparedPayrollRun(context(MANAGER_A,"mat030-payroll-manager-read",MANAGER_PERMISSIONS),{payrollRunId},deps("2026-09-12T09:01:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    const read=await getPreparedPayrollRun(hr,{payrollRunId},deps("2026-09-12T09:02:00Z"));assert.equal(read.id,payrollRunId);assert.equal(read.payableMinutes,495);
    await assert.rejects(getPreparedPayrollRun(context(EMPLOYEE_B,"mat030-cross-tenant-payroll",["workforce.payroll.read_sensitive"],{tenantId:TENANT_B,locationId:LOCATION_B}),{payrollRunId},deps("2026-09-12T09:03:00Z")),e=>hasCode(e,"NOT_FOUND"));

    await assert.rejects(pool.query("UPDATE ristoairen.payroll_runs SET payable_minutes=0 WHERE id=$1::uuid",[payrollRunId]),/PAYROLL_PREPARATION_IMMUTABLE/);
    await expectRoleMutationDenied(HR_A,TENANT_A,LOCATION_A,"UPDATE ristoairen.payroll_runs SET payable_minutes=0 WHERE id=$1::uuid",[payrollRunId]);

    const columns=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='ristoairen' AND table_name='payroll_runs'");
    const names=new Set(columns.rows.map(r=>String(r.column_name)));
    for(const forbidden of ["salary","hourly_rate","gross_amount","net_amount","tax_amount","bank_account","currency","payslip_id","provider_reference"])assert.equal(names.has(forbidden),false,`forbidden monetary/statutory column ${forbidden}`);
  });

  await t.test("payroll transaction rolls back atomically after period insertion fault",async()=>{
    await assert.rejects(preparePayrollRun(context(HR_A,"mat030-payroll-fault",HR_PERMISSIONS),{periodStart:"2026-09-11",periodEnd:"2026-09-11",targetWorkforceProfileId:PROFILE_A,sourceRequestKey:"mat030-payroll-fault"},deps("2026-09-12T10:00:00Z",()=>{throw new Error("MAT030_INJECTED_FAULT");})),/MAT030_INJECTED_FAULT/);
    const period=await pool.query("SELECT count(*)::int AS count FROM ristoairen.payroll_periods WHERE tenant_id=$1::uuid AND source_request_key='mat030-payroll-fault'",[TENANT_A]);
    assert.equal(period.rows[0].count,0);
  });

  await t.test("audit evidence is exactly-once for committed business effects",async()=>{
    const actions=await pool.query("SELECT action_key,count(*)::int AS count FROM audit.audit_events WHERE tenant_id=$1::uuid AND action_key IN ('ATTENDANCE_EVENT_RECORDED','ATTENDANCE_EXCEPTION_REQUESTED','ATTENDANCE_EXCEPTION_DECIDED','PAYROLL_PREPARATION_CREATED') GROUP BY action_key ORDER BY action_key",[TENANT_A]);
    const counts=Object.fromEntries(actions.rows.map(r=>[r.action_key,Number(r.count)]));
    assert.deepEqual(counts,{ATTENDANCE_EVENT_RECORDED:2,ATTENDANCE_EXCEPTION_DECIDED:2,ATTENDANCE_EXCEPTION_REQUESTED:2,PAYROLL_PREPARATION_CREATED:1});
  });
});
