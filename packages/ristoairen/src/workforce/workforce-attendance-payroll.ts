import { createHash } from "node:crypto";
import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const RISTOAIREN_ENTITLEMENT="vertical.ristoairen";
export const WORKFORCE_ENTITLEMENT="workforce.enabled";
export const ATTENDANCE_ENTITLEMENT="workforce.attendance.enabled";
export const PAYROLL_PREPARATION_ENTITLEMENT="workforce.payroll_preparation.enabled";
export const WORKFORCE_SELF_READ_PERMISSION="workforce.self.read";
export const ATTENDANCE_RECORD_SELF_PERMISSION="workforce.attendance.record_self";
export const ATTENDANCE_EXCEPTION_REQUEST_SELF_PERMISSION="workforce.attendance_exception.request_self";
export const ATTENDANCE_EXCEPTION_APPROVE_PERMISSION="workforce.attendance_exception.approve";
export const PAYROLL_PREPARE_PERMISSION="workforce.payroll.prepare";
export const PAYROLL_READ_SENSITIVE_PERMISSION="workforce.payroll.read_sensitive";
export const ATTENDANCE_EVENT_RECORDED_ACTION="ATTENDANCE_EVENT_RECORDED";
export const ATTENDANCE_EXCEPTION_REQUESTED_ACTION="ATTENDANCE_EXCEPTION_REQUESTED";
export const ATTENDANCE_EXCEPTION_DECIDED_ACTION="ATTENDANCE_EXCEPTION_DECIDED";
export const PAYROLL_PREPARATION_CREATED_ACTION="PAYROLL_PREPARATION_CREATED";

export type WorkforceEnvironmentClass="DEMO"|"SANDBOX"|"TEST_TEMPORARY";
export type WorkforceProfileStatus="ACTIVE"|"INACTIVE";
export type WorkShiftStatus="SCHEDULED"|"CANCELLED"|"COMPLETED";
export type ShiftAssignmentStatus="ASSIGNED"|"CANCELLED";
export type AttendanceEventKind="CLOCK_IN"|"CLOCK_OUT"|"EXCEPTION_REQUESTED"|"EXCEPTION_APPROVED"|"EXCEPTION_REJECTED";
export type PayrollPeriodStatus="OPEN"|"PREPARED";

export type WorkforceProfileRecord=Readonly<{id:string;tenantId:string;identityId:string;status:WorkforceProfileStatus;rowVersion:number;environmentClass:WorkforceEnvironmentClass}>;
export type ShiftAssignmentMaterial=Readonly<{id:string;tenantId:string;locationId:string;workShiftId:string;workforceProfileId:string;status:ShiftAssignmentStatus;rowVersion:number;environmentClass:WorkforceEnvironmentClass;shiftStartsAt:string;shiftEndsAt:string;shiftStatus:WorkShiftStatus}>;
export type AttendanceEventRecord=Readonly<{id:string;tenantId:string;locationId:string;workforceProfileId:string;shiftAssignmentId:string;eventKind:AttendanceEventKind;occurredAt:string;recordedByIdentityId:string;relatedEventId?:string;requestedAdjustmentMinutes?:number;reasonCode?:string;idempotencyKey:string;correlationId:string;environmentClass:WorkforceEnvironmentClass}>;
export type PayrollPeriodRecord=Readonly<{id:string;tenantId:string;periodStart:string;periodEnd:string;status:PayrollPeriodStatus;sourceRequestKey:string;rowVersion:number;environmentClass:WorkforceEnvironmentClass;preparedAt?:string;preparedByIdentityId?:string}>;
export type PayrollRunRecord=Readonly<{id:string;tenantId:string;payrollPeriodId:string;workforceProfileId:string;status:"PREPARED";workedMinutes:number;approvedAdjustmentMinutes:number;payableMinutes:number;sourceEventIds:readonly string[];inputsHash:string;preparedAt:string;preparedByIdentityId:string;environmentClass:WorkforceEnvironmentClass}>;
export type WorkforceSelfSnapshot=Readonly<{profile:WorkforceProfileRecord;assignments:readonly ShiftAssignmentMaterial[];attendance:readonly AttendanceEventRecord[]}>;

