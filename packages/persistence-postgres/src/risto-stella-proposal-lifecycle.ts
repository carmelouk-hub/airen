import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent, SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  DecisionProposalRecord,
  IntelligenceEnvironmentClass,
  ProposalEvidenceRecord,
  ProposalReviewDecision,
  StellaProposalTransaction
} from "../../ristoairen/src/intelligence/stella-proposal-lifecycle.ts";

function assertRoleIdentifier(role:string):string{if(!/^[a-z_][a-z0-9_]*$/.test(role))throw new Error("Unsafe PostgreSQL role identifier");return role;}
function iso(value:unknown):string{return new Date(String(value)).toISOString();}
function optionalIso(value:unknown):string|undefined{return value==null?undefined:iso(value);}
function optionalString(value:unknown):string|undefined{return value==null?undefined:String(value);}
function optionalNumber(value:unknown):number|undefined{return value==null?undefined:Number(value);}

function proposalFromRow(row:Record<string,unknown>):DecisionProposalRecord{
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),subjectDomain:String(row.subjectDomain),subjectReference:String(row.subjectReference),recommendation:String(row.recommendation),rationale:String(row.rationale),proposalHash:String(row.proposalHash),status:String(row.status) as DecisionProposalRecord["status"],
    ...(row.targetRowVersion==null?{}:{targetRowVersion:Number(row.targetRowVersion)}),createdByIdentityId:String(row.createdByIdentityId),createIdempotencyKey:String(row.createIdempotencyKey),
    ...(row.reviewedByIdentityId==null?{}:{reviewedByIdentityId:String(row.reviewedByIdentityId)}),...(row.reviewedAt==null?{}:{reviewedAt:iso(row.reviewedAt)}),...(row.reviewDecision==null?{}:{reviewDecision:String(row.reviewDecision) as ProposalReviewDecision}),...(row.reviewIdempotencyKey==null?{}:{reviewIdempotencyKey:String(row.reviewIdempotencyKey)}),
    ...(row.appliedByIdentityId==null?{}:{appliedByIdentityId:String(row.appliedByIdentityId)}),...(row.appliedAt==null?{}:{appliedAt:iso(row.appliedAt)}),...(row.applyIdempotencyKey==null?{}:{applyIdempotencyKey:String(row.applyIdempotencyKey)}),...(row.targetEffectReference==null?{}:{targetEffectReference:String(row.targetEffectReference)}),...(row.appliedTargetRowVersion==null?{}:{appliedTargetRowVersion:Number(row.appliedTargetRowVersion)}),
    ...(row.invalidatedAt==null?{}:{invalidatedAt:iso(row.invalidatedAt)}),...(row.invalidationReason==null?{}:{invalidationReason:String(row.invalidationReason)}),rowVersion:Number(row.rowVersion),correlationId:String(row.correlationId),environmentClass:String(row.environmentClass) as IntelligenceEnvironmentClass
  });
}

function evidenceFromRow(row:Record<string,unknown>):ProposalEvidenceRecord{
  return Object.freeze({id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),proposalId:String(row.proposalId),ordinal:Number(row.ordinal),sourceDomain:String(row.sourceDomain),sourceReference:String(row.sourceReference),...(row.sourceRowVersion==null?{}:{sourceRowVersion:Number(row.sourceRowVersion)}),evidenceHash:String(row.evidenceHash),observedAt:iso(row.observedAt)});
}

const PROPOSAL_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",subject_domain AS "subjectDomain",subject_reference AS "subjectReference",recommendation,rationale,proposal_hash AS "proposalHash",status,target_row_version AS "targetRowVersion",created_by_identity_id::text AS "createdByIdentityId",create_idempotency_key AS "createIdempotencyKey",reviewed_by_identity_id::text AS "reviewedByIdentityId",reviewed_at AS "reviewedAt",review_decision AS "reviewDecision",review_idempotency_key AS "reviewIdempotencyKey",applied_by_identity_id::text AS "appliedByIdentityId",applied_at AS "appliedAt",apply_idempotency_key AS "applyIdempotencyKey",target_effect_reference AS "targetEffectReference",applied_target_row_version AS "appliedTargetRowVersion",invalidated_at AS "invalidatedAt",invalidation_reason AS "invalidationReason",row_version AS "rowVersion",correlation_id AS "correlationId",environment_class AS "environmentClass" FROM ristoairen.decision_proposals`;
const EVIDENCE_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",proposal_id::text AS "proposalId",ordinal,source_domain AS "sourceDomain",source_reference AS "sourceReference",source_row_version AS "sourceRowVersion",evidence_hash AS "evidenceHash",observed_at AS "observedAt" FROM ristoairen.decision_proposal_evidence`;

