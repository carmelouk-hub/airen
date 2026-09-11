import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, hasPermission, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const RISTOAIREN_ENTITLEMENT="vertical.ristoairen";
export const COMPLIANCE_ENTITLEMENT="compliance.enabled";
export const COMPLIANCE_CHECK_READ_PERMISSION="compliance.check.read";
export const COMPLIANCE_CHECK_RECORD_PERMISSION="compliance.check.record";
export const NON_COMPLIANCE_RAISE_PERMISSION="compliance.noncompliance.raise";
export const INCIDENT_RAISE_PERMISSION="compliance.incident.raise";
export const CORRECTIVE_ACTION_READ_PERMISSION="compliance.corrective_action.read";
export const CORRECTIVE_ACTION_ASSIGN_PERMISSION="compliance.corrective_action.assign";
export const CORRECTIVE_ACTION_CLOSE_PERMISSION="compliance.corrective_action.close";
export const CORRECTIVE_ACTION_CLOSE_CRITICAL_PERMISSION="compliance.corrective_action.close_critical";

export const COMPLIANCE_CHECK_RECORDED_ACTION="COMPLIANCE_CHECK_RECORDED";
export const NON_COMPLIANCE_RAISED_ACTION="NON_COMPLIANCE_RAISED";
export const OPERATIONAL_INCIDENT_RAISED_ACTION="OPERATIONAL_INCIDENT_RAISED";
export const CORRECTIVE_ACTION_ASSIGNED_ACTION="CORRECTIVE_ACTION_ASSIGNED";
export const CORRECTIVE_ACTION_CLOSED_ACTION="CORRECTIVE_ACTION_CLOSED";

export type ComplianceEnvironmentClass="DEMO"|"SANDBOX"|"TEST_TEMPORARY";
export type ComplianceSeverity="LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
export type FoodSafetyOutcome="PASS"|"NON_COMPLIANT"|"NOT_APPLICABLE";

export type FoodSafetyControlMaterial=Readonly<{
  id:string;tenantId:string;locationId:string;foodSafetyPlanId:string;active:boolean;rowVersion:number;
  environmentClass:ComplianceEnvironmentClass;planStatus:"DRAFT"|"ACTIVE"|"INACTIVE";planEnvironmentClass:ComplianceEnvironmentClass;
}>;
export type FoodSafetyCheckRecord=Readonly<{
  id:string;tenantId:string;locationId:string;controlDefinitionId:string;scheduledFor?:string;performedAt:string;
  performedByIdentityId:string;outcome:FoodSafetyOutcome;measuredValueText?:string;notes?:string;evidenceReference?:string;
  idempotencyKey:string;correlationId:string;environmentClass:ComplianceEnvironmentClass;
}>;
export type NonComplianceRecord=Readonly<{
  id:string;tenantId:string;locationId:string;foodSafetyCheckId:string;severity:ComplianceSeverity;summary:string;
  status:"OPEN"|"ACTION_REQUIRED"|"RESOLVED";raisedAt:string;raisedByIdentityId:string;correlationId:string;environmentClass:ComplianceEnvironmentClass;
}>;
export type OperationalIncidentRecord=Readonly<{
  id:string;tenantId:string;locationId:string;incidentType:string;severity:ComplianceSeverity;summary:string;occurredAt:string;
  reportedAt:string;reportedByIdentityId:string;status:"OPEN"|"UNDER_REVIEW"|"CLOSED";correlationId:string;environmentClass:ComplianceEnvironmentClass;
}>;
export type CorrectiveActionRecord=Readonly<{
  id:string;tenantId:string;locationId:string;nonComplianceId?:string;operationalIncidentId?:string;actionText:string;
  assignedToIdentityId?:string;dueAt?:string;severity:ComplianceSeverity;status:"OPEN"|"ASSIGNED"|"IN_PROGRESS"|"CLOSED";
  closureSummary?:string;closureEvidenceReference?:string;closedAt?:string;closedByIdentityId?:string;rowVersion:number;
  correlationId:string;environmentClass:ComplianceEnvironmentClass;
}>;
export type ComplianceCaseSnapshot=Readonly<{
  check?:FoodSafetyCheckRecord;nonCompliance?:NonComplianceRecord;incident?:OperationalIncidentRecord;correctiveAction?:CorrectiveActionRecord;
}>;