export interface WorkforceTransaction extends TransactionContext {
  findSelfWorkforceProfile():Promise<WorkforceProfileRecord|null>;
  getWorkforceProfile(workforceProfileId:string):Promise<WorkforceProfileRecord|null>;
  listSelfShiftAssignments(workforceProfileId:string):Promise<readonly ShiftAssignmentMaterial[]>;
  listSelfAttendance(workforceProfileId:string):Promise<readonly AttendanceEventRecord[]>;
  getShiftAssignment(shiftAssignmentId:string):Promise<ShiftAssignmentMaterial|null>;
  findAttendanceByIdempotencyKey(idempotencyKey:string):Promise<AttendanceEventRecord|null>;
  getAttendanceEvent(attendanceEventId:string):Promise<AttendanceEventRecord|null>;
  lockExceptionRequest(exceptionRequestEventId:string):Promise<AttendanceEventRecord|null>;
  findExceptionDecision(exceptionRequestEventId:string):Promise<AttendanceEventRecord|null>;
  insertAttendanceEvent(input:Readonly<{tenantId:string;locationId:string;workforceProfileId:string;shiftAssignmentId:string;eventKind:AttendanceEventKind;occurredAt:string;recordedByIdentityId:string;relatedEventId?:string;requestedAdjustmentMinutes?:number;reasonCode?:string;idempotencyKey:string;correlationId:string;environmentClass:WorkforceEnvironmentClass}>):Promise<AttendanceEventRecord>;
  findPayrollPeriodByRequestKey(sourceRequestKey:string):Promise<PayrollPeriodRecord|null>;
  insertPayrollPeriod(input:Readonly<{tenantId:string;periodStart:string;periodEnd:string;sourceRequestKey:string;preparedAt:string;preparedByIdentityId:string;environmentClass:WorkforceEnvironmentClass}>):Promise<PayrollPeriodRecord>;
  findPayrollRun(payrollPeriodId:string,workforceProfileId:string):Promise<PayrollRunRecord|null>;
  findAnyPayrollRun(payrollPeriodId:string):Promise<PayrollRunRecord|null>;
  listPayrollEvidence(workforceProfileId:string,periodStart:string,periodEnd:string):Promise<readonly AttendanceEventRecord[]>;
  insertPayrollRun(input:Readonly<{tenantId:string;payrollPeriodId:string;workforceProfileId:string;workedMinutes:number;approvedAdjustmentMinutes:number;payableMinutes:number;sourceEventIds:readonly string[];inputsHash:string;preparedAt:string;preparedByIdentityId:string;environmentClass:WorkforceEnvironmentClass}>):Promise<PayrollRunRecord>;
  getPayrollRun(payrollRunId:string):Promise<PayrollRunRecord|null>;
}

export type WorkforceDependencies=Readonly<{unitOfWork:UnitOfWork<WorkforceTransaction>;now?:()=>string;environmentClass?:WorkforceEnvironmentClass;faultInjector?:(point:"after_payroll_period_insert")=>void|Promise<void>}>;

