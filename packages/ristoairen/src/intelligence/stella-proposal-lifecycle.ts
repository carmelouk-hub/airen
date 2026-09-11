import { createHash } from "node:crypto";
import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const INTELLIGENCE_ENTITLEMENT = "intelligence.enabled";
export const PROPOSAL_READ_PERMISSION = "intelligence.proposal.read";
export const PROPOSAL_CREATE_PERMISSION = "intelligence.proposal.create";
export const PROPOSAL_REVIEW_PERMISSION = "intelligence.proposal.review";
export const PROPOSAL_APPLY_PERMISSION = "intelligence.proposal.apply";

export const PROPOSAL_CREATED_ACTION = "DECISION_PROPOSAL_CREATED";
export const PROPOSAL_APPROVED_ACTION = "DECISION_PROPOSAL_APPROVED";
export const PROPOSAL_REJECTED_ACTION = "DECISION_PROPOSAL_REJECTED";
export const PROPOSAL_INVALIDATED_ACTION = "DECISION_PROPOSAL_INVALIDATED";
export const PROPOSAL_APPLIED_ACTION = "DECISION_PROPOSAL_APPLIED";

export type IntelligenceEnvironmentClass = "DEMO" | "SANDBOX" | "TEST_TEMPORARY";
export type ProposalStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "INVALIDATED" | "APPLIED";
export type ProposalReviewDecision = "APPROVE" | "REJECT";

export type ProposalEvidenceInput = Readonly<{
  sourceDomain: string;
  sourceReference: string;
  sourceRowVersion?: number;
  evidenceHash: string;
  observedAt: string;
}>;

export type ProposalEvidenceRecord = Readonly<ProposalEvidenceInput & {
  id: string;
  tenantId: string;
  locationId: string;
  proposalId: string;
  ordinal: number;
}>;

export type DecisionProposalRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  subjectDomain: string;
  subjectReference: string;
  recommendation: string;
  rationale: string;
  proposalHash: string;
  status: ProposalStatus;
  targetRowVersion?: number;
  createdByIdentityId: string;
  createIdempotencyKey: string;
  reviewedByIdentityId?: string;
  reviewedAt?: string;
  reviewDecision?: ProposalReviewDecision;
  reviewIdempotencyKey?: string;
  appliedByIdentityId?: string;
  appliedAt?: string;
  applyIdempotencyKey?: string;
  targetEffectReference?: string;
  appliedTargetRowVersion?: number;
  invalidatedAt?: string;
  invalidationReason?: string;
  rowVersion: number;
  correlationId: string;
  environmentClass: IntelligenceEnvironmentClass;
}>;

export type CreateDecisionProposalInput = Readonly<{
  subjectDomain: string;
  subjectReference: string;
  recommendation: string;
  rationale: string;
  evidence: readonly ProposalEvidenceInput[];
  targetRowVersion?: number;
  idempotencyKey: string;
}>;

export type ReviewDecisionProposalInput = Readonly<{
  proposalId: string;
  decision: ProposalReviewDecision;
  expectedRowVersion: number;
  idempotencyKey: string;
}>;

export type ApplyDecisionProposalInput = Readonly<{
  proposalId: string;
  expectedProposalRowVersion: number;
  idempotencyKey: string;
}>;

export interface StellaProposalTransaction extends TransactionContext {
  findProposalByCreateKey(idempotencyKey: string): Promise<DecisionProposalRecord | null>;
  findProposalByReviewKey(idempotencyKey: string): Promise<DecisionProposalRecord | null>;
  findProposalByApplyKey(idempotencyKey: string): Promise<DecisionProposalRecord | null>;
  getProposal(proposalId: string, forUpdate: boolean): Promise<DecisionProposalRecord | null>;
  insertProposal(input: Readonly<{
    tenantId: string; locationId: string; subjectDomain: string; subjectReference: string; recommendation: string; rationale: string;
    proposalHash: string; targetRowVersion?: number; createdByIdentityId: string; createIdempotencyKey: string; correlationId: string;
    environmentClass: IntelligenceEnvironmentClass;
  }>): Promise<DecisionProposalRecord>;
  insertEvidence(input: Readonly<{
    tenantId: string; locationId: string; proposalId: string; ordinal: number; sourceDomain: string; sourceReference: string;
    sourceRowVersion?: number; evidenceHash: string; observedAt: string;
  }>): Promise<ProposalEvidenceRecord>;
  listEvidence(proposalId: string): Promise<readonly ProposalEvidenceRecord[]>;
  reviewProposal(input: Readonly<{
    proposalId: string; expectedRowVersion: number; decision: ProposalReviewDecision; reviewedByIdentityId: string; reviewedAt: string;
    reviewIdempotencyKey: string;
  }>): Promise<DecisionProposalRecord | null>;
  invalidateProposal(input: Readonly<{
    proposalId: string; expectedRowVersion: number; invalidatedAt: string; invalidationReason: string;
  }>): Promise<DecisionProposalRecord | null>;
  markProposalApplied(input: Readonly<{
    proposalId: string; expectedRowVersion: number; appliedByIdentityId: string; appliedAt: string; applyIdempotencyKey: string;
    targetEffectReference: string; appliedTargetRowVersion?: number;
  }>): Promise<DecisionProposalRecord | null>;
}