export interface ComplianceTransaction extends TransactionContext {
  getControlDefinition(controlDefinitionId:string):Promise<FoodSafetyControlMaterial|null>;
  findCheckByIdempotencyKey(controlDefinitionId:string,idempotencyKey:string):Promise<FoodSafetyCheckRecord|null>;
  getCheck(foodSafetyCheckId:string):Promise<FoodSafetyCheckRecord|null>;
  insertCheck(input:Readonly<{tenantId:string;locationId:string;controlDefinitionId:string;scheduledFor?:string;performedAt:string;performedByIdentityId:string;outcome:FoodSafetyOutcome;measuredValueText?:string;notes?:string;evidenceReference?:string;idempotencyKey:string;correlationId:string;environmentClass:ComplianceEnvironmentClass}>):Promise<FoodSafetyCheckRecord>;
  findNonComplianceByCheck(foodSafetyCheckId:string):Promise<NonComplianceRecord|null>;
  getNonCompliance(nonComplianceId:string):Promise<NonComplianceRecord|null>;
  insertNonCompliance(input:Readonly<{tenantId:string;locationId:string;foodSafetyCheckId:string;severity:ComplianceSeverity;summary:string;raisedAt:string;raisedByIdentityId:string;correlationId:string;environmentClass:ComplianceEnvironmentClass}>):Promise<NonComplianceRecord>;
  getIncident(operationalIncidentId:string):Promise<OperationalIncidentRecord|null>;
  insertIncident(input:Readonly<{tenantId:string;locationId:string;incidentType:string;severity:ComplianceSeverity;summary:string;occurredAt:string;reportedAt:string;reportedByIdentityId:string;correlationId:string;environmentClass:ComplianceEnvironmentClass}>):Promise<OperationalIncidentRecord>;
  getCorrectiveAction(correctiveActionId:string):Promise<CorrectiveActionRecord|null>;
  lockCorrectiveAction(correctiveActionId:string):Promise<CorrectiveActionRecord|null>;
  insertCorrectiveAction(input:Readonly<{tenantId:string;locationId:string;nonComplianceId?:string;operationalIncidentId?:string;actionText:string;assignedToIdentityId?:string;dueAt?:string;severity:ComplianceSeverity;status:"OPEN"|"ASSIGNED";correlationId:string;environmentClass:ComplianceEnvironmentClass}>):Promise<CorrectiveActionRecord>;
  closeCorrectiveAction(input:Readonly<{correctiveActionId:string;expectedRowVersion:number;closureSummary:string;closureEvidenceReference?:string;closedAt:string;closedByIdentityId:string}>):Promise<CorrectiveActionRecord|null>;
}

export type ComplianceFaultPoint="after_check_insert"|"after_non_compliance_insert"|"after_incident_insert"|"after_corrective_action_insert"|"after_corrective_action_close";
export type ComplianceDependencies=Readonly<{unitOfWork:UnitOfWork<ComplianceTransaction>;now?:()=>string;environmentClass?:ComplianceEnvironmentClass;faultInjector?:(point:ComplianceFaultPoint)=>void|Promise<void>}>;