function validation(message:string):never{throw new AppError("VALIDATION_FAILED",message);}
function conflict(message:string):never{throw new AppError("CONFLICT",message);}
function notFound(message:string):never{throw new AppError("NOT_FOUND",message);}
function denied(message:string):never{throw new AppError("PERMISSION_DENIED",message);}
function normalizeUuid(value:string,field:string):string{const v=value?.trim();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))validation(`${field} is invalid`);return v.toLowerCase();}
function normalizeKey(value:string,field:string,max=200):string{const v=value?.trim();if(!v||v.length>max)validation(`${field} is invalid`);return v;}
function normalizeReason(value:string):string{const v=value?.trim().toUpperCase();if(!v||v.length>120||!/^[A-Z0-9][A-Z0-9_.:-]*$/.test(v))validation("reasonCode is invalid");return v;}
function normalizeTimestamp(value:string,field:string):string{if(!Number.isFinite(Date.parse(value)))validation(`${field} is invalid`);return new Date(value).toISOString();}
function normalizeDate(value:string,field:string):string{const v=value?.trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(v))validation(`${field} is invalid`);const ms=Date.parse(`${v}T00:00:00Z`);if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==v)validation(`${field} is invalid`);return v;}
function normalizeAdjustment(value:number):number{if(!Number.isInteger(value)||value===0||value < -1440||value > 1440)validation("requestedAdjustmentMinutes is invalid");return value;}
function serverNow(now?:()=>string):string{const value=(now??(()=>new Date().toISOString()))();if(!Number.isFinite(Date.parse(value)))throw new AppError("RUNTIME_CONFIGURATION_INVALID","Server clock returned invalid timestamp");return new Date(value).toISOString();}
function environment(deps:WorkforceDependencies):WorkforceEnvironmentClass{return deps.environmentClass??"TEST_TEMPORARY";}
function requireEntitlements(context:SecurityContext,required:readonly string[]):void{for(const entitlement of [RISTOAIREN_ENTITLEMENT,...required])if(!context.entitlements.includes(entitlement))throw new AppError("ENTITLEMENT_REQUIRED",`Missing entitlement: ${entitlement}`);}
function requireTenantMembership(context:SecurityContext):void{if(!context.tenantMembershipId&&!context.platformPermissions.includes("platform.override_tenant_scope"))throw new AppError("MEMBERSHIP_REQUIRED","Active Tenant membership is required for workforce runtime");}
function requireLocationMembership(context:SecurityContext):void{if(!context.locationMembershipId&&!context.permissions.includes("tenant.location.all")&&!context.platformPermissions.includes("platform.override_tenant_scope"))throw new AppError("LOCATION_MEMBERSHIP_REQUIRED","Authorized Location scope is required for workforce attendance");}
function authorizeLocation(context:SecurityContext,permission:string,entitlements:readonly string[]):void{requireEntitlements(context,entitlements);requireTenantMembership(context);requireLocationMembership(context);requirePermission(context,permission,{tenantId:context.tenantId,locationId:context.locationId});}
function authorizeTenant(context:SecurityContext,permission:string,entitlements:readonly string[]):void{requireEntitlements(context,entitlements);requireTenantMembership(context);requirePermission(context,permission,{tenantId:context.tenantId});}
function successAudit(context:SecurityContext,actionKey:string,resourceType:string,resourceId:string,metadata:Readonly<Record<string,unknown>>={}):AuditRecord{return Object.freeze({actorIdentityId:context.actorIdentityId,tenantId:context.tenantId,locationId:context.locationId,actionKey,resourceType,resourceId,correlationId:context.correlationId,outcome:"success",metadata});}
function assertActiveProfile(profile:WorkforceProfileRecord|null):WorkforceProfileRecord{if(!profile)notFound("WORKFORCE_PROFILE_NOT_FOUND");if(profile.status!=="ACTIVE")conflict("WORKFORCE_PROFILE_INACTIVE");return profile;}
function assertActiveAssignment(assignment:ShiftAssignmentMaterial|null):ShiftAssignmentMaterial{if(!assignment)notFound("SHIFT_ASSIGNMENT_NOT_FOUND");if(assignment.status!=="ASSIGNED"||assignment.shiftStatus==="CANCELLED")conflict("SHIFT_ASSIGNMENT_NOT_ACTIVE");return assignment;}
function sameEnvironment(actual:WorkforceEnvironmentClass,deps:WorkforceDependencies):void{if(actual!==environment(deps))conflict("WORKFORCE_ENVIRONMENT_MISMATCH");}

