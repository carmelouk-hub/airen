import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  applyDecisionProposal,
  createDecisionProposal,
  getDecisionProposal,
  reviewDecisionProposal,
  type DecisionProposalRecord,
  type GovernedProposalTargetService,
  type ProposalEvidenceRecord,
} from "../../packages/ristoairen/src/intelligence/stella-proposal-lifecycle.ts";
import { PostgresStellaProposalUnitOfWork } from "../../packages/persistence-postgres/src/risto-stella-proposal-lifecycle.ts";

const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL)throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:DATABASE_URL,max:20});
const uow=new PostgresStellaProposalUnitOfWork(pool);

const TENANT_A="32323232-1111-4111-8111-111111111111";
const LOCATION_A="32323232-2222-4222-8222-222222222221";
const LOCATION_A2="32323232-2222-4222-8222-222222222222";
const TENANT_B="32323232-3333-4333-8333-333333333333";
const LOCATION_B="32323232-4444-4444-8444-444444444444";
const STELLA_A="32323232-5555-4555-8555-555555555551";
const MANAGER_A="32323232-5555-4555-8555-555555555552";
const TENANT_MEMBERSHIP="32323232-8888-4888-8888-888888888881";
const LOCATION_MEMBERSHIP="32323232-9999-4999-8999-999999999991";
const TARGET_PERMISSION="synthetic.target.apply";

const ENTITLEMENTS=["vertical.ristoairen","intelligence.enabled"] as const;
const STELLA_PERMISSIONS=["intelligence.proposal.read","intelligence.proposal.create"] as const;
const REVIEW_PERMISSIONS=["intelligence.proposal.read","intelligence.proposal.review"] as const;
const APPLY_PERMISSIONS=["intelligence.proposal.read","intelligence.proposal.apply",TARGET_PERMISSION] as const;

type ContextOptions=Readonly<{
  tenantId?:string;
  locationId?:string;
  entitlements?:readonly string[];
  tenantMembership?:boolean;
  locationMembership?:boolean;
  platformRoles?:readonly string[];
}>;
function context(actorIdentityId:string,correlationId:string,permissions:readonly string[],options:ContextOptions={}):SecurityContext{
  const tenantId=options.tenantId??TENANT_A,locationId=options.locationId??LOCATION_A;
  const tenantMembership=options.tenantMembership??true,locationMembership=options.locationMembership??true;
  return Object.freeze({
    correlationId,actorIdentityId,platformRoles:options.platformRoles??[],platformPermissions:[],tenantId,locationId,
    ...(tenantMembership?{tenantMembershipId:TENANT_MEMBERSHIP,tenantRole:"manager"}:{}),
    ...(locationMembership?{locationMembershipId:LOCATION_MEMBERSHIP,locationRole:"manager"}:{}),
    permissions,entitlements:options.entitlements??ENTITLEMENTS
  });
}
function stella(correlationId:string,permissions:readonly string[]=STELLA_PERMISSIONS,options:ContextOptions={}):SecurityContext{
  return context(STELLA_A,correlationId,permissions,{...options,platformRoles:["AI_STELLA"]});
}
function manager(correlationId:string,permissions:readonly string[],options:ContextOptions={}):SecurityContext{
  return context(MANAGER_A,correlationId,permissions,options);
}
function hasCode(error:unknown,code:string):boolean{return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code===code);}

class SyntheticGovernedTarget implements GovernedProposalTargetService {
  private readonly versions=new Map<string,number>();
  private readonly effects=new Map<string,Readonly<{effectReference:string;targetRowVersion?:number}>>();
  applyCount=0;
  lookupCount=0;

  setVersion(subjectReference:string,version:number):void{this.versions.set(subjectReference,version);}
  version(subjectReference:string):number|undefined{return this.versions.get(subjectReference);}

  private authorize(context:SecurityContext):void{
    if(!context.permissions.includes(TARGET_PERMISSION))throw new AppError("PERMISSION_DENIED",`Missing target permission: ${TARGET_PERMISSION}`);
  }