export type AppliedProposalTargetEffect = Readonly<{
  effectReference: string;
  targetRowVersion?: number;
}>;

export interface GovernedProposalTargetService {
  findAppliedEffect(context: SecurityContext, input: Readonly<{
    proposal: DecisionProposalRecord;
    idempotencyKey: string;
  }>): Promise<AppliedProposalTargetEffect | null>;
  currentRowVersion(context: SecurityContext, proposal: DecisionProposalRecord): Promise<number | undefined>;
  applyApprovedProposal(context: SecurityContext, input: Readonly<{
    proposal: DecisionProposalRecord;
    evidence: readonly ProposalEvidenceRecord[];
    idempotencyKey: string;
  }>): Promise<Readonly<{ effectReference: string; targetRowVersion?: number; replayed: boolean }>>;
}

export type StellaProposalFaultPoint = "after_target_apply";
export type StellaProposalDependencies = Readonly<{
  unitOfWork: UnitOfWork<StellaProposalTransaction>;
  targetService: GovernedProposalTargetService;
  now?: () => string;
  environmentClass?: IntelligenceEnvironmentClass;
  faultInjector?: (point: StellaProposalFaultPoint) => void | Promise<void>;
}>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;

function validation(message: string): never { throw new AppError("VALIDATION_FAILED", message); }
function conflict(message: string): never { throw new AppError("CONFLICT", message); }
function notFound(message: string): never { throw new AppError("NOT_FOUND", message); }
function permissionDenied(message: string): never { throw new AppError("PERMISSION_DENIED", message); }
function text(value: string, field: string, max: number): string { const v=value?.trim(); if (!v || v.length>max) validation(`${field} is invalid`); return v; }
function uuid(value: string, field: string): string { const v=value?.trim(); if (!UUID_RE.test(v)) validation(`${field} is invalid`); return v.toLowerCase(); }
function nonNegativeInteger(value: number | undefined, field: string): number | undefined { if (value===undefined) return undefined; if (!Number.isInteger(value) || value<0) validation(`${field} is invalid`); return value; }
function timestamp(value: string, field: string): string { if (!Number.isFinite(Date.parse(value))) validation(`${field} is invalid`); return new Date(value).toISOString(); }
function now(deps: StellaProposalDependencies): string { const value=(deps.now??(()=>new Date().toISOString()))(); if (!Number.isFinite(Date.parse(value))) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Server clock returned invalid timestamp"); return new Date(value).toISOString(); }
function environment(deps: StellaProposalDependencies): IntelligenceEnvironmentClass { return deps.environmentClass??"TEST_TEMPORARY"; }
function idempotencyKey(value: string): string { return text(value,"idempotencyKey",200); }
function isStella(context: SecurityContext): boolean { return context.platformRoles.includes("AI_STELLA"); }
function humanOnly(context: SecurityContext): void { if (isStella(context)) permissionDenied("AI_STELLA cannot review or apply DecisionProposal"); }
function membership(context: SecurityContext): void {
  if (!context.tenantMembershipId && !context.platformPermissions.includes("platform.override_tenant_scope")) throw new AppError("MEMBERSHIP_REQUIRED","Active Tenant membership is required for intelligence runtime");
  if (!context.locationMembershipId && !context.permissions.includes("tenant.location.all") && !context.platformPermissions.includes("platform.override_tenant_scope")) throw new AppError("LOCATION_MEMBERSHIP_REQUIRED","Authorized Location scope is required for intelligence runtime");
}
function authority(context: SecurityContext, permission: string): void {
  for (const entitlement of [RISTOAIREN_ENTITLEMENT,INTELLIGENCE_ENTITLEMENT]) if (!context.entitlements.includes(entitlement)) throw new AppError("ENTITLEMENT_REQUIRED",`Missing entitlement: ${entitlement}`);
  membership(context);
  requirePermission(context,permission,{tenantId:context.tenantId,locationId:context.locationId});
}
function audit(context: SecurityContext, actionKey: string, resourceId: string, metadata: Readonly<Record<string,unknown>>={}): AuditRecord {
  return Object.freeze({actorIdentityId:context.actorIdentityId,tenantId:context.tenantId,locationId:context.locationId,actionKey,resourceType:"DecisionProposal",resourceId,correlationId:context.correlationId,outcome:"success",metadata});
}

function normalizeEvidence(input: readonly ProposalEvidenceInput[]): readonly ProposalEvidenceInput[] {
  if (!Array.isArray(input) || input.length===0 || input.length>100) validation("evidence must contain between 1 and 100 items");
  return Object.freeze(input.map((item,index)=>Object.freeze({
    sourceDomain:text(item.sourceDomain,`evidence[${index}].sourceDomain`,120),
    sourceReference:text(item.sourceReference,`evidence[${index}].sourceReference`,240),
    ...(item.sourceRowVersion===undefined?{}:{sourceRowVersion:nonNegativeInteger(item.sourceRowVersion,`evidence[${index}].sourceRowVersion`)!}),
    evidenceHash:(()=>{const value=item.evidenceHash?.trim().toLowerCase();if(!HASH_RE.test(value))validation(`evidence[${index}].evidenceHash is invalid`);return value;})(),
    observedAt:timestamp(item.observedAt,`evidence[${index}].observedAt`),
  })));
}

function proposalFingerprint(input: Readonly<{subjectDomain:string;subjectReference:string;recommendation:string;rationale:string;evidence:readonly ProposalEvidenceInput[];targetRowVersion?:number}>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function stableTargetApplyKey(proposalId: string): string { return `stella-proposal:${proposalId}:apply`; }

export async function getDecisionProposal(context: SecurityContext, rawProposalId: string, deps: StellaProposalDependencies): Promise<Readonly<{proposal:DecisionProposalRecord;evidence:readonly ProposalEvidenceRecord[]}>> {
  authority(context,PROPOSAL_READ_PERMISSION);
  const proposalId=uuid(rawProposalId,"proposalId");
  return deps.unitOfWork.transaction(async tx=>{
    const proposal=await tx.getProposal(proposalId,false); if(!proposal) notFound("DECISION_PROPOSAL_NOT_FOUND");
    const evidence=await tx.listEvidence(proposalId);
    return Object.freeze({proposal,evidence});
  },context);
}

export async function createDecisionProposal(context: SecurityContext, rawInput: CreateDecisionProposalInput, deps: StellaProposalDependencies): Promise<Readonly<{proposal:DecisionProposalRecord;evidence:readonly ProposalEvidenceRecord[];replayed:boolean}>> {
  authority(context,PROPOSAL_CREATE_PERMISSION);
  const subjectDomain=text(rawInput.subjectDomain,"subjectDomain",120),subjectReference=text(rawInput.subjectReference,"subjectReference",240),recommendation=text(rawInput.recommendation,"recommendation",4000),rationale=text(rawInput.rationale,"rationale",4000),evidence=normalizeEvidence(rawInput.evidence),targetRowVersion=nonNegativeInteger(rawInput.targetRowVersion,"targetRowVersion"),createKey=idempotencyKey(rawInput.idempotencyKey);
  const proposalHash=proposalFingerprint(Object.freeze({subjectDomain,subjectReference,recommendation,rationale,evidence,...(targetRowVersion===undefined?{}:{targetRowVersion})}));
  return deps.unitOfWork.transaction(async tx=>{
    const existing=await tx.findProposalByCreateKey(createKey);
    if(existing){if(existing.proposalHash!==proposalHash)conflict("DECISION_PROPOSAL_IDEMPOTENCY_CONFLICT");return Object.freeze({proposal:existing,evidence:await tx.listEvidence(existing.id),replayed:true});}
    const proposal=await tx.insertProposal(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,subjectDomain,subjectReference,recommendation,rationale,proposalHash,...(targetRowVersion===undefined?{}:{targetRowVersion}),createdByIdentityId:context.actorIdentityId,createIdempotencyKey:createKey,correlationId:context.correlationId,environmentClass:environment(deps)}));
    const stored:ProposalEvidenceRecord[]=[];
    for(let ordinal=0;ordinal<evidence.length;ordinal++) stored.push(await tx.insertEvidence(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,proposalId:proposal.id,ordinal,...evidence[ordinal]})));
    await tx.audit(audit(context,PROPOSAL_CREATED_ACTION,proposal.id,Object.freeze({subjectDomain,subjectReference,evidenceCount:stored.length,createdByStella:isStella(context),targetRowVersion})));
    return Object.freeze({proposal,evidence:Object.freeze(stored),replayed:false});
  },context);
}