export async function getWorkforceSelfSnapshot(context:SecurityContext,deps:WorkforceDependencies):Promise<WorkforceSelfSnapshot>{
  authorizeLocation(context,WORKFORCE_SELF_READ_PERMISSION,[WORKFORCE_ENTITLEMENT]);
  return deps.unitOfWork.transaction(async tx=>{
    const profile=assertActiveProfile(await tx.findSelfWorkforceProfile());
    const [assignments,attendance]=await Promise.all([tx.listSelfShiftAssignments(profile.id),tx.listSelfAttendance(profile.id)]);
    return Object.freeze({profile,assignments:Object.freeze([...assignments]),attendance:Object.freeze([...attendance])});
  },context);
}

export async function recordSelfAttendance(context:SecurityContext,rawInput:Readonly<{shiftAssignmentId:string;eventKind:"CLOCK_IN"|"CLOCK_OUT";occurredAt:string;idempotencyKey:string}>,deps:WorkforceDependencies):Promise<Readonly<{event:AttendanceEventRecord;replayed:boolean}>>{
  authorizeLocation(context,ATTENDANCE_RECORD_SELF_PERMISSION,[WORKFORCE_ENTITLEMENT,ATTENDANCE_ENTITLEMENT]);
  const shiftAssignmentId=normalizeUuid(rawInput.shiftAssignmentId,"shiftAssignmentId"),eventKind=rawInput.eventKind,occurredAt=normalizeTimestamp(rawInput.occurredAt,"occurredAt"),idempotencyKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey");
  if(eventKind!=="CLOCK_IN"&&eventKind!=="CLOCK_OUT")validation("eventKind is invalid");
  return deps.unitOfWork.transaction(async tx=>{
    const profile=assertActiveProfile(await tx.findSelfWorkforceProfile());
    const assignment=assertActiveAssignment(await tx.getShiftAssignment(shiftAssignmentId));
    if(assignment.workforceProfileId!==profile.id)denied("SHIFT_ASSIGNMENT_NOT_FOUND_OR_NOT_SELF");
    sameEnvironment(assignment.environmentClass,deps);
    const existing=await tx.findAttendanceByIdempotencyKey(idempotencyKey);
    if(existing){if(existing.workforceProfileId!==profile.id||existing.shiftAssignmentId!==shiftAssignmentId||existing.eventKind!==eventKind||existing.occurredAt!==occurredAt||existing.relatedEventId!==undefined)conflict("ATTENDANCE_IDEMPOTENCY_CONFLICT");return Object.freeze({event:existing,replayed:true});}
    const event=await tx.insertAttendanceEvent(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,workforceProfileId:profile.id,shiftAssignmentId,eventKind,occurredAt,recordedByIdentityId:context.actorIdentityId,idempotencyKey,correlationId:context.correlationId,environmentClass:assignment.environmentClass}));
    await tx.audit(successAudit(context,ATTENDANCE_EVENT_RECORDED_ACTION,"AttendanceEvent",event.id,Object.freeze({eventKind,shiftAssignmentId})));
    return Object.freeze({event,replayed:false});
  },context);
}

