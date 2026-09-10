import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  createGoodsReceipt,
  createPurchaseOrderGoodsReceipt,
  finalizePurchaseOrderGoodsReceipt,
  recordGoodsReceiptLine,
  recordPurchaseOrderGoodsReceiptLine,
  receiptMovementIdempotencyKey
} from "../../packages/ristoairen/src/inventory/inventory-receive-stock-movement.ts";
import { PostgresInventoryReceiveUnitOfWork } from "../../packages/persistence-postgres/src/risto-inventory-receive-stock-movement.ts";

const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:DATABASE_URL,max:20});

const TENANT_A="29292929-1111-4111-8111-111111111111";
const LOCATION_A="29292929-2222-4222-8222-222222222221";
const LOCATION_A2="29292929-2222-4222-8222-222222222222";
const ACTOR="29292929-3333-4333-8333-333333333333";
const TENANT_B="29292929-4444-4444-8444-444444444444";
const LOCATION_B="29292929-5555-4555-8555-555555555555";
const UOM_A="29292929-6666-4666-8666-666666666661";
const UOM_B="29292929-6666-4666-8666-666666666662";
const ING_A1="29292929-7777-4777-8777-777777777771";
const ING_A2="29292929-7777-4777-8777-777777777772";
const ING_B="29292929-7777-4777-8777-777777777773";
const SUP_A1="29292929-8888-4888-8888-888888888881";
const SUP_A2="29292929-8888-4888-8888-888888888882";
const SUP_B="29292929-8888-4888-8888-888888888883";
const SI_A1="29292929-9999-4999-8999-999999999991";
const SI_A2="29292929-9999-4999-8999-999999999992";
const SI_ALT="29292929-9999-4999-8999-999999999993";
const SI_B="29292929-9999-4999-8999-999999999994";
const PO_MAIN="29292929-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PO_OTHER="29292929-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const PO_DRAFT="29292929-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const PO_FAULT="29292929-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const PO_CONC="29292929-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const PO_B="29292929-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const POL_MAIN1="29292929-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const POL_MAIN2="29292929-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const POL_OTHER="29292929-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const POL_DRAFT="29292929-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const POL_FAULT="29292929-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
const POL_CONC="29292929-bbbb-4bbb-8bbb-bbbbbbbbbbb6";
const POL_B="29292929-bbbb-4bbb-8bbb-bbbbbbbbbbb7";

const uow=new PostgresInventoryReceiveUnitOfWork(pool);
function deps(at:string,faultInjector?:(point:"after_first_supplier_price")=>void|Promise<void>){return {unitOfWork:uow,now:()=>at,environmentClass:"TEST_TEMPORARY" as const,...(faultInjector?{faultInjector}:{})};}
function context(correlationId:string,permissions:readonly string[],options:Readonly<{tenantId?:string;locationId?:string;entitlements?:readonly string[];membership?:boolean}>={}):SecurityContext{
  const tenantId=options.tenantId??TENANT_A,locationId=options.locationId??LOCATION_A,membership=options.membership??true;
  return Object.freeze({correlationId,actorIdentityId:ACTOR,platformRoles:[],platformPermissions:[],tenantId,locationId,tenantMembershipId:`mat029-tm-${tenantId}`,...(membership?{locationMembershipId:`mat029-lm-${locationId}`}:{ }),tenantRole:"manager",...(membership?{locationRole:"manager"}:{}),permissions,entitlements:options.entitlements??["vertical.ristoairen","procurement.enabled","inventory.enabled"]});
}
function hasCode(error:unknown,code:string):boolean{return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code===code);}

