import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { approveRefund, requestRefund } from "../../packages/ristoairen/src/pos/refund-request.ts";
import { PostgresRefundRequestUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-request.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

const TENANT_A="20202020-1111-4111-8111-111111111111";
const LOCATION_A="20202020-2222-4222-8222-222222222222";
const REQUESTER="20202020-3333-4333-8333-333333333333";
const APPROVER="20202020-4444-4444-8444-444444444444";
const APPROVER_2="20202020-4444-4444-8444-444444444445";
const ORDER_A="20202020-5555-4555-8555-555555555555";
const PAYMENT_A="20202020-6666-4666-8666-666666666661";
const REFUND_CHILD="20202020-6666-4666-8666-666666666662";
const TENANT_B="20202020-7777-4777-8777-777777777777";
const LOCATION_B="20202020-8888-4888-8888-888888888888";
const ORDER_B="20202020-9999-4999-8999-999999999999";
const PAYMENT_B="20202020-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function context(actor:string, correlationId:string, permissions:readonly string[], entitled=true): SecurityContext {
  return Object.freeze({ correlationId, actorIdentityId:actor, platformRoles:[], platformPermissions:[], tenantId:TENANT_A, locationId:LOCATION_A, tenantMembershipId:"mat022-tm", locationMembershipId:"mat022-lm", tenantRole:"responsabile", locationRole:"responsabile", permissions, entitlements:entitled?["vertical.ristoairen"]:[] });
}
const requestContext=(id:string, permissions:readonly string[]=["pos.refund.request"], entitled=true)=>context(REQUESTER,id,permissions,entitled);
const approveContext=(id:string, actor=APPROVER, permissions:readonly string[]=["pos.refund.approve"], entitled=true)=>context(actor,id,permissions,entitled);