function validation(message:string):never{throw new AppError("VALIDATION_FAILED",message);}
function conflict(message:string):never{throw new AppError("CONFLICT",message);}
function notFound(message:string):never{throw new AppError("NOT_FOUND",message);}
function normalizeUuid(value:string,field:string):string{const v=value?.trim();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))validation(`${field} is invalid`);return v.toLowerCase();}
function normalizeText(value:string,field:string,max:number):string{const v=value?.trim();if(!v||v.length>max)validation(`${field} is invalid`);return v;}
function optionalText(value:string|undefined,field:string,max:number):string|undefined{return value===undefined?undefined:normalizeText(value,field,max);}
function normalizeTimestamp(value:string,field:string):string{if(!Number.isFinite(Date.parse(value)))validation(`${field} is invalid`);return new Date(value).toISOString();}
function optionalTimestamp(value:string|undefined,field:string):string|undefined{return value===undefined?undefined:normalizeTimestamp(value,field);}
function normalizeSeverity(value:ComplianceSeverity):ComplianceSeverity{if(!["LOW","MEDIUM","HIGH","CRITICAL"].includes(value))validation("severity is invalid");return value;}
function normalizeOutcome(value:FoodSafetyOutcome):FoodSafetyOutcome{if(!["PASS","NON_COMPLIANT","NOT_APPLICABLE"].includes(value))validation("outcome is invalid");return value;}
function normalizeIncidentType(value:string):string{const v=normalizeText(value,"incidentType",120).toUpperCase();if(!/^[A-Z0-9][A-Z0-9_.:-]*$/.test(v))validation("incidentType is invalid");return v;}
function serverNow(now?:()=>string):string{const raw=(now??(()=>new Date().toISOString()))();if(!Number.isFinite(Date.parse(raw)))throw new AppError("RUNTIME_CONFIGURATION_INVALID","Server clock returned invalid timestamp");return new Date(raw).toISOString();}
function environment(deps:ComplianceDependencies):ComplianceEnvironmentClass{return deps.environmentClass??"TEST_TEMPORARY";}
function requireEntitlements(context:SecurityContext):void{for(const key of [RISTOAIREN_ENTITLEMENT,COMPLIANCE_ENTITLEMENT])if(!context.entitlements.includes(key))throw new AppError("ENTITLEMENT_REQUIRED",`Missing entitlement: ${key}`);}
function requireMembership(context:SecurityContext):void{if(!context.tenantMembershipId&&!context.platformPermissions.includes("platform.override_tenant_scope"))throw new AppError("MEMBERSHIP_REQUIRED","Active Tenant membership is required for compliance runtime");if(!context.locationMembershipId&&!context.permissions.includes("tenant.location.all")&&!context.platformPermissions.includes("platform.override_tenant_scope"))throw new AppError("LOCATION_MEMBERSHIP_REQUIRED","Authorized Location scope is required for compliance runtime");}
function authorize(context:SecurityContext,permission:string):void{requireEntitlements(context);requireMembership(context);requirePermission(context,permission,{tenantId:context.tenantId,locationId:context.locationId});}
function assertEnvironment(actual:ComplianceEnvironmentClass,deps:ComplianceDependencies):void{if(actual!==environment(deps))conflict("COMPLIANCE_ENVIRONMENT_MISMATCH");}
function audit(context:SecurityContext,actionKey:string,resourceType:string,resourceId:string,metadata:Readonly<Record<string,unknown>>={}):AuditRecord{return Object.freeze({actorIdentityId:context.actorIdentityId,tenantId:context.tenantId,locationId:context.locationId,actionKey,resourceType,resourceId,correlationId:context.correlationId,outcome:"success",metadata});}
function sameOptional(a:string|undefined,b:string|undefined):boolean{return a===b;}

