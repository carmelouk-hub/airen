import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent, SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  AttendanceEventKind,
  AttendanceEventRecord,
  PayrollPeriodRecord,
  PayrollRunRecord,
  ShiftAssignmentMaterial,
  WorkforceEnvironmentClass,
  WorkforceProfileRecord,
  WorkforceTransaction
} from "../../ristoairen/src/workforce/workforce-attendance-payroll.ts";

function assertRoleIdentifier(role:string):string{if(!/^[a-z_][a-z0-9_]*$/.test(role))throw new Error("Unsafe PostgreSQL role identifier");return role;}
function iso(value:unknown):string{return new Date(String(value)).toISOString();}
function dateOnly(value:unknown):string{if(value instanceof Date)return value.toISOString().slice(0,10);return String(value).slice(0,10);}

function profileFromRow(row:Record<string,unknown>):WorkforceProfileRecord{return Object.freeze({id:String(row.id),tenantId:String(row.tenantId),identityId:String(row.identityId),status:String(row.status) as WorkforceProfileRecord["status"],rowVersion:Number(row.rowVersion),environmentClass:String(row.environmentClass) as WorkforceEnvironmentClass});}
function assignmentFromRow(row:Record<string,unknown>):ShiftAssignmentMaterial{return Object.freeze({id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),workShiftId:String(row.workShiftId),workforceProfileId:String(row.workforceProfileId),status:String(row.status) as ShiftAssignmentMaterial["status"],rowVersion:Number(row.rowVersion),environmentClass:String(row.environmentClass) as WorkforceEnvironmentClass,shiftStartsAt:iso(row.shiftStartsAt),shiftEndsAt:iso(row.shiftEndsAt),shiftStatus:String(row.shiftStatus) as ShiftAssignmentMaterial["shiftStatus"]});}
function attendanceFromRow(row:Record<string,unknown>):AttendanceEventRecord{return Object.freeze({id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),workforceProfileId:String(row.workforceProfileId),shiftAssignmentId:String(row.shiftAssignmentId),eventKind:String(row.eventKind) as AttendanceEventKind,occurredAt:iso(row.occurredAt),recordedByIdentityId:String(row.recordedByIdentityId),...(row.relatedEventId==null?{}:{relatedEventId:String(row.relatedEventId)}),...(row.requestedAdjustmentMinutes==null?{}:{requestedAdjustmentMinutes:Number(row.requestedAdjustmentMinutes)}),...(row.reasonCode==null?{}:{reasonCode:String(row.reasonCode)}),idempotencyKey:String(row.idempotencyKey),correlationId:String(row.correlationId),environmentClass:String(row.environmentClass) as WorkforceEnvironmentClass});}
function periodFromRow(row:Record<string,unknown>):PayrollPeriodRecord{return Object.freeze({id:String(row.id),tenantId:String(row.tenantId),periodStart:dateOnly(row.periodStart),periodEnd:dateOnly(row.periodEnd),status:String(row.status) as PayrollPeriodRecord["status"],sourceRequestKey:String(row.sourceRequestKey),rowVersion:Number(row.rowVersion),environmentClass:String(row.environmentClass) as WorkforceEnvironmentClass,...(row.preparedAt==null?{}:{preparedAt:iso(row.preparedAt)}),...(row.preparedByIdentityId==null?{}:{preparedByIdentityId:String(row.preparedByIdentityId)})});}
function runFromRow(row:Record<string,unknown>):PayrollRunRecord{const rawIds=Array.isArray(row.sourceEventIds)?row.sourceEventIds:[];return Object.freeze({id:String(row.id),tenantId:String(row.tenantId),payrollPeriodId:String(row.payrollPeriodId),workforceProfileId:String(row.workforceProfileId),status:"PREPARED",workedMinutes:Number(row.workedMinutes),approvedAdjustmentMinutes:Number(row.approvedAdjustmentMinutes),payableMinutes:Number(row.payableMinutes),sourceEventIds:Object.freeze(rawIds.map(String)),inputsHash:String(row.inputsHash),preparedAt:iso(row.preparedAt),preparedByIdentityId:String(row.preparedByIdentityId),environmentClass:String(row.environmentClass) as WorkforceEnvironmentClass});}