export async function reviewDecisionProposal(context: SecurityContext, rawInput: ReviewDecisionProposalInput, deps: StellaProposalDependencies): Promise<Readonly<{proposal:DecisionProposalRecord;replayed:boolean}>> {
  humanOnly(context); authority(context,PROPOSAL_REVIEW_PERMISSION);
  const proposalId=uuid(rawInput.proposalId,"proposalId"),decision=rawInput.decision,expectedRowVersion=nonNegativeInteger(rawInput.expectedRowVersion,"expectedRowVersion")!,reviewKey=idempotencyKey(rawInput.idempotencyKey),reviewedAt=now(deps);
  if(!["APPROVE","REJECT"].includes(decision))validation("decision is invalid");
  return deps.unitOfWork.transaction(async tx=>{
    const replay=await tx.findProposalByReviewKey(reviewKey);
    if(replay){if(replay.id!==proposalId||replay.reviewDecision!==decision)conflict("DECISION_PROPOSAL_REVIEW_IDEMPOTENCY_CONFLICT");return Object.freeze({proposal:replay,replayed:true});}
    const current=await tx.getProposal(proposalId,true);if(!current)notFound("DECISION_PROPOSAL_NOT_FOUND");if(current.status!=="PENDING_APPROVAL")conflict("DECISION_PROPOSAL_NOT_PENDING");if(current.rowVersion!==expectedRowVersion)conflict("DECISION_PROPOSAL_VERSION_CONFLICT");
    const proposal=await tx.reviewProposal(Object.freeze({proposalId,expectedRowVersion,decision,reviewedByIdentityId:context.actorIdentityId,reviewedAt,reviewIdempotencyKey:reviewKey}));if(!proposal)conflict("DECISION_PROPOSAL_VERSION_CONFLICT");
    await tx.audit(audit(context,decision==="APPROVE"?PROPOSAL_APPROVED_ACTION:PROPOSAL_REJECTED_ACTION,proposal.id,Object.freeze({expectedRowVersion,decision})));
    return Object.freeze({proposal,replayed:false});
  },context);
}