export async function getCaseSnapshot(context:SecurityContext,rawInput:Readonly<{checkId?:string;nonComplianceId?:string;incidentId?:string;correctiveActionId?:string}>,deps:ComplianceDependencies):Promise<ComplianceCaseSnapshot>{
  const supplied=[rawInput.checkId,rawInput.nonComplianceId,rawInput.incidentId,rawInput.correctiveActionId].filter((v):v is string=>v!==undefined);
  if(supplied.length!==1)validation("Exactly one compliance case identifier is required");
  if(rawInput.incidentId!==undefined||rawInput.correctiveActionId!==undefined)authorize(context,CORRECTIVE_ACTION_READ_PERMISSION);else authorize(context,COMPLIANCE_CHECK_READ_PERMISSION);
  return deps.unitOfWork.transaction(async tx=>{
    if(rawInput.checkId!==undefined){const check=await tx.getCheck(normalizeUuid(rawInput.checkId,"checkId"));if(!check)notFound("COMPLIANCE_CHECK_NOT_FOUND");return Object.freeze({check});}
    if(rawInput.nonComplianceId!==undefined){const nonCompliance=await tx.getNonCompliance(normalizeUuid(rawInput.nonComplianceId,"nonComplianceId"));if(!nonCompliance)notFound("NON_COMPLIANCE_NOT_FOUND");return Object.freeze({nonCompliance});}
    if(rawInput.incidentId!==undefined){const incident=await tx.getIncident(normalizeUuid(rawInput.incidentId,"incidentId"));if(!incident)notFound("OPERATIONAL_INCIDENT_NOT_FOUND");return Object.freeze({incident});}
    const correctiveAction=await tx.getCorrectiveAction(normalizeUuid(rawInput.correctiveActionId!,"correctiveActionId"));if(!correctiveAction)notFound("CORRECTIVE_ACTION_NOT_FOUND");return Object.freeze({correctiveAction});
  },context);
}

export async function recordCheck(context:SecurityContext,rawInput:Readonly<{controlDefinitionId:string;scheduledFor?:string;outcome:FoodSafetyOutcome;measuredValueText?:string;notes?:string;evidenceReference?:string;idempotencyKey:string}>,deps:ComplianceDependencies):Promise<Readonly<{check:FoodSafetyCheckRecord;replayed:boolean}>>{
  authorize(context,COMPLIANCE_CHECK_RECORD_PERMISSION);
  const controlDefinitionId=normalizeUuid(rawInput.controlDefinitionId,"controlDefinitionId"),scheduledFor=optionalTimestamp(rawInput.scheduledFor,"scheduledFor"),outcome=normalizeOutcome(rawInput.outcome),measuredValueText=optionalText(rawInput.measuredValueText,"measuredValueText",500),notes=optionalText(rawInput.notes,"notes",2000),evidenceReference=optionalText(rawInput.evidenceReference,"evidenceReference",1000),idempotencyKey=normalizeText(rawInput.idempotencyKey,"idempotencyKey",200),performedAt=serverNow(deps.now);
  return deps.unitOfWork.transaction(async tx=>{
    const control=await tx.getControlDefinition(controlDefinitionId);if(!control)notFound("COMPLIANCE_CONTROL_NOT_FOUND");if(!control.active||control.planStatus!=="ACTIVE")conflict("COMPLIANCE_CONTROL_NOT_ACTIVE");assertEnvironment(control.environmentClass,deps);assertEnvironment(control.planEnvironmentClass,deps);
    const existing=await tx.findCheckByIdempotencyKey(controlDefinitionId,idempotencyKey);
    if(existing){if(existing.outcome!==outcome||!sameOptional(existing.scheduledFor,scheduledFor)||!sameOptional(existing.measuredValueText,measuredValueText)||!sameOptional(existing.notes,notes)||!sameOptional(existing.evidenceReference,evidenceReference))conflict("COMPLIANCE_CHECK_IDEMPOTENCY_CONFLICT");return Object.freeze({check:existing,replayed:true});}
    const check=await tx.insertCheck(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,controlDefinitionId,scheduledFor,performedAt,performedByIdentityId:context.actorIdentityId,outcome,measuredValueText,notes,evidenceReference,idempotencyKey,correlationId:context.correlationId,environmentClass:environment(deps)}));
    await deps.faultInjector?.("after_check_insert");await tx.audit(audit(context,COMPLIANCE_CHECK_RECORDED_ACTION,"FoodSafetyCheck",check.id,Object.freeze({controlDefinitionId,outcome})));
    return Object.freeze({check,replayed:false});
  },context);
}