export class PostgresStellaProposalTransaction implements StellaProposalTransaction {
  private readonly client:PoolClient;
  constructor(client:PoolClient){this.client=client;}

  async findProposalByCreateKey(idempotencyKey:string):Promise<DecisionProposalRecord|null>{const r=await this.client.query(`${PROPOSAL_SELECT} WHERE create_idempotency_key=$1`,[idempotencyKey]);return r.rows[0]?proposalFromRow(r.rows[0] as Record<string,unknown>):null;}
  async findProposalByReviewKey(idempotencyKey:string):Promise<DecisionProposalRecord|null>{const r=await this.client.query(`${PROPOSAL_SELECT} WHERE review_idempotency_key=$1`,[idempotencyKey]);return r.rows[0]?proposalFromRow(r.rows[0] as Record<string,unknown>):null;}
  async findProposalByApplyKey(idempotencyKey:string):Promise<DecisionProposalRecord|null>{const r=await this.client.query(`${PROPOSAL_SELECT} WHERE apply_idempotency_key=$1`,[idempotencyKey]);return r.rows[0]?proposalFromRow(r.rows[0] as Record<string,unknown>):null;}
  async getProposal(proposalId:string,forUpdate:boolean):Promise<DecisionProposalRecord|null>{const r=await this.client.query(`${PROPOSAL_SELECT} WHERE id=$1::uuid${forUpdate?" FOR UPDATE":""}`,[proposalId]);return r.rows[0]?proposalFromRow(r.rows[0] as Record<string,unknown>):null;}

  async insertProposal(input:Readonly<{tenantId:string;locationId:string;subjectDomain:string;subjectReference:string;recommendation:string;rationale:string;proposalHash:string;targetRowVersion?:number;createdByIdentityId:string;createIdempotencyKey:string;correlationId:string;environmentClass:IntelligenceEnvironmentClass}>):Promise<DecisionProposalRecord>{
    const r=await this.client.query(`INSERT INTO ristoairen.decision_proposals (tenant_id,location_id,subject_domain,subject_reference,recommendation,rationale,proposal_hash,status,target_row_version,created_by_identity_id,create_idempotency_key,row_version,correlation_id,environment_class) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,'PENDING_APPROVAL',$8::integer,$9::uuid,$10,1,$11,$12) RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",subject_domain AS "subjectDomain",subject_reference AS "subjectReference",recommendation,rationale,proposal_hash AS "proposalHash",status,target_row_version AS "targetRowVersion",created_by_identity_id::text AS "createdByIdentityId",create_idempotency_key AS "createIdempotencyKey",reviewed_by_identity_id::text AS "reviewedByIdentityId",reviewed_at AS "reviewedAt",review_decision AS "reviewDecision",review_idempotency_key AS "reviewIdempotencyKey",applied_by_identity_id::text AS "appliedByIdentityId",applied_at AS "appliedAt",apply_idempotency_key AS "applyIdempotencyKey",target_effect_reference AS "targetEffectReference",applied_target_row_version AS "appliedTargetRowVersion",invalidated_at AS "invalidatedAt",invalidation_reason AS "invalidationReason",row_version AS "rowVersion",correlation_id AS "correlationId",environment_class AS "environmentClass"`,[input.tenantId,input.locationId,input.subjectDomain,input.subjectReference,input.recommendation,input.rationale,input.proposalHash,input.targetRowVersion??null,input.createdByIdentityId,input.createIdempotencyKey,input.correlationId,input.environmentClass]);return proposalFromRow(r.rows[0] as Record<string,unknown>);
  }