export async function requestSelfAttendanceException(context:SecurityContext,rawInput:Readonly<{sourceAttendanceEventId:string;requestedAdjustmentMinutes:number;reasonCode:string;idempotencyKey:string}>,deps:WorkforceDependencies):Promise<Readonly<{event:AttendanceEventRecord;replayed:boolean}>>{
  authorizeLocation(context,ATTENDANCE_EXCEPTION_REQUEST_SELF_PERMISSION,[WORKFORCE_ENTITLEMENT,ATTENDANCE_ENTITLEMENT]);
  const sourceAttendanceEventId=normalizeUuid(rawInput.sourceAttendanceEventId,"sourceAttendanceEventId"),requestedAdjustmentMinutes=normalizeAdjustment(rawInput.requestedAdjustmentMinutes),reasonCode=normalizeReason(rawInput.reasonCode),idempotencyKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey"),occurredAt=serverNow(deps.now);
  return deps.unitOfWork.transaction(async tx=>{
    const profile=assertActiveProfile(await tx.findSelfWorkforceProfile());
    const source=await tx.getAttendanceEvent(sourceAttendanceEventId);if(!source||source.workforceProfileId!==profile.id||(source.eventKind!=="CLOCK_IN"&&source.eventKind!=="CLOCK_OUT"))denied("ATTENDANCE_SOURCE_NOT_FOUND_OR_NOT_SELF");
    const assignment=assertActiveAssignment(await tx.getShiftAssignment(source.shiftAssignmentId));if(assignment.workforceProfileId!==profile.id)denied("ATTENDANCE_SOURCE_NOT_FOUND_OR_NOT_SELF");sameEnvironment(source.environmentClass,deps);
    const existing=await tx.findAttendanceByIdempotencyKey(idempotencyKey);
    if(existing){if(existing.eventKind!=="EXCEPTION_REQUESTED"||existing.workforceProfileId!==profile.id||existing.shiftAssignmentId!==source.shiftAssignmentId||existing.relatedEventId!==source.id||existing.requestedAdjustmentMinutes!==requestedAdjustmentMinutes||existing.reasonCode!==reasonCode)conflict("ATTENDANCE_IDEMPOTENCY_CONFLICT");return Object.freeze({event:existing,replayed:true});}
    const event=await tx.insertAttendanceEvent(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,workforceProfileId:profile.id,shiftAssignmentId:source.shiftAssignmentId,eventKind:"EXCEPTION_REQUESTED",occurredAt,recordedByIdentityId:context.actorIdentityId,relatedEventId:source.id,requestedAdjustmentMinutes,reasonCode,idempotencyKey,correlationId:context.correlationId,environmentClass:source.environmentClass}));
    await tx.audit(successAudit(context,ATTENDANCE_EXCEPTION_REQUESTED_ACTION,"AttendanceEvent",event.id,Object.freeze({sourceAttendanceEventId:source.id,shiftAssignmentId:source.shiftAssignmentId})));
    return Object.freeze({event,replayed:false});
  },context);
}

export async function decideAttendanceException(context:SecurityContext,rawInput:Readonly<{exceptionRequestEventId:string;decision:"APPROVE"|"REJECT";reasonCode?:string;idempotencyKey:string}>,deps:WorkforceDependencies):Promise<Readonly<{event:AttendanceEventRecord;replayed:boolean}>>{
  authorizeLocation(context,ATTENDANCE_EXCEPTION_APPROVE_PERMISSION,[WORKFORCE_ENTITLEMENT,ATTENDANCE_ENTITLEMENT]);
  const exceptionRequestEventId=normalizeUuid(rawInput.exceptionRequestEventId,"exceptionRequestEventId"),decision=rawInput.decision,idempotencyKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey"),reasonCode=rawInput.reasonCode===undefined?undefined:normalizeReason(rawInput.reasonCode),occurredAt=serverNow(deps.now);
  if(decision!=="APPROVE"&&decision!=="REJECT")validation("decision is invalid");const eventKind:AttendanceEventKind=decision==="APPROVE"?"EXCEPTION_APPROVED":"EXCEPTION_REJECTED";
  return deps.unitOfWork.transaction(async tx=>{
    const request=await tx.lockExceptionRequest(exceptionRequestEventId);if(!request||request.eventKind!=="EXCEPTION_REQUESTED")notFound("ATTENDANCE_EXCEPTION_REQUEST_NOT_FOUND");
    const profile=assertActiveProfile(await tx.getWorkforceProfile(request.workforceProfileId));if(profile.identityId===context.actorIdentityId)denied("ATTENDANCE_EXCEPTION_SELF_APPROVAL_DENIED");
    const assignment=assertActiveAssignment(await tx.getShiftAssignment(request.shiftAssignmentId));if(assignment.workforceProfileId!==profile.id)conflict("ATTENDANCE_EXCEPTION_ASSIGNMENT_MISMATCH");sameEnvironment(request.environmentClass,deps);
    const terminal=await tx.findExceptionDecision(request.id);if(terminal){if(terminal.eventKind===eventKind)return Object.freeze({event:terminal,replayed:true});conflict("ATTENDANCE_EXCEPTION_ALREADY_DECIDED");}
    const byKey=await tx.findAttendanceByIdempotencyKey(idempotencyKey);if(byKey)conflict("ATTENDANCE_IDEMPOTENCY_CONFLICT");
    const event=await tx.insertAttendanceEvent(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,workforceProfileId:profile.id,shiftAssignmentId:request.shiftAssignmentId,eventKind,occurredAt,recordedByIdentityId:context.actorIdentityId,relatedEventId:request.id,...(reasonCode?{reasonCode}:{}),idempotencyKey,correlationId:context.correlationId,environmentClass:request.environmentClass}));
    await tx.audit(successAudit(context,ATTENDANCE_EXCEPTION_DECIDED_ACTION,"AttendanceEvent",event.id,Object.freeze({exceptionRequestEventId:request.id,decision})));
    return Object.freeze({event,replayed:false});
  },context);
}