export async function raiseNonCompliance(context:SecurityContext,rawInput:Readonly<{foodSafetyCheckId:string;severity:ComplianceSeverity;summary:string}>,deps:ComplianceDependencies):Promise<Readonly<{nonCompliance:NonComplianceRecord;replayed:boolean}>>{
  authorize(context,NON_COMPLIANCE_RAISE_PERMISSION);
  const foodSafetyCheckId=normalizeUuid(rawInput.foodSafetyCheckId,"foodSafetyCheckId"),severity=normalizeSeverity(rawInput.severity),summary=normalizeText(rawInput.summary,"summary",2000),raisedAt=serverNow(deps.now);
  return deps.unitOfWork.transaction(async tx=>{
    const check=await tx.getCheck(foodSafetyCheckId);if(!check)notFound("COMPLIANCE_CHECK_NOT_FOUND");if(check.outcome!=="NON_COMPLIANT")conflict("CHECK_NOT_NONCOMPLIANT");assertEnvironment(check.environmentClass,deps);
    const existing=await tx.findNonComplianceByCheck(foodSafetyCheckId);if(existing){if(existing.severity!==severity||existing.summary!==summary)conflict("NON_COMPLIANCE_SOURCE_CONFLICT");return Object.freeze({nonCompliance:existing,replayed:true});}
    const nonCompliance=await tx.insertNonCompliance(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,foodSafetyCheckId,severity,summary,raisedAt,raisedByIdentityId:context.actorIdentityId,correlationId:context.correlationId,environmentClass:environment(deps)}));
    await deps.faultInjector?.("after_non_compliance_insert");await tx.audit(audit(context,NON_COMPLIANCE_RAISED_ACTION,"NonCompliance",nonCompliance.id,Object.freeze({foodSafetyCheckId,severity})));
    return Object.freeze({nonCompliance,replayed:false});
  },context);
}

export async function raiseIncident(context:SecurityContext,rawInput:Readonly<{incidentType:string;severity:ComplianceSeverity;summary:string;occurredAt:string}>,deps:ComplianceDependencies):Promise<OperationalIncidentRecord>{
  authorize(context,INCIDENT_RAISE_PERMISSION);
  const incidentType=normalizeIncidentType(rawInput.incidentType),severity=normalizeSeverity(rawInput.severity),summary=normalizeText(rawInput.summary,"summary",2000),occurredAt=normalizeTimestamp(rawInput.occurredAt,"occurredAt"),reportedAt=serverNow(deps.now);
  return deps.unitOfWork.transaction(async tx=>{
    const incident=await tx.insertIncident(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,incidentType,severity,summary,occurredAt,reportedAt,reportedByIdentityId:context.actorIdentityId,correlationId:context.correlationId,environmentClass:environment(deps)}));
    await deps.faultInjector?.("after_incident_insert");await tx.audit(audit(context,OPERATIONAL_INCIDENT_RAISED_ACTION,"OperationalIncident",incident.id,Object.freeze({incidentType,severity})));
    return incident;
  },context);
}