  async findAppliedEffect(context:SecurityContext,input:Readonly<{proposal:DecisionProposalRecord;idempotencyKey:string}>){
    this.authorize(context);
    this.lookupCount++;
    const effect=this.effects.get(input.idempotencyKey);
    if(!effect)return null;
    if(!effect.effectReference.includes(input.proposal.id))throw new AppError("CONFLICT","TARGET_EFFECT_PROPOSAL_MISMATCH");
    return effect;
  }

  async currentRowVersion(context:SecurityContext,proposal:DecisionProposalRecord):Promise<number|undefined>{
    this.authorize(context);
    return this.versions.get(proposal.subjectReference);
  }

  async applyApprovedProposal(context:SecurityContext,input:Readonly<{proposal:DecisionProposalRecord;evidence:readonly ProposalEvidenceRecord[];idempotencyKey:string}>){
    this.authorize(context);
    const replay=this.effects.get(input.idempotencyKey);
    if(replay)return Object.freeze({...replay,replayed:true});
    if(input.evidence.length===0)throw new AppError("VALIDATION_FAILED","TARGET_EVIDENCE_REQUIRED");
    const current=this.versions.get(input.proposal.subjectReference);
    if(input.proposal.targetRowVersion!==undefined&&current!==input.proposal.targetRowVersion)throw new AppError("CONFLICT","TARGET_VERSION_CONFLICT");
    const next=(current??0)+1;
    this.versions.set(input.proposal.subjectReference,next);
    const effect=Object.freeze({effectReference:`synthetic-target:${input.proposal.id}`,targetRowVersion:next});
    this.effects.set(input.idempotencyKey,effect);
    this.applyCount++;
    return Object.freeze({...effect,replayed:false});
  }
}

const target=new SyntheticGovernedTarget();
function deps(at:string,faultInjector?:(point:"after_target_apply")=>void|Promise<void>){return Object.freeze({unitOfWork:uow,targetService:target,now:()=>at,environmentClass:"TEST_TEMPORARY" as const,...(faultInjector?{faultInjector}:{})});}
function proposalInput(idempotencyKey:string,subjectReference:string,targetRowVersion:number,hashChar="a"){
  return Object.freeze({
    subjectDomain:"inventory.synthetic",
    subjectReference,
    recommendation:`Synthetic recommendation for ${subjectReference}`,
    rationale:`Evidence-backed synthetic rationale for ${subjectReference}`,
    evidence:[Object.freeze({sourceDomain:"inventory.synthetic",sourceReference:`evidence:${subjectReference}`,sourceRowVersion:targetRowVersion,evidenceHash:hashChar.repeat(64),observedAt:"2026-09-11T10:00:00Z"})],
    targetRowVersion,
    idempotencyKey
  });
}