const PROFILE_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",identity_id::text AS "identityId",status,row_version AS "rowVersion",environment_class AS "environmentClass" FROM ristoairen.workforce_profiles`;
const ASSIGNMENT_SELECT=`SELECT sa.id::text AS id,sa.tenant_id::text AS "tenantId",sa.location_id::text AS "locationId",sa.work_shift_id::text AS "workShiftId",sa.workforce_profile_id::text AS "workforceProfileId",sa.status,sa.row_version AS "rowVersion",sa.environment_class AS "environmentClass",ws.starts_at AS "shiftStartsAt",ws.ends_at AS "shiftEndsAt",ws.status AS "shiftStatus" FROM ristoairen.shift_assignments sa JOIN ristoairen.work_shifts ws ON ws.tenant_id=sa.tenant_id AND ws.location_id=sa.location_id AND ws.id=sa.work_shift_id`;
const ATTENDANCE_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",workforce_profile_id::text AS "workforceProfileId",shift_assignment_id::text AS "shiftAssignmentId",event_kind AS "eventKind",occurred_at AS "occurredAt",recorded_by_identity_id::text AS "recordedByIdentityId",related_event_id::text AS "relatedEventId",requested_adjustment_minutes AS "requestedAdjustmentMinutes",reason_code AS "reasonCode",idempotency_key AS "idempotencyKey",correlation_id AS "correlationId",environment_class AS "environmentClass" FROM ristoairen.attendance_events`;
const PERIOD_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",period_start AS "periodStart",period_end AS "periodEnd",status,source_request_key AS "sourceRequestKey",row_version AS "rowVersion",environment_class AS "environmentClass",prepared_at AS "preparedAt",prepared_by_identity_id::text AS "preparedByIdentityId" FROM ristoairen.payroll_periods`;
const RUN_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",payroll_period_id::text AS "payrollPeriodId",workforce_profile_id::text AS "workforceProfileId",status,worked_minutes AS "workedMinutes",approved_adjustment_minutes AS "approvedAdjustmentMinutes",payable_minutes AS "payableMinutes",source_event_ids::text[] AS "sourceEventIds",inputs_hash AS "inputsHash",prepared_at AS "preparedAt",prepared_by_identity_id::text AS "preparedByIdentityId",environment_class AS "environmentClass" FROM ristoairen.payroll_runs`;

export class PostgresWorkforceTransaction implements WorkforceTransaction {
  private readonly client:PoolClient;
  private readonly context:SecurityContext;
  constructor(client:PoolClient,context:SecurityContext){this.client=client;this.context=context;}