async function seed():Promise<void>{
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES
      ('${TENANT_A}','mat029-a','MAT029 A'),('${TENANT_B}','mat029-b','MAT029 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,status) VALUES
      ('${LOCATION_A}','${TENANT_A}','main','MAT029 Main','Europe/Rome','active'),
      ('${LOCATION_A2}','${TENANT_A}','other','MAT029 Other','Europe/Rome','active'),
      ('${LOCATION_B}','${TENANT_B}','main','MAT029 Foreign','Europe/Rome','active');
    INSERT INTO identity.identities (id,display_name) VALUES ('${ACTOR}','MAT029 Procurement Manager');
    INSERT INTO ristoairen.units_of_measure (id,tenant_id,code,name,decimal_scale,active,environment_class) VALUES
      ('${UOM_A}','${TENANT_A}','KG','Kilogram',6,true,'TEST_TEMPORARY'),
      ('${UOM_B}','${TENANT_B}','KG','Kilogram',6,true,'TEST_TEMPORARY');
    INSERT INTO ristoairen.ingredients (id,tenant_id,code,name,base_uom_id,active,environment_class) VALUES
      ('${ING_A1}','${TENANT_A}','TOMATO','Tomato','${UOM_A}',true,'TEST_TEMPORARY'),
      ('${ING_A2}','${TENANT_A}','FLOUR','Flour','${UOM_A}',true,'TEST_TEMPORARY'),
      ('${ING_B}','${TENANT_B}','OTHER','Other','${UOM_B}',true,'TEST_TEMPORARY');
    INSERT INTO ristoairen.suppliers (id,tenant_id,code,name,active,environment_class) VALUES
      ('${SUP_A1}','${TENANT_A}','SUP-A','Supplier A',true,'TEST_TEMPORARY'),
      ('${SUP_A2}','${TENANT_A}','SUP-B','Supplier B',true,'TEST_TEMPORARY'),
      ('${SUP_B}','${TENANT_B}','SUP-X','Supplier X',true,'TEST_TEMPORARY');
    INSERT INTO ristoairen.supplier_items (id,tenant_id,supplier_id,ingredient_id,supplier_sku,base_uom_id,current_unit_cost,active,environment_class) VALUES
      ('${SI_A1}','${TENANT_A}','${SUP_A1}','${ING_A1}','A-TOMATO','${UOM_A}',2,true,'TEST_TEMPORARY'),
      ('${SI_A2}','${TENANT_A}','${SUP_A1}','${ING_A2}','A-FLOUR','${UOM_A}',3,true,'TEST_TEMPORARY'),
      ('${SI_ALT}','${TENANT_A}','${SUP_A2}','${ING_A1}','B-TOMATO','${UOM_A}',4,true,'TEST_TEMPORARY'),
      ('${SI_B}','${TENANT_B}','${SUP_B}','${ING_B}','X-OTHER','${UOM_B}',5,true,'TEST_TEMPORARY');

    INSERT INTO ristoairen.purchase_orders
      (id,tenant_id,location_id,supplier_id,status,order_number,order_date,currency,subtotal,tax_total,total,created_by_identity_id,approved_by_identity_id,approved_at,source_type,row_version,environment_class) VALUES
      ('${PO_MAIN}','${TENANT_A}','${LOCATION_A}','${SUP_A1}','APPROVED','PO-029-MAIN','2026-09-10','EUR',32,0,32,'${ACTOR}','${ACTOR}','2026-09-10T18:00:00Z','MANUAL',1,'TEST_TEMPORARY'),
      ('${PO_OTHER}','${TENANT_A}','${LOCATION_A}','${SUP_A2}','APPROVED','PO-029-OTHER','2026-09-10','EUR',20,0,20,'${ACTOR}','${ACTOR}','2026-09-10T18:01:00Z','MANUAL',1,'TEST_TEMPORARY'),
      ('${PO_DRAFT}','${TENANT_A}','${LOCATION_A}','${SUP_A1}','DRAFT','PO-029-DRAFT','2026-09-10','EUR',2,0,2,'${ACTOR}',NULL,NULL,'MANUAL',1,'TEST_TEMPORARY'),
      ('${PO_FAULT}','${TENANT_A}','${LOCATION_A}','${SUP_A1}','APPROVED','PO-029-FAULT','2026-09-10','EUR',6,0,6,'${ACTOR}','${ACTOR}','2026-09-10T18:02:00Z','MANUAL',1,'TEST_TEMPORARY'),
      ('${PO_CONC}','${TENANT_A}','${LOCATION_A}','${SUP_A1}','APPROVED','PO-029-CONC','2026-09-10','EUR',10,0,10,'${ACTOR}','${ACTOR}','2026-09-10T18:03:00Z','MANUAL',1,'TEST_TEMPORARY'),
      ('${PO_B}','${TENANT_B}','${LOCATION_B}','${SUP_B}','APPROVED','PO-029-B','2026-09-10','EUR',5,0,5,'${ACTOR}','${ACTOR}','2026-09-10T18:04:00Z','MANUAL',1,'TEST_TEMPORARY');

    INSERT INTO ristoairen.purchase_order_lines
      (id,tenant_id,location_id,purchase_order_id,supplier_item_id,ingredient_id,quantity_ordered,uom_id,unit_cost_snapshot,line_total,environment_class) VALUES
      ('${POL_MAIN1}','${TENANT_A}','${LOCATION_A}','${PO_MAIN}','${SI_A1}','${ING_A1}',10,'${UOM_A}',2,20,'TEST_TEMPORARY'),
      ('${POL_MAIN2}','${TENANT_A}','${LOCATION_A}','${PO_MAIN}','${SI_A2}','${ING_A2}',4,'${UOM_A}',3,12,'TEST_TEMPORARY'),
      ('${POL_OTHER}','${TENANT_A}','${LOCATION_A}','${PO_OTHER}','${SI_ALT}','${ING_A1}',5,'${UOM_A}',4,20,'TEST_TEMPORARY'),
      ('${POL_DRAFT}','${TENANT_A}','${LOCATION_A}','${PO_DRAFT}','${SI_A1}','${ING_A1}',1,'${UOM_A}',2,2,'TEST_TEMPORARY'),
      ('${POL_FAULT}','${TENANT_A}','${LOCATION_A}','${PO_FAULT}','${SI_A2}','${ING_A2}',2,'${UOM_A}',3,6,'TEST_TEMPORARY'),
      ('${POL_CONC}','${TENANT_A}','${LOCATION_A}','${PO_CONC}','${SI_A1}','${ING_A1}',5,'${UOM_A}',2,10,'TEST_TEMPORARY'),
      ('${POL_B}','${TENANT_B}','${LOCATION_B}','${PO_B}','${SI_B}','${ING_B}',1,'${UOM_B}',5,5,'TEST_TEMPORARY');
  `);
}

async function stock(ingredientId:string):Promise<string|null>{const r=await pool.query("SELECT on_hand_quantity::text AS quantity FROM ristoairen.stock_items WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND ingredient_id=$3::uuid",[TENANT_A,LOCATION_A,ingredientId]);return r.rows[0]?.quantity??null;}
async function po(id:string):Promise<{status:string;row_version:number}>{const r=await pool.query("SELECT status,row_version FROM ristoairen.purchase_orders WHERE id=$1::uuid",[id]);return r.rows[0];}
async function visibleCount(tenantId:string,locationId:string,table:string):Promise<number>{const client=await pool.connect();try{await client.query("BEGIN READ ONLY");await client.query("SET LOCAL ROLE airen_app");await client.query("SELECT set_config('airen.tenant_id',$1,true),set_config('airen.location_id',$2,true)",[tenantId,locationId]);const r=await client.query(`SELECT count(*)::int AS count FROM ristoairen.${table}`);await client.query("COMMIT");return Number(r.rows[0].count);}finally{client.release();}}
async function expectRoleMutationDenied(sql:string,params:readonly unknown[]):Promise<void>{const client=await pool.connect();try{await client.query("BEGIN");await client.query("SET LOCAL ROLE airen_app");await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",[ACTOR,TENANT_A,LOCATION_A,"mat029-boundary"]);await assert.rejects(client.query(sql,[...params]),/permission denied/i);await client.query("ROLLBACK");}finally{client.release();}}

test("MAT-029 / GJ2-023 procurement PO-backed goods receipt runtime",async t=>{
  await seed();
  t.after(async()=>{await pool.end();});
  let receipt1="",line1="";

  await t.test("authority and PO receivable preconditions fail closed before any receipt effect",async()=>{
    await assert.rejects(createPurchaseOrderGoodsReceipt(context("mat029-no-perm",[]),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-NO-PERM",idempotencyKey:"no-perm"},deps("2026-09-10T18:10:00Z")),(e:unknown)=>hasCode(e,"PERMISSION_DENIED"));
    await assert.rejects(createPurchaseOrderGoodsReceipt(context("mat029-no-proc",["procurement.goods_receipt.create"],{entitlements:["vertical.ristoairen","inventory.enabled"]}),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-NO-PROC",idempotencyKey:"no-proc"},deps("2026-09-10T18:10:01Z")),(e:unknown)=>hasCode(e,"ENTITLEMENT_REQUIRED"));
    await assert.rejects(createPurchaseOrderGoodsReceipt(context("mat029-no-inv",["procurement.goods_receipt.create"],{entitlements:["vertical.ristoairen","procurement.enabled"]}),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-NO-INV",idempotencyKey:"no-inv"},deps("2026-09-10T18:10:02Z")),(e:unknown)=>hasCode(e,"ENTITLEMENT_REQUIRED"));
    await assert.rejects(createPurchaseOrderGoodsReceipt(context("mat029-no-location",["procurement.goods_receipt.create"],{membership:false}),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-NO-LOC",idempotencyKey:"no-loc"},deps("2026-09-10T18:10:03Z")),(e:unknown)=>hasCode(e,"LOCATION_MEMBERSHIP_REQUIRED"));
    await assert.rejects(createPurchaseOrderGoodsReceipt(context("mat029-draft",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_DRAFT,receiptNumber:"GR-DRAFT",idempotencyKey:"draft-po"},deps("2026-09-10T18:10:04Z")),(e:unknown)=>hasCode(e,"CONFLICT"));
    await assert.rejects(createPurchaseOrderGoodsReceipt(context("mat029-cross-location",["procurement.goods_receipt.create"],{locationId:LOCATION_A2}),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-CROSS",idempotencyKey:"cross-location"},deps("2026-09-10T18:10:05Z")),(e:unknown)=>hasCode(e,"NOT_FOUND"));
    const count=await pool.query("SELECT count(*)::int AS count FROM ristoairen.goods_receipts WHERE tenant_id=$1",[TENANT_A]);
    assert.equal(count.rows[0].count,0);
  });

  await t.test("database insert guard rejects forged Supplier and environment even outside the application command",async()=>{
    const base="INSERT INTO ristoairen.goods_receipts (tenant_id,location_id,supplier_id,purchase_order_id,receipt_number,received_at,received_by_identity_id,status,source_request_key,row_version,environment_class) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::timestamptz,$7::uuid,'DRAFT',$8,1,$9)";
    await assert.rejects(pool.query(base,[TENANT_A,LOCATION_A,SUP_A2,PO_MAIN,"FORGED-SUP","2026-09-10T18:11:00Z",ACTOR,"forged-supplier","TEST_TEMPORARY"]),/GOODS_RECEIPT_PURCHASE_ORDER_SUPPLIER_MISMATCH/);
    await assert.rejects(pool.query(base,[TENANT_A,LOCATION_A,SUP_A1,PO_MAIN,"FORGED-ENV","2026-09-10T18:11:01Z",ACTOR,"forged-env","SANDBOX"]),/GOODS_RECEIPT_PURCHASE_ORDER_ENVIRONMENT_MISMATCH/);
  });

  await t.test("create and line-record derive Supplier, Ingredient and UOM from the APPROVED PO and replay safely",async()=>{
    const created=await createPurchaseOrderGoodsReceipt(context("mat029-create-1",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-029-001",receivedAt:"2026-09-10T18:12:00Z",idempotencyKey:"main-receipt-1"},deps("2026-09-10T18:12:01Z"));
    receipt1=created.receipt.id;assert.equal(created.replayed,false);assert.equal(created.receipt.supplierId,SUP_A1);assert.equal(created.receipt.purchaseOrderId,PO_MAIN);assert.equal(created.receipt.status,"DRAFT");
    const replay=await createPurchaseOrderGoodsReceipt(context("mat029-create-1-replay",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-029-001",receivedAt:"2026-09-10T18:12:00Z",idempotencyKey:"main-receipt-1"},deps("2026-09-10T18:12:02Z"));
    assert.equal(replay.replayed,true);assert.equal(replay.receipt.id,receipt1);
    await assert.rejects(recordGoodsReceiptLine(context("mat029-old-path",["procurement.goods_receipt.create"]),{goodsReceiptId:receipt1,ingredientId:ING_A1,uomId:UOM_A,quantityReceived:"1",idempotencyKey:"old-path"},deps("2026-09-10T18:12:03Z")),(e:unknown)=>hasCode(e,"CONFLICT"));
    const recorded=await recordPurchaseOrderGoodsReceiptLine(context("mat029-line-1",["procurement.goods_receipt.create"]),{goodsReceiptId:receipt1,purchaseOrderLineId:POL_MAIN1,quantityReceived:"4",unitCostActual:"2.5",idempotencyKey:"main-line-1"},deps("2026-09-10T18:12:04Z"));
    line1=recorded.line.id;assert.equal(recorded.line.ingredientId,ING_A1);assert.equal(recorded.line.uomId,UOM_A);assert.equal(recorded.line.quantityReceived,"4.000000");assert.equal(recorded.line.unitCostActual,"2.500000");
    const lineReplay=await recordPurchaseOrderGoodsReceiptLine(context("mat029-line-1-replay",["procurement.goods_receipt.create"]),{goodsReceiptId:receipt1,purchaseOrderLineId:POL_MAIN1,quantityReceived:"4.000000",unitCostActual:"2.500000",idempotencyKey:"main-line-1"},deps("2026-09-10T18:12:05Z"));
    assert.equal(lineReplay.replayed,true);assert.equal(lineReplay.line.id,line1);
    await assert.rejects(recordPurchaseOrderGoodsReceiptLine(context("mat029-foreign-line",["procurement.goods_receipt.create"]),{goodsReceiptId:receipt1,purchaseOrderLineId:POL_OTHER,quantityReceived:"1",unitCostActual:"4",idempotencyKey:"foreign-line"},deps("2026-09-10T18:12:06Z")),(e:unknown)=>hasCode(e,"CONFLICT"));
  });

  await t.test("first finalize atomically appends SupplierPrice plus MAT-027 RECEIPT ledger and advances PO to PARTIALLY_RECEIVED",async()=>{
    const result=await finalizePurchaseOrderGoodsReceipt(context("mat029-finalize-1",["procurement.goods_receipt.confirm"]),{goodsReceiptId:receipt1,expectedRowVersion:1},deps("2026-09-10T18:13:00Z"));
    assert.equal(result.replayed,false);assert.equal(result.receipt.status,"CONFIRMED");assert.equal(result.purchaseOrder.status,"PARTIALLY_RECEIVED");assert.equal(result.purchaseOrder.rowVersion,2);
    assert.equal(result.supplierPrices.length,1);assert.equal(result.supplierPrices[0].supplierItemId,SI_A1);assert.equal(result.supplierPrices[0].unitCost,"2.500000");assert.equal(result.supplierPrices[0].currency,"EUR");
    assert.equal(result.movements.length,1);assert.equal(result.movements[0].quantityDelta,"4.000000");assert.equal(result.movements[0].idempotencyKey,receiptMovementIdempotencyKey(receipt1,line1));assert.equal(await stock(ING_A1),"4.000000");
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='GOODS_RECEIPT_FINALIZED' AND resource_id=$1",[receipt1]);assert.equal(audit.rows[0].count,1);
    const replay=await finalizePurchaseOrderGoodsReceipt(context("mat029-finalize-1-replay",["procurement.goods_receipt.confirm"]),{goodsReceiptId:receipt1,expectedRowVersion:2},deps("2026-09-10T18:13:01Z"));
    assert.equal(replay.replayed,true);assert.equal(replay.supplierPrices.length,1);assert.equal(replay.movements.length,1);assert.equal((await po(PO_MAIN)).row_version,2);assert.equal(await stock(ING_A1),"4.000000");
    const priceCount=await pool.query("SELECT count(*)::int AS count FROM ristoairen.supplier_prices WHERE source_entity_id=$1",[line1]);assert.equal(priceCount.rows[0].count,1);
  });

  await t.test("over-receipt and foreign PO-line attempts fail closed while a second valid receipt completes the PO",async()=>{
    const over=await createPurchaseOrderGoodsReceipt(context("mat029-over-create",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-029-OVER",idempotencyKey:"main-over"},deps("2026-09-10T18:14:00Z"));
    await assert.rejects(recordPurchaseOrderGoodsReceiptLine(context("mat029-over-line",["procurement.goods_receipt.create"]),{goodsReceiptId:over.receipt.id,purchaseOrderLineId:POL_MAIN1,quantityReceived:"7",unitCostActual:"2.6",idempotencyKey:"over-line"},deps("2026-09-10T18:14:01Z")),(e:unknown)=>hasCode(e,"CONFLICT"));
    const r2=await createPurchaseOrderGoodsReceipt(context("mat029-create-2",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-029-002",idempotencyKey:"main-receipt-2"},deps("2026-09-10T18:14:02Z"));
    const l21=await recordPurchaseOrderGoodsReceiptLine(context("mat029-line-21",["procurement.goods_receipt.create"]),{goodsReceiptId:r2.receipt.id,purchaseOrderLineId:POL_MAIN1,quantityReceived:"6",unitCostActual:"2.6",idempotencyKey:"main-line-21"},deps("2026-09-10T18:14:03Z"));
    const l22=await recordPurchaseOrderGoodsReceiptLine(context("mat029-line-22",["procurement.goods_receipt.create"]),{goodsReceiptId:r2.receipt.id,purchaseOrderLineId:POL_MAIN2,quantityReceived:"4",unitCostActual:"3.2",idempotencyKey:"main-line-22"},deps("2026-09-10T18:14:04Z"));
    const done=await finalizePurchaseOrderGoodsReceipt(context("mat029-finalize-2",["procurement.goods_receipt.confirm"]),{goodsReceiptId:r2.receipt.id,expectedRowVersion:1},deps("2026-09-10T18:14:05Z"));
    assert.equal(done.purchaseOrder.status,"RECEIVED");assert.equal(done.purchaseOrder.rowVersion,3);assert.equal(done.supplierPrices.length,2);assert.equal(done.movements.length,2);assert.equal(await stock(ING_A1),"10.000000");assert.equal(await stock(ING_A2),"4.000000");
    const prices=await pool.query("SELECT supplier_item_id::text AS item,unit_cost::text AS cost FROM ristoairen.supplier_prices WHERE source_entity_id IN ($1::uuid,$2::uuid,$3::uuid) ORDER BY supplier_item_id,unit_cost",[line1,l21.line.id,l22.line.id]);
    assert.deepEqual(prices.rows,[{item:SI_A1,cost:"2.500000"},{item:SI_A1,cost:"2.600000"},{item:SI_A2,cost:"3.200000"}]);
    await assert.rejects(createPurchaseOrderGoodsReceipt(context("mat029-after-received",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_MAIN,receiptNumber:"GR-AFTER",idempotencyKey:"after-received"},deps("2026-09-10T18:14:06Z")),(e:unknown)=>hasCode(e,"CONFLICT"));
  });

  await t.test("fault after SupplierPrice proves receipt, price, stock and PO transition roll back as one transaction",async()=>{
    const r=await createPurchaseOrderGoodsReceipt(context("mat029-fault-create",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_FAULT,receiptNumber:"GR-029-FAULT",idempotencyKey:"fault-receipt"},deps("2026-09-10T18:15:00Z"));
    const l=await recordPurchaseOrderGoodsReceiptLine(context("mat029-fault-line",["procurement.goods_receipt.create"]),{goodsReceiptId:r.receipt.id,purchaseOrderLineId:POL_FAULT,quantityReceived:"2",unitCostActual:"3.1",idempotencyKey:"fault-line"},deps("2026-09-10T18:15:01Z"));
    await assert.rejects(finalizePurchaseOrderGoodsReceipt(context("mat029-fault-finalize",["procurement.goods_receipt.confirm"]),{goodsReceiptId:r.receipt.id,expectedRowVersion:1},deps("2026-09-10T18:15:02Z",()=>{throw new Error("MAT029_FAULT_AFTER_PRICE");})),/MAT029_FAULT_AFTER_PRICE/);
    const receiptState=await pool.query("SELECT status,row_version FROM ristoairen.goods_receipts WHERE id=$1",[r.receipt.id]);assert.deepEqual(receiptState.rows[0],{status:"DRAFT",row_version:1});assert.deepEqual(await po(PO_FAULT),{status:"APPROVED",row_version:1});
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ristoairen.supplier_prices WHERE source_entity_id=$1",[l.line.id])).rows[0].count,0);assert.equal((await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_movements WHERE source_entity_id=$1",[l.line.id])).rows[0].count,0);assert.equal(await stock(ING_A2),"4.000000");
    const retry=await finalizePurchaseOrderGoodsReceipt(context("mat029-fault-retry",["procurement.goods_receipt.confirm"]),{goodsReceiptId:r.receipt.id,expectedRowVersion:1},deps("2026-09-10T18:15:03Z"));assert.equal(retry.purchaseOrder.status,"RECEIVED");assert.equal(await stock(ING_A2),"6.000000");
  });

  await t.test("concurrent finalization serializes on the PO so only one oversubscribed draft can commit",async()=>{
    const a=await createPurchaseOrderGoodsReceipt(context("mat029-conc-a",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_CONC,receiptNumber:"GR-CONC-A",idempotencyKey:"conc-a"},deps("2026-09-10T18:16:00Z"));
    const b=await createPurchaseOrderGoodsReceipt(context("mat029-conc-b",["procurement.goods_receipt.create"]),{purchaseOrderId:PO_CONC,receiptNumber:"GR-CONC-B",idempotencyKey:"conc-b"},deps("2026-09-10T18:16:01Z"));
    await recordPurchaseOrderGoodsReceiptLine(context("mat029-conc-line-a",["procurement.goods_receipt.create"]),{goodsReceiptId:a.receipt.id,purchaseOrderLineId:POL_CONC,quantityReceived:"4",unitCostActual:"2.1",idempotencyKey:"conc-line-a"},deps("2026-09-10T18:16:02Z"));
    await recordPurchaseOrderGoodsReceiptLine(context("mat029-conc-line-b",["procurement.goods_receipt.create"]),{goodsReceiptId:b.receipt.id,purchaseOrderLineId:POL_CONC,quantityReceived:"4",unitCostActual:"2.2",idempotencyKey:"conc-line-b"},deps("2026-09-10T18:16:03Z"));
    const settled=await Promise.allSettled([
      finalizePurchaseOrderGoodsReceipt(context("mat029-conc-final-a",["procurement.goods_receipt.confirm"]),{goodsReceiptId:a.receipt.id,expectedRowVersion:1},deps("2026-09-10T18:16:04Z")),
      finalizePurchaseOrderGoodsReceipt(context("mat029-conc-final-b",["procurement.goods_receipt.confirm"]),{goodsReceiptId:b.receipt.id,expectedRowVersion:1},deps("2026-09-10T18:16:05Z"))
    ]);
    assert.equal(settled.filter(x=>x.status==="fulfilled").length,1);assert.equal(settled.filter(x=>x.status==="rejected").length,1);const rejected=settled.find(x=>x.status==="rejected") as PromiseRejectedResult;assert.equal(hasCode(rejected.reason,"CONFLICT"),true);
    const committed=await pool.query("SELECT count(*)::int AS count FROM ristoairen.goods_receipts WHERE purchase_order_id=$1 AND status='CONFIRMED'",[PO_CONC]);assert.equal(committed.rows[0].count,1);assert.deepEqual(await po(PO_CONC),{status:"PARTIALLY_RECEIVED",row_version:2});
    const prices=await pool.query("SELECT count(*)::int AS count FROM ristoairen.supplier_prices WHERE source_entity_id IN (SELECT l.id FROM ristoairen.goods_receipt_lines l JOIN ristoairen.goods_receipts gr ON gr.id=l.goods_receipt_id WHERE gr.purchase_order_id=$1)",[PO_CONC]);assert.equal(prices.rows[0].count,1);
    const movements=await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_movements WHERE source_entity_id IN (SELECT l.id FROM ristoairen.goods_receipt_lines l JOIN ristoairen.goods_receipts gr ON gr.id=l.goods_receipt_id WHERE gr.purchase_order_id=$1)",[PO_CONC]);assert.equal(movements.rows[0].count,1);assert.equal(await stock(ING_A1),"14.000000");
  });

  await t.test("RLS and grants keep procurement history and stock authority fail-closed",async()=>{
    assert.equal(await visibleCount(TENANT_A,LOCATION_A2,"purchase_orders"),0);assert.equal(await visibleCount(TENANT_B,LOCATION_B,"supplier_prices"),0);
    await expectRoleMutationDenied("UPDATE ristoairen.supplier_prices SET unit_cost=999 WHERE tenant_id=$1::uuid",[TENANT_A]);
    await expectRoleMutationDenied("DELETE FROM ristoairen.supplier_prices WHERE tenant_id=$1::uuid",[TENANT_A]);
    await expectRoleMutationDenied("INSERT INTO ristoairen.purchase_orders (tenant_id,location_id,supplier_id,status,order_number,order_date,currency,subtotal,total,created_by_identity_id,environment_class) VALUES ($1::uuid,$2::uuid,$3::uuid,'DRAFT','FORGED-PO',CURRENT_DATE,'EUR',0,0,$4::uuid,'TEST_TEMPORARY')",[TENANT_A,LOCATION_A,SUP_A1,ACTOR]);
    await expectRoleMutationDenied("UPDATE ristoairen.purchase_orders SET supplier_id=$2::uuid WHERE id=$1::uuid",[PO_CONC,SUP_A2]);
    await expectRoleMutationDenied("UPDATE ristoairen.stock_items SET on_hand_quantity=999 WHERE tenant_id=$1::uuid AND location_id=$2::uuid",[TENANT_A,LOCATION_A]);
  });
});