export async function assignCorrectiveAction(context:SecurityContext,rawInput:Readonly<{nonComplianceId?:string;operationalIncidentId?:string;actionText:string;assignedToIdentityId?:string;dueAt?:string;severity:ComplianceSeverity}>,deps:ComplianceDependencies):Promise<CorrectiveActionRecord>{
  authorize(context,CORRECTIVE_ACTION_ASSIGN_PERMISSION);
  if((rawInput.nonComplianceId===undefined)===(rawInput.operationalIncidentId===undefined))validation("Exactly one governed corrective-action source is required");
  const nonComplianceId=rawInput.nonComplianceId===undefined?undefined:normalizeUuid(rawInput.nonComplianceId,"nonComplianceId"),operationalIncidentId=rawInput.operationalIncidentId===undefined?undefined:normalizeUuid(rawInput.operationalIncidentId,"operationalIncidentId"),actionText=normalizeText(rawInput.actionText,"actionText",2000),assignedToIdentityId=rawInput.assignedToIdentityId===undefined?undefined:normalizeUuid(rawInput.assignedToIdentityId,"assignedToIdentityId"),dueAt=optionalTimestamp(rawInput.dueAt,"dueAt"),severity=normalizeSeverity(rawInput.severity),status=assignedToIdentityId?"ASSIGNED" as const:"OPEN" as const;
  return deps.unitOfWork.transaction(async tx=>{
    let sourceEnvironment:ComplianceEnvironmentClass;
    if(nonComplianceId){const source=await tx.getNonCompliance(nonComplianceId);if(!source)notFound("NON_COMPLIANCE_NOT_FOUND");if(source.status==="RESOLVED")conflict("CORRECTIVE_ACTION_SOURCE_NOT_ACTIONABLE");sourceEnvironment=source.environmentClass;}else{const source=await tx.getIncident(operationalIncidentId!);if(!source)notFound("OPERATIONAL_INCIDENT_NOT_FOUND");if(source.status==="CLOSED")conflict("CORRECTIVE_ACTION_SOURCE_NOT_ACTIONABLE");sourceEnvironment=source.environmentClass;}
    assertEnvironment(sourceEnvironment,deps);
    const correctiveAction=await tx.insertCorrectiveAction(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,nonComplianceId,operationalIncidentId,actionText,assignedToIdentityId,dueAt,severity,status,correlationId:context.correlationId,environmentClass:environment(deps)}));
    await deps.faultInjector?.("after_corrective_action_insert");await tx.audit(audit(context,CORRECTIVE_ACTION_ASSIGNED_ACTION,"CorrectiveAction",correctiveAction.id,Object.freeze({sourceType:nonComplianceId?"NonCompliance":"OperationalIncident",severity,assigned:Boolean(assignedToIdentityId)})));
    return correctiveAction;
  },context);
}

export async function closeCorrectiveAction(context:SecurityContext,rawInput:Readonly<{correctiveActionId:string;expectedRowVersion:number;closureSummary:string;closureEvidenceReference?:string}>,deps:ComplianceDependencies):Promise<CorrectiveActionRecord>{
  requireEntitlements(context);requireMembership(context);
  if(!hasPermission(context,CORRECTIVE_ACTION_CLOSE_PERMISSION)&&!hasPermission(context,CORRECTIVE_ACTION_CLOSE_CRITICAL_PERMISSION))throw new AppError("PERMISSION_DENIED","A corrective-action close permission is required");
  const correctiveActionId=normalizeUuid(rawInput.correctiveActionId,"correctiveActionId"),expectedRowVersion=rawInput.expectedRowVersion,closureSummary=normalizeText(rawInput.closureSummary,"closureSummary",2000),closureEvidenceReference=optionalText(rawInput.closureEvidenceReference,"closureEvidenceReference",1000),closedAt=serverNow(deps.now);
  if(!Number.isInteger(expectedRowVersion)||expectedRowVersion<1)validation("expectedRowVersion is invalid");
  return deps.unitOfWork.transaction(async tx=>{
    const current=await tx.lockCorrectiveAction(correctiveActionId);if(!current)notFound("CORRECTIVE_ACTION_NOT_FOUND");assertEnvironment(current.environmentClass,deps);if(current.status==="CLOSED")conflict("CORRECTIVE_ACTION_ALREADY_CLOSED");if(current.rowVersion!==expectedRowVersion)conflict("CORRECTIVE_ACTION_VERSION_CONFLICT");
    requirePermission(context,current.severity==="CRITICAL"?CORRECTIVE_ACTION_CLOSE_CRITICAL_PERMISSION:CORRECTIVE_ACTION_CLOSE_PERMISSION,{tenantId:context.tenantId,locationId:context.locationId});
    const closed=await tx.closeCorrectiveAction(Object.freeze({correctiveActionId,expectedRowVersion,closureSummary,closureEvidenceReference,closedAt,closedByIdentityId:context.actorIdentityId}));if(!closed)conflict("CORRECTIVE_ACTION_VERSION_CONFLICT");
    await deps.faultInjector?.("after_corrective_action_close");await tx.audit(audit(context,CORRECTIVE_ACTION_CLOSED_ACTION,"CorrectiveAction",closed.id,Object.freeze({severity:closed.severity,critical:closed.severity==="CRITICAL",expectedRowVersion})));
    return closed;
  },context);
}