  async insertEvidence(input:Readonly<{tenantId:string;locationId:string;proposalId:string;ordinal:number;sourceDomain:string;sourceReference:string;sourceRowVersion?:number;evidenceHash:string;observedAt:string}>):Promise<ProposalEvidenceRecord>{
    const r=await this.client.query(`INSERT INTO ristoairen.decision_proposal_evidence (tenant_id,location_id,proposal_id,ordinal,source_domain,source_reference,source_row_version,evidence_hash,observed_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::integer,$5,$6,$7::integer,$8,$9::timestamptz) RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",proposal_id::text AS "proposalId",ordinal,source_domain AS "sourceDomain",source_reference AS "sourceReference",source_row_version AS "sourceRowVersion",evidence_hash AS "evidenceHash",observed_at AS "observedAt"`,[input.tenantId,input.locationId,input.proposalId,input.ordinal,input.sourceDomain,input.sourceReference,input.sourceRowVersion??null,input.evidenceHash,input.observedAt]);return evidenceFromRow(r.rows[0] as Record<string,unknown>);
  }
  async listEvidence(proposalId:string):Promise<readonly ProposalEvidenceRecord[]>{const r=await this.client.query(`${EVIDENCE_SELECT} WHERE proposal_id=$1::uuid ORDER BY ordinal,id`,[proposalId]);return Object.freeze(r.rows.map(row=>evidenceFromRow(row as Record<string,unknown>)));}

  async reviewProposal(input:Readonly<{proposalId:string;expectedRowVersion:number;decision:ProposalReviewDecision;reviewedByIdentityId:string;reviewedAt:string;reviewIdempotencyKey:string}>):Promise<DecisionProposalRecord|null>{
    const status=input.decision==="APPROVE"?"APPROVED":"REJECTED";
    const r=await this.client.query(`UPDATE ristoairen.decision_proposals SET status=$2,reviewed_by_identity_id=$3::uuid,reviewed_at=$4::timestamptz,review_decision=$5,review_idempotency_key=$6,row_version=row_version+1,updated_at=$4::timestamptz WHERE id=$1::uuid AND row_version=$7::integer AND status='PENDING_APPROVAL' RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",subject_domain AS "subjectDomain",subject_reference AS "subjectReference",recommendation,rationale,proposal_hash AS "proposalHash",status,target_row_version AS "targetRowVersion",created_by_identity_id::text AS "createdByIdentityId",create_idempotency_key AS "createIdempotencyKey",reviewed_by_identity_id::text AS "reviewedByIdentityId",reviewed_at AS "reviewedAt",review_decision AS "reviewDecision",review_idempotency_key AS "reviewIdempotencyKey",applied_by_identity_id::text AS "appliedByIdentityId",applied_at AS "appliedAt",apply_idempotency_key AS "applyIdempotencyKey",target_effect_reference AS "targetEffectReference",applied_target_row_version AS "appliedTargetRowVersion",invalidated_at AS "invalidatedAt",invalidation_reason AS "invalidationReason",row_version AS "rowVersion",correlation_id AS "correlationId",environment_class AS "environmentClass"`,[input.proposalId,status,input.reviewedByIdentityId,input.reviewedAt,input.decision,input.reviewIdempotencyKey,input.expectedRowVersion]);return r.rows[0]?proposalFromRow(r.rows[0] as Record<string,unknown>):null;
  }