export async function applyDecisionProposal(context: SecurityContext, rawInput: ApplyDecisionProposalInput, deps: StellaProposalDependencies): Promise<Readonly<{proposal:DecisionProposalRecord;targetReplayed:boolean;replayed:boolean}>> {
  humanOnly(context); authority(context,PROPOSAL_APPLY_PERMISSION);
  const proposalId=uuid(rawInput.proposalId,"proposalId"),expectedProposalRowVersion=nonNegativeInteger(rawInput.expectedProposalRowVersion,"expectedProposalRowVersion")!,applyKey=idempotencyKey(rawInput.idempotencyKey);

  const snapshot=await deps.unitOfWork.transaction(async tx=>{
    const replay=await tx.findProposalByApplyKey(applyKey);
    if(replay){if(replay.id!==proposalId)conflict("DECISION_PROPOSAL_APPLY_IDEMPOTENCY_CONFLICT");if(replay.status!=="APPLIED")conflict("DECISION_PROPOSAL_APPLY_REPLAY_NOT_APPLIED");return Object.freeze({proposal:replay,evidence:await tx.listEvidence(replay.id),alreadyApplied:true});}
    const proposal=await tx.getProposal(proposalId,true);if(!proposal)notFound("DECISION_PROPOSAL_NOT_FOUND");if(proposal.status!=="APPROVED")conflict("DECISION_PROPOSAL_NOT_APPROVED");if(proposal.rowVersion!==expectedProposalRowVersion)conflict("DECISION_PROPOSAL_VERSION_CONFLICT");
    return Object.freeze({proposal,evidence:await tx.listEvidence(proposal.id),alreadyApplied:false});
  },context);
  if(snapshot.alreadyApplied)return Object.freeze({proposal:snapshot.proposal,targetReplayed:true,replayed:true});

  const targetApplyKey=stableTargetApplyKey(proposalId);
  // The target service owns the effect ledger and MUST independently re-authorize this SecurityContext even for replay lookup.
  // Looking up the stable proposal-derived key first lets a retry recover a target effect that committed before proposal persistence failed.
  const recoveredTarget=await deps.targetService.findAppliedEffect(context,Object.freeze({proposal:snapshot.proposal,idempotencyKey:targetApplyKey}));
  let target:Readonly<{effectReference:string;targetRowVersion?:number;replayed:boolean}>;
  if(recoveredTarget){
    target=Object.freeze({...recoveredTarget,replayed:true});
  }else{
    const currentTargetVersion=await deps.targetService.currentRowVersion(context,snapshot.proposal);
    if(snapshot.proposal.targetRowVersion!==undefined && currentTargetVersion!==snapshot.proposal.targetRowVersion){
      const invalidatedAt=now(deps),reason=`STALE_TARGET_VERSION expected=${snapshot.proposal.targetRowVersion} actual=${currentTargetVersion===undefined?"none":currentTargetVersion}`;
      const invalidated=await deps.unitOfWork.transaction(async tx=>{
        const proposal=await tx.invalidateProposal(Object.freeze({proposalId,expectedRowVersion:snapshot.proposal.rowVersion,invalidatedAt,invalidationReason:reason}));if(!proposal)conflict("DECISION_PROPOSAL_VERSION_CONFLICT");
        await tx.audit(audit(context,PROPOSAL_INVALIDATED_ACTION,proposal.id,Object.freeze({expectedTargetRowVersion:snapshot.proposal.targetRowVersion,currentTargetRowVersion:currentTargetVersion})));
        return proposal;
      },context);
      if(invalidated.status!=="INVALIDATED")conflict("DECISION_PROPOSAL_INVALIDATION_FAILED");
      conflict("DECISION_PROPOSAL_TARGET_STALE");
    }

    // The target service is a separate authority boundary and applies with the same stable key used for recovery lookup.
    target=await deps.targetService.applyApprovedProposal(context,Object.freeze({proposal:snapshot.proposal,evidence:snapshot.evidence,idempotencyKey:targetApplyKey}));
    await deps.faultInjector?.("after_target_apply");
  }

  const appliedAt=now(deps),effectReference=text(target.effectReference,"target.effectReference",1000),appliedTargetRowVersion=nonNegativeInteger(target.targetRowVersion,"target.targetRowVersion");
  const proposal=await deps.unitOfWork.transaction(async tx=>{
    const replay=await tx.findProposalByApplyKey(applyKey);
    if(replay){if(replay.id!==proposalId||replay.status!=="APPLIED")conflict("DECISION_PROPOSAL_APPLY_IDEMPOTENCY_CONFLICT");return replay;}
    const current=await tx.getProposal(proposalId,true);if(!current)notFound("DECISION_PROPOSAL_NOT_FOUND");if(current.status!=="APPROVED")conflict("DECISION_PROPOSAL_NOT_APPROVED");if(current.rowVersion!==snapshot.proposal.rowVersion)conflict("DECISION_PROPOSAL_VERSION_CONFLICT");
    const applied=await tx.markProposalApplied(Object.freeze({proposalId,expectedRowVersion:current.rowVersion,appliedByIdentityId:context.actorIdentityId,appliedAt,applyIdempotencyKey:applyKey,targetEffectReference:effectReference,...(appliedTargetRowVersion===undefined?{}:{appliedTargetRowVersion})}));if(!applied)conflict("DECISION_PROPOSAL_VERSION_CONFLICT");
    await tx.audit(audit(context,PROPOSAL_APPLIED_ACTION,applied.id,Object.freeze({targetEffectReference:effectReference,targetReplayed:target.replayed,appliedTargetRowVersion})));
    return applied;
  },context);
  return Object.freeze({proposal,targetReplayed:target.replayed,replayed:false});
}