function derivePayroll(profileId:string,periodStart:string,periodEnd:string,evidence:readonly AttendanceEventRecord[]):Readonly<{workedMinutes:number;approvedAdjustmentMinutes:number;payableMinutes:number;sourceEventIds:readonly string[];inputsHash:string}>{
  const clocks=evidence.filter(event=>event.eventKind==="CLOCK_IN"||event.eventKind==="CLOCK_OUT");if(!clocks.length)conflict("ATTENDANCE_PAIR_INVALID");
  const byAssignment=new Map<string,AttendanceEventRecord[]>();for(const event of clocks){const list=byAssignment.get(event.shiftAssignmentId)??[];list.push(event);byAssignment.set(event.shiftAssignmentId,list);}
  let workedMinutes=0;
  for(const events of byAssignment.values()){
    events.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id));let open:AttendanceEventRecord|undefined;
    for(const event of events){
      if(event.eventKind==="CLOCK_IN"){if(open)conflict("ATTENDANCE_PAIR_INVALID");open=event;continue;}
      if(!open)conflict("ATTENDANCE_PAIR_INVALID");const diff=Date.parse(event.occurredAt)-Date.parse(open.occurredAt);if(diff<=0||diff%60000!==0)conflict("ATTENDANCE_PAIR_INVALID");workedMinutes+=diff/60000;open=undefined;
    }
    if(open)conflict("ATTENDANCE_PAIR_INVALID");
  }
  const requests=evidence.filter(event=>event.eventKind==="EXCEPTION_REQUESTED");const terminalByRequest=new Map<string,AttendanceEventRecord>();for(const event of evidence)if((event.eventKind==="EXCEPTION_APPROVED"||event.eventKind==="EXCEPTION_REJECTED")&&event.relatedEventId)terminalByRequest.set(event.relatedEventId,event);
  let approvedAdjustmentMinutes=0;for(const request of requests){const terminal=terminalByRequest.get(request.id);if(terminal?.eventKind==="EXCEPTION_APPROVED")approvedAdjustmentMinutes+=request.requestedAdjustmentMinutes??0;}
  const payableMinutes=workedMinutes+approvedAdjustmentMinutes;if(payableMinutes<0)conflict("PAYROLL_PREPARATION_NEGATIVE_PAYABLE_MINUTES");
  const canonical=evidence.map(event=>({id:event.id,eventKind:event.eventKind,occurredAt:event.occurredAt,shiftAssignmentId:event.shiftAssignmentId,relatedEventId:event.relatedEventId??null,requestedAdjustmentMinutes:event.requestedAdjustmentMinutes??null})).sort((a,b)=>a.id.localeCompare(b.id));
  const sourceEventIds=Object.freeze(canonical.map(event=>event.id));const inputsHash=createHash("sha256").update(JSON.stringify({profileId,periodStart,periodEnd,evidence:canonical})).digest("hex");
  return Object.freeze({workedMinutes,approvedAdjustmentMinutes,payableMinutes,sourceEventIds,inputsHash});
}