async function seed():Promise<void>{
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES ('${TENANT_A}','mat022-a','MAT022 A'),('${TENANT_B}','mat022-b','MAT022 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone) VALUES ('${LOCATION_A}','${TENANT_A}','main','MAT022 Main A','Europe/Rome'),('${LOCATION_B}','${TENANT_B}','main','MAT022 Main B','Europe/Rome');
    INSERT INTO identity.identities (id,display_name) VALUES ('${REQUESTER}','MAT022 Requester'),('${APPROVER}','MAT022 Approver'),('${APPROVER_2}','MAT022 Approver 2');
    INSERT INTO ristoairen.orders (id,tenant_id,location_id,channel,status,currency,subtotal,discount_total,tax_total,total,opened_at,created_by_identity_id,version,environment_class)
    VALUES ('${ORDER_A}','${TENANT_A}','${LOCATION_A}','POS','PAID','EUR',50,0,0,50,now(),'${REQUESTER}',1,'TEST_TEMPORARY'),('${ORDER_B}','${TENANT_B}','${LOCATION_B}','POS','PAID','EUR',70,0,0,70,now(),'${APPROVER}',1,'TEST_TEMPORARY');
    INSERT INTO ristoairen.payments (id,tenant_id,location_id,order_id,payment_method,amount,currency,status,received_at,recorded_by,idempotency_key,metadata_sanitized,row_version,environment_class)
    VALUES ('${PAYMENT_A}','${TENANT_A}','${LOCATION_A}','${ORDER_A}','CARD',50,'EUR','RECORDED',now(),'${REQUESTER}','mat022-original-a','{}',3,'TEST_TEMPORARY'),('${PAYMENT_B}','${TENANT_B}','${LOCATION_B}','${ORDER_B}','CARD',70,'EUR','RECORDED',now(),'${APPROVER}','mat022-original-b','{}',1,'TEST_TEMPORARY');
    INSERT INTO ristoairen.payments (id,tenant_id,location_id,order_id,payment_method,amount,currency,status,received_at,recorded_by,refund_of_payment_id,idempotency_key,metadata_sanitized,row_version,environment_class)
    VALUES ('${REFUND_CHILD}','${TENANT_A}','${LOCATION_A}','${ORDER_A}','CARD',10,'EUR','ARBITRARY_UNFROZEN_REFUND_LABEL',now(),'${REQUESTER}','${PAYMENT_A}','mat022-existing-refund','{}',1,'TEST_TEMPORARY');
  `);
}

async function expectCode(p:Promise<unknown>, code:string):Promise<void>{ await assert.rejects(p,(e:unknown)=>e instanceof AppError && e.code===code); }

const uow=()=>new PostgresRefundRequestUnitOfWork(pool);
const requestInput=(key:string, amount="20.00")=>({paymentId:PAYMENT_A,amount,reason:"Customer requested refund",expectedPaymentRowVersion:3,idempotencyKey:key} as const);

test("MAT-022 persisted refund request and approval runtime", async(t)=>{
  await seed();
  t.after(async()=>{await pool.end();});

  let requestId="";

  await t.test("refund.request persists exactly one PENDING_APPROVAL row and one audit with zero Payment effect", async()=>{
    const before=await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1",[TENANT_A]);
    const result=await requestRefund(requestContext("mat022-request"),requestInput("mat022-request-1"),{unitOfWork:uow(),now:()=>"2026-09-10T12:00:00.000Z"});
    requestId=result.refundRequest.id;
    assert.equal(result.replayed,false); assert.equal(result.monetaryEffectCreated,false);
    assert.equal(result.refundRequest.status,"PENDING_APPROVAL"); assert.equal(result.refundRequest.requestedAmount,"20.00"); assert.equal(result.refundRequest.requestedByIdentityId,REQUESTER); assert.equal(result.refundRequest.rowVersion,1);
    const rows=await pool.query("SELECT count(*)::int AS count FROM ristoairen.refund_requests WHERE tenant_id=$1 AND request_idempotency_key=$2",[TENANT_A,"mat022-request-1"]);
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='REFUND_REQUESTED' AND resource_id=$1",[requestId]);
    const after=await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1",[TENANT_A]);
    assert.equal(rows.rows[0].count,1); assert.equal(audit.rows[0].count,1); assert.equal(after.rows[0].count,before.rows[0].count);
  });

  await t.test("semantic request replay converges without duplicate row or audit", async()=>{
    const result=await requestRefund(requestContext("mat022-request-replay"),requestInput("mat022-request-1"),{unitOfWork:uow()});
    assert.equal(result.replayed,true); assert.equal(result.refundRequest.id,requestId);
    const rows=await pool.query("SELECT count(*)::int AS count FROM ristoairen.refund_requests WHERE request_idempotency_key='mat022-request-1'");
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='REFUND_REQUESTED' AND resource_id=$1",[requestId]);
    assert.equal(rows.rows[0].count,1); assert.equal(audit.rows[0].count,1);
  });

  await t.test("conflicting request idempotency key fails closed", async()=>{
    await expectCode(requestRefund(requestContext("mat022-request-conflict"),{...requestInput("mat022-request-1"),amount:"19.00"},{unitOfWork:uow()}),"IDEMPOTENCY_CONFLICT");
  });

  await t.test("request permission and entitlement remain independent from approval permission", async()=>{
    await expectCode(requestRefund(requestContext("mat022-approve-only",["pos.refund.approve"]),requestInput("mat022-no-request-perm","1.00"),{unitOfWork:uow()}),"PERMISSION_DENIED");
    await expectCode(requestRefund(requestContext("mat022-no-entitlement",["pos.refund.request"],false),requestInput("mat022-no-entitlement-key","1.00"),{unitOfWork:uow()}),"ENTITLEMENT_REQUIRED");
  });

  await t.test("self approval is denied and leaves workflow + monetary ledger unchanged", async()=>{
    const before=await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1",[TENANT_A]);
    await expectCode(approveRefund(context(REQUESTER,"mat022-self",["pos.refund.approve"]),{refundRequestId:requestId,expectedRefundRequestRowVersion:1},{unitOfWork:uow()}),"PERMISSION_DENIED");
    const row=await pool.query("SELECT status,row_version FROM ristoairen.refund_requests WHERE id=$1",[requestId]);
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='REFUND_APPROVED' AND resource_id=$1",[requestId]);
    const after=await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1",[TENANT_A]);
    assert.equal(row.rows[0].status,"PENDING_APPROVAL"); assert.equal(row.rows[0].row_version,1); assert.equal(audit.rows[0].count,0); assert.equal(after.rows[0].count,before.rows[0].count);
  });

  await t.test("missing approve permission or entitlement is denied", async()=>{
    await expectCode(approveRefund(approveContext("mat022-no-approve",APPROVER,["pos.refund.request"]),{refundRequestId:requestId,expectedRefundRequestRowVersion:1},{unitOfWork:uow()}),"PERMISSION_DENIED");
    await expectCode(approveRefund(approveContext("mat022-no-approve-ent",APPROVER,["pos.refund.approve"],false),{refundRequestId:requestId,expectedRefundRequestRowVersion:1},{unitOfWork:uow()}),"ENTITLEMENT_REQUIRED");
  });

  await t.test("authorized different actor approves once, audits once, increments row_version and creates zero Payment effect", async()=>{
    const before=await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1",[TENANT_A]);
    const result=await approveRefund(approveContext("mat022-approve"),{refundRequestId:requestId,expectedRefundRequestRowVersion:1},{unitOfWork:uow(),now:()=>"2026-09-10T12:05:00.000Z"});
    assert.equal(result.replayed,false); assert.equal(result.monetaryEffectCreated,false); assert.equal(result.refundRequest.status,"APPROVED"); assert.equal(result.refundRequest.approvedByIdentityId,APPROVER); assert.equal(result.refundRequest.rowVersion,2);
    const audit=await pool.query("SELECT actor_identity_id::text AS actor, count(*)::int AS count FROM audit.audit_events WHERE action_key='REFUND_APPROVED' AND resource_id=$1 GROUP BY actor_identity_id",[requestId]);
    const after=await pool.query("SELECT count(*)::int AS count FROM ristoairen.payments WHERE tenant_id=$1",[TENANT_A]);
    assert.equal(audit.rows[0].actor,APPROVER); assert.equal(audit.rows[0].count,1); assert.equal(after.rows[0].count,before.rows[0].count);
  });

  await t.test("approval replay converges without duplicate audit", async()=>{
    const result=await approveRefund(approveContext("mat022-approve-replay",APPROVER_2),{refundRequestId:requestId,expectedRefundRequestRowVersion:1},{unitOfWork:uow()});
    assert.equal(result.replayed,true); assert.equal(result.refundRequest.status,"APPROVED"); assert.equal(result.refundRequest.approvedByIdentityId,APPROVER);
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='REFUND_APPROVED' AND resource_id=$1",[requestId]);
    assert.equal(audit.rows[0].count,1);
  });

  await t.test("RLS hides another tenant RefundRequest even when UUID is known", async()=>{
    const otherId="20202020-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await pool.query(`INSERT INTO ristoairen.refund_requests (id,tenant_id,location_id,payment_id,order_id,requested_amount,currency,reason,requested_by_identity_id,requested_at,request_idempotency_key,original_payment_row_version,status,row_version,environment_class) VALUES ($1,$2,$3,$4,$5,5,'EUR','other tenant refund',$6,now(),'mat022-other-tenant',1,'PENDING_APPROVAL',1,'TEST_TEMPORARY')`,[otherId,TENANT_B,LOCATION_B,PAYMENT_B,ORDER_B,APPROVER]);
    await expectCode(approveRefund(approveContext("mat022-cross-tenant"),{refundRequestId:otherId,expectedRefundRequestRowVersion:1},{unitOfWork:uow()}),"NOT_FOUND");
  });

  await t.test("stale pending request row_version fails closed", async()=>{
    const pending=await requestRefund(requestContext("mat022-stale-create"),requestInput("mat022-stale-key","2.00"),{unitOfWork:uow()});
    await expectCode(approveRefund(approveContext("mat022-stale-approve"),{refundRequestId:pending.refundRequest.id,expectedRefundRequestRowVersion:2},{unitOfWork:uow()}),"CONFLICT");
  });

  await t.test("two concurrent authorized approvals yield one transition and one replay with one audit", async()=>{
    const pending=await requestRefund(requestContext("mat022-concurrent-create"),requestInput("mat022-concurrent-key","3.00"),{unitOfWork:uow()});
    const input={refundRequestId:pending.refundRequest.id,expectedRefundRequestRowVersion:1} as const;
    const [a,b]=await Promise.all([approveRefund(approveContext("mat022-concurrent-a",APPROVER),input,{unitOfWork:uow()}),approveRefund(approveContext("mat022-concurrent-b",APPROVER_2),input,{unitOfWork:uow()})]);
    assert.equal([a.replayed,b.replayed].filter(Boolean).length,1);
    assert.equal(a.refundRequest.status,"APPROVED"); assert.equal(b.refundRequest.status,"APPROVED");
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='REFUND_APPROVED' AND resource_id=$1",[pending.refundRequest.id]);
    assert.equal(audit.rows[0].count,1);
  });
});