  async findSelfWorkforceProfile():Promise<WorkforceProfileRecord|null>{const r=await this.client.query(`${PROFILE_SELECT} WHERE identity_id=security.current_identity_id()`,[]);return r.rows[0]?profileFromRow(r.rows[0] as Record<string,unknown>):null;}
  async getWorkforceProfile(workforceProfileId:string):Promise<WorkforceProfileRecord|null>{const r=await this.client.query(`${PROFILE_SELECT} WHERE id=$1::uuid`,[workforceProfileId]);return r.rows[0]?profileFromRow(r.rows[0] as Record<string,unknown>):null;}
  async listSelfShiftAssignments(workforceProfileId:string):Promise<readonly ShiftAssignmentMaterial[]>{const r=await this.client.query(`${ASSIGNMENT_SELECT} JOIN ristoairen.workforce_profiles wp ON wp.tenant_id=sa.tenant_id AND wp.id=sa.workforce_profile_id WHERE sa.workforce_profile_id=$1::uuid AND wp.identity_id=security.current_identity_id() ORDER BY ws.starts_at,sa.id`,[workforceProfileId]);return Object.freeze((r.rows as Record<string,unknown>[]).map(assignmentFromRow));}
  async listSelfAttendance(workforceProfileId:string):Promise<readonly AttendanceEventRecord[]>{const r=await this.client.query(`${ATTENDANCE_SELECT} JOIN ristoairen.workforce_profiles wp ON wp.tenant_id=attendance_events.tenant_id AND wp.id=attendance_events.workforce_profile_id WHERE attendance_events.workforce_profile_id=$1::uuid AND wp.identity_id=security.current_identity_id() ORDER BY attendance_events.occurred_at,attendance_events.id`,[workforceProfileId]);return Object.freeze((r.rows as Record<string,unknown>[]).map(attendanceFromRow));}
  async getShiftAssignment(shiftAssignmentId:string):Promise<ShiftAssignmentMaterial|null>{const r=await this.client.query(`${ASSIGNMENT_SELECT} WHERE sa.id=$1::uuid`,[shiftAssignmentId]);return r.rows[0]?assignmentFromRow(r.rows[0] as Record<string,unknown>):null;}
  async findAttendanceByIdempotencyKey(idempotencyKey:string):Promise<AttendanceEventRecord|null>{const r=await this.client.query(`${ATTENDANCE_SELECT} WHERE idempotency_key=$1`,[idempotencyKey]);return r.rows[0]?attendanceFromRow(r.rows[0] as Record<string,unknown>):null;}
  async getAttendanceEvent(attendanceEventId:string):Promise<AttendanceEventRecord|null>{const r=await this.client.query(`${ATTENDANCE_SELECT} WHERE id=$1::uuid`,[attendanceEventId]);return r.rows[0]?attendanceFromRow(r.rows[0] as Record<string,unknown>):null;}
  async lockExceptionRequest(exceptionRequestEventId:string):Promise<AttendanceEventRecord|null>{await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`risto:attendance:exception:${this.context.tenantId}:${this.context.locationId}:${exceptionRequestEventId}`]);const r=await this.client.query(`${ATTENDANCE_SELECT} WHERE id=$1::uuid`,[exceptionRequestEventId]);return r.rows[0]?attendanceFromRow(r.rows[0] as Record<string,unknown>):null;}
  async findExceptionDecision(exceptionRequestEventId:string):Promise<AttendanceEventRecord|null>{const r=await this.client.query(`${ATTENDANCE_SELECT} WHERE related_event_id=$1::uuid AND event_kind IN ('EXCEPTION_APPROVED','EXCEPTION_REJECTED') ORDER BY created_at,id LIMIT 1`,[exceptionRequestEventId]);return r.rows[0]?attendanceFromRow(r.rows[0] as Record<string,unknown>):null;}
  async insertAttendanceEvent(input:Readonly<{tenantId:string;locationId:string;workforceProfileId:string;shiftAssignmentId:string;eventKind:AttendanceEventKind;occurredAt:string;recordedByIdentityId:string;relatedEventId?:string;requestedAdjustmentMinutes?:number;reasonCode?:string;idempotencyKey:string;correlationId:string;environmentClass:WorkforceEnvironmentClass}>):Promise<AttendanceEventRecord>{const r=await this.client.query(`INSERT INTO ristoairen.attendance_events (tenant_id,location_id,workforce_profile_id,shift_assignment_id,event_kind,occurred_at,recorded_by_identity_id,related_event_id,requested_adjustment_minutes,reason_code,idempotency_key,correlation_id,environment_class) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::timestamptz,$7::uuid,$8::uuid,$9::integer,$10,$11,$12,$13) RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",workforce_profile_id::text AS "workforceProfileId",shift_assignment_id::text AS "shiftAssignmentId",event_kind AS "eventKind",occurred_at AS "occurredAt",recorded_by_identity_id::text AS "recordedByIdentityId",related_event_id::text AS "relatedEventId",requested_adjustment_minutes AS "requestedAdjustmentMinutes",reason_code AS "reasonCode",idempotency_key AS "idempotencyKey",correlation_id AS "correlationId",environment_class AS "environmentClass"`,[input.tenantId,input.locationId,input.workforceProfileId,input.shiftAssignmentId,input.eventKind,input.occurredAt,input.recordedByIdentityId,input.relatedEventId??null,input.requestedAdjustmentMinutes??null,input.reasonCode??null,input.idempotencyKey,input.correlationId,input.environmentClass]);return attendanceFromRow(r.rows[0] as Record<string,unknown>);}

  async findPayrollPeriodByRequestKey(sourceRequestKey:string):Promise<PayrollPeriodRecord|null>{await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`risto:payroll:prepare:${this.context.tenantId}:${sourceRequestKey}`]);const r=await this.client.query(`${PERIOD_SELECT} WHERE source_request_key=$1`,[sourceRequestKey]);return r.rows[0]?periodFromRow(r.rows[0] as Record<string,unknown>):null;}
  async insertPayrollPeriod(input:Readonly<{tenantId:string;periodStart:string;periodEnd:string;sourceRequestKey:string;preparedAt:string;preparedByIdentityId:string;environmentClass:WorkforceEnvironmentClass}>):Promise<PayrollPeriodRecord>{const r=await this.client.query(`INSERT INTO ristoairen.payroll_periods (tenant_id,period_start,period_end,status,source_request_key,row_version,environment_class,prepared_at,prepared_by_identity_id) VALUES ($1::uuid,$2::date,$3::date,'PREPARED',$4,1,$5,$6::timestamptz,$7::uuid) RETURNING id::text AS id,tenant_id::text AS "tenantId",period_start AS "periodStart",period_end AS "periodEnd",status,source_request_key AS "sourceRequestKey",row_version AS "rowVersion",environment_class AS "environmentClass",prepared_at AS "preparedAt",prepared_by_identity_id::text AS "preparedByIdentityId"`,[input.tenantId,input.periodStart,input.periodEnd,input.sourceRequestKey,input.environmentClass,input.preparedAt,input.preparedByIdentityId]);return periodFromRow(r.rows[0] as Record<string,unknown>);}
  async findPayrollRun(payrollPeriodId:string,workforceProfileId:string):Promise<PayrollRunRecord|null>{const r=await this.client.query(`${RUN_SELECT} WHERE payroll_period_id=$1::uuid AND workforce_profile_id=$2::uuid`,[payrollPeriodId,workforceProfileId]);return r.rows[0]?runFromRow(r.rows[0] as Record<string,unknown>):null;}
  async findAnyPayrollRun(payrollPeriodId:string):Promise<PayrollRunRecord|null>{const r=await this.client.query(`${RUN_SELECT} WHERE payroll_period_id=$1::uuid ORDER BY created_at,id LIMIT 1`,[payrollPeriodId]);return r.rows[0]?runFromRow(r.rows[0] as Record<string,unknown>):null;}
  async listPayrollEvidence(workforceProfileId:string,periodStart:string,periodEnd:string):Promise<readonly AttendanceEventRecord[]>{const r=await this.client.query(`WITH source_clocks AS (
      SELECT ae.id FROM ristoairen.attendance_events ae
      JOIN platform.locations l ON l.tenant_id=ae.tenant_id AND l.id=ae.location_id
      WHERE ae.workforce_profile_id=$1::uuid AND ae.event_kind IN ('CLOCK_IN','CLOCK_OUT')
        AND (ae.occurred_at AT TIME ZONE l.timezone)::date BETWEEN $2::date AND $3::date
    ), requests AS (
      SELECT ae.id FROM ristoairen.attendance_events ae
      WHERE ae.event_kind='EXCEPTION_REQUESTED' AND ae.related_event_id IN (SELECT id FROM source_clocks)
    )
    ${ATTENDANCE_SELECT}
    WHERE id IN (SELECT id FROM source_clocks)
       OR id IN (SELECT id FROM requests)
       OR (event_kind IN ('EXCEPTION_APPROVED','EXCEPTION_REJECTED') AND related_event_id IN (SELECT id FROM requests))
    ORDER BY occurred_at,id`,[workforceProfileId,periodStart,periodEnd]);return Object.freeze((r.rows as Record<string,unknown>[]).map(attendanceFromRow));}
  async insertPayrollRun(input:Readonly<{tenantId:string;payrollPeriodId:string;workforceProfileId:string;workedMinutes:number;approvedAdjustmentMinutes:number;payableMinutes:number;sourceEventIds:readonly string[];inputsHash:string;preparedAt:string;preparedByIdentityId:string;environmentClass:WorkforceEnvironmentClass}>):Promise<PayrollRunRecord>{const r=await this.client.query(`INSERT INTO ristoairen.payroll_runs (tenant_id,payroll_period_id,workforce_profile_id,status,worked_minutes,approved_adjustment_minutes,payable_minutes,source_event_ids,inputs_hash,prepared_at,prepared_by_identity_id,environment_class) VALUES ($1::uuid,$2::uuid,$3::uuid,'PREPARED',$4::integer,$5::integer,$6::integer,$7::uuid[],$8,$9::timestamptz,$10::uuid,$11) RETURNING id::text AS id,tenant_id::text AS "tenantId",payroll_period_id::text AS "payrollPeriodId",workforce_profile_id::text AS "workforceProfileId",status,worked_minutes AS "workedMinutes",approved_adjustment_minutes AS "approvedAdjustmentMinutes",payable_minutes AS "payableMinutes",source_event_ids::text[] AS "sourceEventIds",inputs_hash AS "inputsHash",prepared_at AS "preparedAt",prepared_by_identity_id::text AS "preparedByIdentityId",environment_class AS "environmentClass"`,[input.tenantId,input.payrollPeriodId,input.workforceProfileId,input.workedMinutes,input.approvedAdjustmentMinutes,input.payableMinutes,[...input.sourceEventIds],input.inputsHash,input.preparedAt,input.preparedByIdentityId,input.environmentClass]);return runFromRow(r.rows[0] as Record<string,unknown>);}
  async getPayrollRun(payrollRunId:string):Promise<PayrollRunRecord|null>{const r=await this.client.query(`${RUN_SELECT} WHERE id=$1::uuid`,[payrollRunId]);return r.rows[0]?runFromRow(r.rows[0] as Record<string,unknown>):null;}

  async audit(record:AuditRecord):Promise<void>{await this.client.query(`INSERT INTO audit.audit_events (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata) VALUES ($1::uuid,$2::uuid,$3::uuid,'system',$4,$5,$6,$7,$8,$9::jsonb)`,[record.tenantId,record.locationId,record.actorIdentityId,record.actionKey,record.resourceType??null,record.resourceId??null,record.correlationId,record.outcome,JSON.stringify(record.metadata??{})]);}
  async outbox(_event:DomainEvent & {tenantId:string;locationId:string;correlationId:string}):Promise<void>{throw new Error("MAT030_WORKFORCE_HAS_NO_OUTBOX");}
}

export class PostgresWorkforceUnitOfWork implements UnitOfWork<WorkforceTransaction> {
  private readonly pool:Pool;
  private readonly assumeRole:string;
  constructor(pool:Pool,assumeRole="airen_app"){this.pool=pool;this.assumeRole=assumeRole;}
  async transaction<T>(fn:(tx:WorkforceTransaction)=>Promise<T>,context?:SecurityContext):Promise<T>{
    if(!context)throw new Error("SecurityContext is required for MAT-030 workforce runtime");
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]);
      const value=await fn(new PostgresWorkforceTransaction(client,context));
      await client.query("COMMIT");
      return value;
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}
  }
}