export async function preparePayrollRun(context:SecurityContext,rawInput:Readonly<{periodStart:string;periodEnd:string;targetWorkforceProfileId:string;sourceRequestKey:string}>,deps:WorkforceDependencies):Promise<Readonly<{period:PayrollPeriodRecord;run:PayrollRunRecord;replayed:boolean}>>{
  authorizeLocation(context,PAYROLL_PREPARE_PERMISSION,[WORKFORCE_ENTITLEMENT,ATTENDANCE_ENTITLEMENT,PAYROLL_PREPARATION_ENTITLEMENT]);
  const periodStart=normalizeDate(rawInput.periodStart,"periodStart"),periodEnd=normalizeDate(rawInput.periodEnd,"periodEnd"),targetWorkforceProfileId=normalizeUuid(rawInput.targetWorkforceProfileId,"targetWorkforceProfileId"),sourceRequestKey=normalizeKey(rawInput.sourceRequestKey,"sourceRequestKey");if(periodEnd<periodStart)validation("PAYROLL_PERIOD_INVALID");const preparedAt=serverNow(deps.now);
  return deps.unitOfWork.transaction(async tx=>{
    const profile=assertActiveProfile(await tx.getWorkforceProfile(targetWorkforceProfileId));sameEnvironment(profile.environmentClass,deps);
    const existingPeriod=await tx.findPayrollPeriodByRequestKey(sourceRequestKey);
    if(existingPeriod){
      if(existingPeriod.periodStart!==periodStart||existingPeriod.periodEnd!==periodEnd)conflict("PAYROLL_PREPARATION_IDEMPOTENCY_CONFLICT");
      const existingRun=await tx.findPayrollRun(existingPeriod.id,targetWorkforceProfileId);if(existingRun)return Object.freeze({period:existingPeriod,run:existingRun,replayed:true});
      const anyRun=await tx.findAnyPayrollRun(existingPeriod.id);if(anyRun&&anyRun.workforceProfileId!==targetWorkforceProfileId)conflict("PAYROLL_PREPARATION_IDEMPOTENCY_CONFLICT");
      conflict("PAYROLL_PREPARATION_INCOMPLETE_PERIOD");
    }
    const evidence=await tx.listPayrollEvidence(targetWorkforceProfileId,periodStart,periodEnd);const derived=derivePayroll(targetWorkforceProfileId,periodStart,periodEnd,evidence);
    const period=await tx.insertPayrollPeriod(Object.freeze({tenantId:context.tenantId,periodStart,periodEnd,sourceRequestKey,preparedAt,preparedByIdentityId:context.actorIdentityId,environmentClass:profile.environmentClass}));
    if(deps.faultInjector)await deps.faultInjector("after_payroll_period_insert");
    const run=await tx.insertPayrollRun(Object.freeze({tenantId:context.tenantId,payrollPeriodId:period.id,workforceProfileId:targetWorkforceProfileId,workedMinutes:derived.workedMinutes,approvedAdjustmentMinutes:derived.approvedAdjustmentMinutes,payableMinutes:derived.payableMinutes,sourceEventIds:derived.sourceEventIds,inputsHash:derived.inputsHash,preparedAt,preparedByIdentityId:context.actorIdentityId,environmentClass:profile.environmentClass}));
    await tx.audit(successAudit(context,PAYROLL_PREPARATION_CREATED_ACTION,"PayrollRun",run.id,Object.freeze({payrollPeriodId:period.id,workforceProfileId:profile.id,inputsHash:derived.inputsHash})));
    return Object.freeze({period,run,replayed:false});
  },context);
}

export async function getPreparedPayrollRun(context:SecurityContext,rawInput:Readonly<{payrollRunId:string}>,deps:WorkforceDependencies):Promise<PayrollRunRecord>{
  authorizeTenant(context,PAYROLL_READ_SENSITIVE_PERMISSION,[WORKFORCE_ENTITLEMENT,PAYROLL_PREPARATION_ENTITLEMENT]);const payrollRunId=normalizeUuid(rawInput.payrollRunId,"payrollRunId");
  return deps.unitOfWork.transaction(async tx=>{const run=await tx.getPayrollRun(payrollRunId);if(!run)notFound("PAYROLL_RUN_NOT_FOUND");return run;},context);
}