  async invalidateProposal(input:Readonly<{proposalId:string;expectedRowVersion:number;invalidatedAt:string;invalidationReason:string}>):Promise<DecisionProposalRecord|null>{
    const r=await this.client.query(`UPDATE ristoairen.decision_proposals SET status='INVALIDATED',invalidated_at=$2::timestamptz,invalidation_reason=$3,row_version=row_version+1,updated_at=$2::timestamptz WHERE id=$1::uuid AND row_version=$4::integer AND status='APPROVED' RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",subject_domain AS "subjectDomain",subject_reference AS "subjectReference",recommendation,rationale,proposal_hash AS "proposalHash",status,target_row_version AS "targetRowVersion",created_by_identity_id::text AS "createdByIdentityId",create_idempotency_key AS "createIdempotencyKey",reviewed_by_identity_id::text AS "reviewedByIdentityId",reviewed_at AS "reviewedAt",review_decision AS "reviewDecision",review_idempotency_key AS "reviewIdempotencyKey",applied_by_identity_id::text AS "appliedByIdentityId",applied_at AS "appliedAt",apply_idempotency_key AS "applyIdempotencyKey",target_effect_reference AS "targetEffectReference",applied_target_row_version AS "appliedTargetRowVersion",invalidated_at AS "invalidatedAt",invalidation_reason AS "invalidationReason",row_version AS "rowVersion",correlation_id AS "correlationId",environment_class AS "environmentClass"`,[input.proposalId,input.invalidatedAt,input.invalidationReason,input.expectedRowVersion]);return r.rows[0]?proposalFromRow(r.rows[0] as Record<string,unknown>):null;
  }

  async markProposalApplied(input:Readonly<{proposalId:string;expectedRowVersion:number;appliedByIdentityId:string;appliedAt:string;applyIdempotencyKey:string;targetEffectReference:string;appliedTargetRowVersion?:number}>):Promise<DecisionProposalRecord|null>{
    const r=await this.client.query(`UPDATE ristoairen.decision_proposals SET status='APPLIED',applied_by_identity_id=$2::uuid,applied_at=$3::timestamptz,apply_idempotency_key=$4,target_effect_reference=$5,applied_target_row_version=$6::integer,row_version=row_version+1,updated_at=$3::timestamptz WHERE id=$1::uuid AND row_version=$7::integer AND status='APPROVED' RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",subject_domain AS "subjectDomain",subject_reference AS "subjectReference",recommendation,rationale,proposal_hash AS "proposalHash",status,target_row_version AS "targetRowVersion",created_by_identity_id::text AS "createdByIdentityId",create_idempotency_key AS "createIdempotencyKey",reviewed_by_identity_id::text AS "reviewedByIdentityId",reviewed_at AS "reviewedAt",review_decision AS "reviewDecision",review_idempotency_key AS "reviewIdempotencyKey",applied_by_identity_id::text AS "appliedByIdentityId",applied_at AS "appliedAt",apply_idempotency_key AS "applyIdempotencyKey",target_effect_reference AS "targetEffectReference",applied_target_row_version AS "appliedTargetRowVersion",invalidated_at AS "invalidatedAt",invalidation_reason AS "invalidationReason",row_version AS "rowVersion",correlation_id AS "correlationId",environment_class AS "environmentClass"`,[input.proposalId,input.appliedByIdentityId,input.appliedAt,input.applyIdempotencyKey,input.targetEffectReference,input.appliedTargetRowVersion??null,input.expectedRowVersion]);return r.rows[0]?proposalFromRow(r.rows[0] as Record<string,unknown>):null;
  }

  async audit(record:AuditRecord):Promise<void>{await this.client.query(`INSERT INTO audit.audit_events (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata) VALUES ($1::uuid,$2::uuid,$3::uuid,'system',$4,$5,$6,$7,$8,$9::jsonb)`,[record.tenantId,record.locationId,record.actorIdentityId,record.actionKey,record.resourceType??null,record.resourceId??null,record.correlationId,record.outcome,JSON.stringify(record.metadata??{})]);}
  async outbox(_event:DomainEvent & {tenantId:string;locationId:string;correlationId:string}):Promise<void>{throw new Error("MAT032_STELLA_PROPOSAL_HAS_NO_OUTBOX");}
}

export class PostgresStellaProposalUnitOfWork implements UnitOfWork<StellaProposalTransaction> {
  private readonly pool:Pool;
  private readonly assumeRole:string;
  constructor(pool:Pool,assumeRole="airen_app"){this.pool=pool;this.assumeRole=assumeRole;}
  async transaction<T>(fn:(tx:StellaProposalTransaction)=>Promise<T>,context?:SecurityContext):Promise<T>{
    if(!context)throw new Error("SecurityContext is required for MAT-032 STELLA proposal runtime");
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]);
      const value=await fn(new PostgresStellaProposalTransaction(client));
      await client.query("COMMIT");
      return value;
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}
  }
}