async function seed():Promise<void>{
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES
      ('${TENANT_A}','mat032-a','MAT032 A'),('${TENANT_B}','mat032-b','MAT032 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,status) VALUES
      ('${LOCATION_A}','${TENANT_A}','main','MAT032 Main','Europe/Rome','active'),
      ('${LOCATION_A2}','${TENANT_A}','other','MAT032 Other','Europe/Rome','active'),
      ('${LOCATION_B}','${TENANT_B}','main','MAT032 Foreign','Europe/Rome','active');
    INSERT INTO identity.identities (id,display_name) VALUES
      ('${STELLA_A}','MAT032 STELLA Synthetic'),('${MANAGER_A}','MAT032 Manager');
  `);
}

async function visibleCount(actor:string,tenantId:string,locationId:string,table:string):Promise<number>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[actor,tenantId,locationId,"mat032-visible"]);
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
    await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[actor,TENANT_A,LOCATION_A,"mat032-boundary"]);
    await assert.rejects(client.query(sql,[...params]),/permission denied|row-level security|IMMUTABLE|FORBIDDEN/i);
    await client.query("ROLLBACK");
  }finally{client.release();}
}

test("MAT-032 / GJ2-026 STELLA proposal lifecycle PostgreSQL runtime",async t=>{
  await seed();
  t.after(async()=>{await pool.end();});
  let proposalHappyId="";

  await t.test("proposal creation fails closed on permission, entitlement and Location membership",async()=>{
    target.setVersion("item-fail-closed",1);
    await assert.rejects(createDecisionProposal(stella("mat032-no-perm",[]),proposalInput("create-no-perm","item-fail-closed",1),deps("2026-09-11T10:01:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    await assert.rejects(createDecisionProposal(stella("mat032-no-entitlement",STELLA_PERMISSIONS,{entitlements:["vertical.ristoairen"]}),proposalInput("create-no-entitlement","item-fail-closed",1),deps("2026-09-11T10:01:01Z")),e=>hasCode(e,"ENTITLEMENT_REQUIRED"));
    await assert.rejects(createDecisionProposal(stella("mat032-no-location",STELLA_PERMISSIONS,{locationMembership:false}),proposalInput("create-no-location","item-fail-closed",1),deps("2026-09-11T10:01:02Z")),e=>hasCode(e,"LOCATION_MEMBERSHIP_REQUIRED"));
    const rows=await pool.query("SELECT count(*)::int AS count FROM ristoairen.decision_proposals");
    assert.equal(rows.rows[0].count,0);
  });

  await t.test("AI_STELLA creates evidence-backed proposal idempotently and evidence is immutable",async()=>{
    target.setVersion("item-happy",7);
    const input=proposalInput("create-happy","item-happy",7,"b");
    const created=await createDecisionProposal(stella("mat032-create"),input,deps("2026-09-11T10:02:00Z"));
    proposalHappyId=created.proposal.id;
    assert.equal(created.replayed,false);
    assert.equal(created.proposal.status,"PENDING_APPROVAL");
    assert.equal(created.proposal.rowVersion,1);
    assert.equal(created.proposal.createdByIdentityId,STELLA_A);
    assert.equal(created.evidence.length,1);
    const replay=await createDecisionProposal(stella("mat032-create-replay"),input,deps("2026-09-11T10:02:01Z"));
    assert.equal(replay.replayed,true);
    assert.equal(replay.proposal.id,proposalHappyId);
    await assert.rejects(createDecisionProposal(stella("mat032-create-conflict"),{...input,recommendation:"Different recommendation"},deps("2026-09-11T10:02:02Z")),e=>hasCode(e,"CONFLICT"));
    await expectRoleMutationDenied(STELLA_A,"UPDATE ristoairen.decision_proposal_evidence SET evidence_hash=$2 WHERE proposal_id=$1::uuid",[proposalHappyId,"c".repeat(64)]);
    await expectRoleMutationDenied(STELLA_A,"DELETE FROM ristoairen.decision_proposal_evidence WHERE proposal_id=$1::uuid",[proposalHappyId]);
    await expectRoleMutationDenied(STELLA_A,"UPDATE ristoairen.decision_proposals SET recommendation='tampered' WHERE id=$1::uuid",[proposalHappyId]);
  });

  await t.test("AI_STELLA cannot review or self-apply; human review is version guarded",async()=>{
    await assert.rejects(reviewDecisionProposal(stella("mat032-stella-review",[...STELLA_PERMISSIONS,"intelligence.proposal.review"]),{proposalId:proposalHappyId,decision:"APPROVE",expectedRowVersion:1,idempotencyKey:"review-happy"},deps("2026-09-11T10:03:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    const approved=await reviewDecisionProposal(manager("mat032-review",REVIEW_PERMISSIONS),{proposalId:proposalHappyId,decision:"APPROVE",expectedRowVersion:1,idempotencyKey:"review-happy"},deps("2026-09-11T10:03:01Z"));
    assert.equal(approved.replayed,false);
    assert.equal(approved.proposal.status,"APPROVED");
    assert.equal(approved.proposal.rowVersion,2);
    const replay=await reviewDecisionProposal(manager("mat032-review-replay",REVIEW_PERMISSIONS),{proposalId:proposalHappyId,decision:"APPROVE",expectedRowVersion:1,idempotencyKey:"review-happy"},deps("2026-09-11T10:03:02Z"));
    assert.equal(replay.replayed,true);
    await assert.rejects(reviewDecisionProposal(manager("mat032-review-stale",REVIEW_PERMISSIONS),{proposalId:proposalHappyId,decision:"REJECT",expectedRowVersion:1,idempotencyKey:"review-stale"},deps("2026-09-11T10:03:03Z")),e=>hasCode(e,"CONFLICT"));
    await assert.rejects(applyDecisionProposal(stella("mat032-stella-apply",[...STELLA_PERMISSIONS,"intelligence.proposal.apply",TARGET_PERMISSION]),{proposalId:proposalHappyId,expectedProposalRowVersion:2,idempotencyKey:"apply-stella"},deps("2026-09-11T10:03:04Z")),e=>hasCode(e,"PERMISSION_DENIED"));
  });

  await t.test("target service independently re-authorizes before any target effect",async()=>{
    await assert.rejects(applyDecisionProposal(manager("mat032-target-denied",["intelligence.proposal.read","intelligence.proposal.apply"]),{proposalId:proposalHappyId,expectedProposalRowVersion:2,idempotencyKey:"apply-target-denied"},deps("2026-09-11T10:04:00Z")),e=>hasCode(e,"PERMISSION_DENIED"));
    const snapshot=await getDecisionProposal(manager("mat032-after-target-denied",["intelligence.proposal.read"]),proposalHappyId,deps("2026-09-11T10:04:01Z"));
    assert.equal(snapshot.proposal.status,"APPROVED");
    assert.equal(target.applyCount,0);
  });

  await t.test("approved proposal applies once and replays without duplicate target mutation",async()=>{
    const applied=await applyDecisionProposal(manager("mat032-apply",APPLY_PERMISSIONS),{proposalId:proposalHappyId,expectedProposalRowVersion:2,idempotencyKey:"apply-happy"},deps("2026-09-11T10:05:00Z"));
    assert.equal(applied.proposal.status,"APPLIED");
    assert.equal(applied.proposal.rowVersion,3);
    assert.equal(applied.targetReplayed,false);
    assert.equal(applied.replayed,false);
    assert.equal(target.applyCount,1);
    assert.equal(target.version("item-happy"),8);
    const replay=await applyDecisionProposal(manager("mat032-apply-replay",APPLY_PERMISSIONS),{proposalId:proposalHappyId,expectedProposalRowVersion:2,idempotencyKey:"apply-happy"},deps("2026-09-11T10:05:01Z"));
    assert.equal(replay.replayed,true);
    assert.equal(replay.targetReplayed,true);
    assert.equal(replay.proposal.id,proposalHappyId);
    assert.equal(target.applyCount,1);
  });

  await t.test("stale target with no matching prior effect invalidates fail closed",async()=>{
    target.setVersion("item-stale",3);
    const created=await createDecisionProposal(stella("mat032-stale-create"),proposalInput("create-stale","item-stale",3,"d"),deps("2026-09-11T10:06:00Z"));
    const approved=await reviewDecisionProposal(manager("mat032-stale-review",REVIEW_PERMISSIONS),{proposalId:created.proposal.id,decision:"APPROVE",expectedRowVersion:1,idempotencyKey:"review-stale-target"},deps("2026-09-11T10:06:01Z"));
    assert.equal(approved.proposal.rowVersion,2);
    target.setVersion("item-stale",4);
    const countBefore=target.applyCount;
    await assert.rejects(applyDecisionProposal(manager("mat032-stale-apply",APPLY_PERMISSIONS),{proposalId:created.proposal.id,expectedProposalRowVersion:2,idempotencyKey:"apply-stale-target"},deps("2026-09-11T10:06:02Z")),e=>hasCode(e,"CONFLICT"));
    const snapshot=await getDecisionProposal(manager("mat032-stale-read",["intelligence.proposal.read"]),created.proposal.id,deps("2026-09-11T10:06:03Z"));
    assert.equal(snapshot.proposal.status,"INVALIDATED");
    assert.match(snapshot.proposal.invalidationReason??"",/STALE_TARGET_VERSION/);
    assert.equal(target.applyCount,countBefore);
  });

  await t.test("retry recovers already-committed target effect after proposal persistence failure",async()=>{
    target.setVersion("item-recovery",10);
    const created=await createDecisionProposal(stella("mat032-recovery-create"),proposalInput("create-recovery","item-recovery",10,"e"),deps("2026-09-11T10:07:00Z"));
    await reviewDecisionProposal(manager("mat032-recovery-review",REVIEW_PERMISSIONS),{proposalId:created.proposal.id,decision:"APPROVE",expectedRowVersion:1,idempotencyKey:"review-recovery"},deps("2026-09-11T10:07:01Z"));
    const before=target.applyCount;
    await assert.rejects(applyDecisionProposal(manager("mat032-recovery-first",APPLY_PERMISSIONS),{proposalId:created.proposal.id,expectedProposalRowVersion:2,idempotencyKey:"apply-recovery"},deps("2026-09-11T10:07:02Z",point=>{if(point==="after_target_apply")throw new Error("MAT032_AFTER_TARGET_APPLY_FAULT");})),/MAT032_AFTER_TARGET_APPLY_FAULT/);
    assert.equal(target.applyCount,before+1);
    assert.equal(target.version("item-recovery"),11);
    const stillApproved=await getDecisionProposal(manager("mat032-recovery-intermediate",["intelligence.proposal.read"]),created.proposal.id,deps("2026-09-11T10:07:03Z"));
    assert.equal(stillApproved.proposal.status,"APPROVED");
    assert.equal(stillApproved.proposal.rowVersion,2);
    const recovered=await applyDecisionProposal(manager("mat032-recovery-retry",APPLY_PERMISSIONS),{proposalId:created.proposal.id,expectedProposalRowVersion:2,idempotencyKey:"apply-recovery"},deps("2026-09-11T10:07:04Z"));
    assert.equal(recovered.proposal.status,"APPLIED");
    assert.equal(recovered.targetReplayed,true);
    assert.equal(recovered.replayed,false);
    assert.equal(target.applyCount,before+1);
    assert.equal(target.version("item-recovery"),11);
    const replay=await applyDecisionProposal(manager("mat032-recovery-final-replay",APPLY_PERMISSIONS),{proposalId:created.proposal.id,expectedProposalRowVersion:2,idempotencyKey:"apply-recovery"},deps("2026-09-11T10:07:05Z"));
    assert.equal(replay.replayed,true);
    assert.equal(target.applyCount,before+1);
  });

  await t.test("Tenant and Location RLS isolate proposal and evidence visibility",async()=>{
    await assert.rejects(getDecisionProposal(manager("mat032-cross-location",["intelligence.proposal.read"],{locationId:LOCATION_A2}),proposalHappyId,deps("2026-09-11T10:08:00Z")),e=>hasCode(e,"NOT_FOUND"));
    await assert.rejects(getDecisionProposal(manager("mat032-cross-tenant",["intelligence.proposal.read"],{tenantId:TENANT_B,locationId:LOCATION_B}),proposalHappyId,deps("2026-09-11T10:08:01Z")),e=>hasCode(e,"NOT_FOUND"));
    assert.ok(await visibleCount(MANAGER_A,TENANT_A,LOCATION_A,"decision_proposals")>=3);
    assert.equal(await visibleCount(MANAGER_A,TENANT_A,LOCATION_A2,"decision_proposals"),0);
    assert.equal(await visibleCount(MANAGER_A,TENANT_B,LOCATION_B,"decision_proposals"),0);
    assert.ok(await visibleCount(MANAGER_A,TENANT_A,LOCATION_A,"decision_proposal_evidence")>=3);
    assert.equal(await visibleCount(MANAGER_A,TENANT_A,LOCATION_A2,"decision_proposal_evidence"),0);
  });

  await t.test("proposal lifecycle audit retains create, approval, invalidation and apply evidence",async()=>{
    const rows=await pool.query(`SELECT action_key,count(*)::int AS count FROM audit.audit_events WHERE tenant_id=$1::uuid AND action_key IN ('DECISION_PROPOSAL_CREATED','DECISION_PROPOSAL_APPROVED','DECISION_PROPOSAL_INVALIDATED','DECISION_PROPOSAL_APPLIED') GROUP BY action_key`,[TENANT_A]);
    const counts=new Map(rows.rows.map(row=>[String(row.action_key),Number(row.count)]));
    assert.ok((counts.get("DECISION_PROPOSAL_CREATED")??0)>=3);
    assert.ok((counts.get("DECISION_PROPOSAL_APPROVED")??0)>=3);
    assert.ok((counts.get("DECISION_PROPOSAL_INVALIDATED")??0)>=1);
    assert.ok((counts.get("DECISION_PROPOSAL_APPLIED")??0)>=2);
    assert.equal(target.applyCount,2);
  });
});
