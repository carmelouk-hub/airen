import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  createGoodsReceipt,
  finalizeGoodsReceipt,
  recordGoodsReceiptLine,
  receiptMovementIdempotencyKey
} from "../../packages/ristoairen/src/inventory/inventory-receive-stock-movement.ts";
import { PostgresInventoryReceiveUnitOfWork } from "../../packages/persistence-postgres/src/risto-inventory-receive-stock-movement.ts";

const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:DATABASE_URL,max:12});

const TENANT_A="27272727-1111-4111-8111-111111111111";
const LOCATION_A="27272727-2222-4222-8222-222222222222";
const LOCATION_A2="27272727-2222-4222-8222-222222222223";
const ACTOR="27272727-3333-4333-8333-333333333333";
const TENANT_B="27272727-4444-4444-8444-444444444444";
const LOCATION_B="27272727-5555-4555-8555-555555555555";
const UOM_A="27272727-6666-4666-8666-666666666666";
const UOM_B="27272727-6666-4666-8666-666666666667";
const INGREDIENT_A1="27272727-7777-4777-8777-777777777771";
const INGREDIENT_A2="27272727-7777-4777-8777-777777777772";
const INGREDIENT_B="27272727-7777-4777-8777-777777777773";
const SUPPLIER_A="27272727-8888-4888-8888-888888888881";
const SUPPLIER_B="27272727-8888-4888-8888-888888888882";

function context(correlationId:string,permissions:readonly string[],options:Readonly<{tenantId?:string;locationId?:string;entitlement?:boolean;membership?:boolean}>={}):SecurityContext {
  const tenantId=options.tenantId??TENANT_A;
  const locationId=options.locationId??LOCATION_A;
  const membership=options.membership??true;
  return Object.freeze({
    correlationId,actorIdentityId:ACTOR,platformRoles:[],platformPermissions:[],tenantId,locationId,
    tenantMembershipId:`mat027-tm-${tenantId}`,
    ...(membership?{locationMembershipId:`mat027-lm-${locationId}`}:{ }),
    tenantRole:"manager",...(membership?{locationRole:"manager"}:{}),permissions,
    entitlements:options.entitlement===false?[]:["vertical.ristoairen"]
  });
}

const uow=new PostgresInventoryReceiveUnitOfWork(pool);
const deps=(at:string)=>({unitOfWork:uow,now:()=>at,environmentClass:"TEST_TEMPORARY" as const});
function hasCode(error:unknown,code:string):boolean { return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code===code); }

async function seed():Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT_A}','mat027-a','MAT027 A'),('${TENANT_B}','mat027-b','MAT027 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone)
    VALUES ('${LOCATION_A}','${TENANT_A}','main','MAT027 Main A','Europe/Rome'),
           ('${LOCATION_A2}','${TENANT_A}','second','MAT027 Second A','Europe/Rome'),
           ('${LOCATION_B}','${TENANT_B}','main','MAT027 Main B','Europe/Rome');
    INSERT INTO identity.identities (id,display_name) VALUES ('${ACTOR}','MAT027 Inventory Manager');
    INSERT INTO ristoairen.units_of_measure (id,tenant_id,code,name,decimal_scale,active,environment_class)
    VALUES ('${UOM_A}','${TENANT_A}','KG','Kilogram',6,true,'TEST_TEMPORARY'),
           ('${UOM_B}','${TENANT_B}','KG','Kilogram',6,true,'TEST_TEMPORARY');
    INSERT INTO ristoairen.ingredients (id,tenant_id,code,name,base_uom_id,active,environment_class)
    VALUES ('${INGREDIENT_A1}','${TENANT_A}','TOMATO','Tomato','${UOM_A}',true,'TEST_TEMPORARY'),
           ('${INGREDIENT_A2}','${TENANT_A}','FLOUR','Flour','${UOM_A}',true,'TEST_TEMPORARY'),
           ('${INGREDIENT_B}','${TENANT_B}','OTHER','Other','${UOM_B}',true,'TEST_TEMPORARY');
    INSERT INTO ristoairen.suppliers (id,tenant_id,code,name,active,environment_class)
    VALUES ('${SUPPLIER_A}','${TENANT_A}','SUP-A','Supplier A',true,'TEST_TEMPORARY'),
           ('${SUPPLIER_B}','${TENANT_B}','SUP-B','Supplier B',true,'TEST_TEMPORARY');
  `);
}

async function expectRoleMutationDenied(sql:string,params:readonly unknown[]):Promise<void> {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.tenant_id',$1,true),set_config('airen.location_id',$2,true)",[TENANT_A,LOCATION_A]);
    await assert.rejects(client.query(sql,[...params]),/permission denied/i);
    await client.query("ROLLBACK");
  } finally { client.release(); }
}

async function visibleCountAs(tenantId:string,locationId:string,table:string):Promise<number> {
  const client=await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.tenant_id',$1,true),set_config('airen.location_id',$2,true)",[tenantId,locationId]);
    const result=await client.query(`SELECT count(*)::int AS count FROM ristoairen.${table}`);
    await client.query("COMMIT");
    return Number(result.rows[0].count);
  } finally { client.release(); }
}

test("MAT-027 / GJ2-021 inventory receive and stock movement runtime",async t=>{
  await seed();
  t.after(async()=>{await pool.end();});
  let receiptId="";
  let line1Id="";
  let line2Id="";

  await t.test("create GoodsReceipt is Location-scoped and semantic replay does not duplicate it",async()=>{
    const created=await createGoodsReceipt(
      context("mat027-create",["procurement.goods_receipt.create"]),
      {supplierId:SUPPLIER_A,receiptNumber:"GR-027-001",receivedAt:"2026-09-10T18:00:00.000Z",idempotencyKey:"mat027-receipt-001"},
      deps("2026-09-10T18:01:00.000Z")
    );
    receiptId=created.receipt.id;
    assert.equal(created.replayed,false);
    assert.equal(created.receipt.status,"DRAFT");
    assert.equal(created.receipt.locationId,LOCATION_A);
    const replay=await createGoodsReceipt(
      context("mat027-create-replay",["procurement.goods_receipt.create"]),
      {supplierId:SUPPLIER_A,receiptNumber:"GR-027-001",receivedAt:"2026-09-10T18:00:00.000Z",idempotencyKey:"mat027-receipt-001"},
      deps("2026-09-10T18:01:30.000Z")
    );
    assert.equal(replay.replayed,true);
    assert.equal(replay.receipt.id,receiptId);
    const count=await pool.query("SELECT count(*)::int AS count FROM ristoairen.goods_receipts WHERE tenant_id=$1 AND location_id=$2",[TENANT_A,LOCATION_A]);
    assert.equal(count.rows[0].count,1);
  });

  await t.test("line recording uses decimal strings, base UOM and replay-safe source keys",async()=>{
    const first=await recordGoodsReceiptLine(
      context("mat027-line-1",["procurement.goods_receipt.create"]),
      {goodsReceiptId:receiptId,ingredientId:INGREDIENT_A1,uomId:UOM_A,quantityReceived:"2.5",idempotencyKey:"line-tomato"},deps("2026-09-10T18:02:00.000Z")
    );
    line1Id=first.line.id;
    assert.equal(first.line.quantityReceived,"2.500000");
    const replay=await recordGoodsReceiptLine(
      context("mat027-line-1-replay",["procurement.goods_receipt.create"]),
      {goodsReceiptId:receiptId,ingredientId:INGREDIENT_A1,uomId:UOM_A,quantityReceived:"2.500000",idempotencyKey:"line-tomato"},deps("2026-09-10T18:02:10.000Z")
    );
    assert.equal(replay.replayed,true);
    assert.equal(replay.line.id,line1Id);
    const second=await recordGoodsReceiptLine(
      context("mat027-line-2",["procurement.goods_receipt.create"]),
      {goodsReceiptId:receiptId,ingredientId:INGREDIENT_A2,uomId:UOM_A,quantityReceived:"1.25",idempotencyKey:"line-flour"},deps("2026-09-10T18:02:20.000Z")
    );
    line2Id=second.line.id;
    const count=await pool.query("SELECT count(*)::int AS count FROM ristoairen.goods_receipt_lines WHERE goods_receipt_id=$1",[receiptId]);
    assert.equal(count.rows[0].count,2);
  });

  await t.test("permission, entitlement and Location authority fail closed before finalize",async()=>{
    await assert.rejects(
      finalizeGoodsReceipt(context("mat027-no-confirm",["procurement.goods_receipt.create"]),{goodsReceiptId:receiptId,expectedRowVersion:1},deps("2026-09-10T18:03:00.000Z")),
      (error:unknown)=>hasCode(error,"PERMISSION_DENIED")
    );
    await assert.rejects(
      finalizeGoodsReceipt(context("mat027-no-entitlement",["procurement.goods_receipt.confirm"],{entitlement:false}),{goodsReceiptId:receiptId,expectedRowVersion:1},deps("2026-09-10T18:03:00.000Z")),
      (error:unknown)=>hasCode(error,"ENTITLEMENT_REQUIRED")
    );
    await assert.rejects(
      finalizeGoodsReceipt(context("mat027-no-location",["procurement.goods_receipt.confirm"],{membership:false}),{goodsReceiptId:receiptId,expectedRowVersion:1},deps("2026-09-10T18:03:00.000Z")),
      (error:unknown)=>hasCode(error,"LOCATION_MEMBERSHIP_REQUIRED")
    );
  });

  await t.test("finalize atomically posts one append-only RECEIPT movement per line and projects StockItem balance",async()=>{
    const result=await finalizeGoodsReceipt(
      context("mat027-finalize",["procurement.goods_receipt.confirm"]),
      {goodsReceiptId:receiptId,expectedRowVersion:1},deps("2026-09-10T18:04:00.000Z")
    );
    assert.equal(result.replayed,false);
    assert.equal(result.receipt.status,"CONFIRMED");
    assert.equal(result.receipt.rowVersion,2);
    assert.equal(result.movements.length,2);
    assert.equal(result.stockItems.length,2);
    assert.deepEqual(new Set(result.movements.map(m=>m.idempotencyKey)),new Set([
      receiptMovementIdempotencyKey(receiptId,line1Id),receiptMovementIdempotencyKey(receiptId,line2Id)
    ]));
    const movementRows=await pool.query(
      "SELECT ingredient_id::text AS ingredient,quantity_delta::text AS quantity,movement_type,source_entity_type FROM ristoairen.stock_movements ORDER BY ingredient_id"
    );
    assert.deepEqual(movementRows.rows,[
      {ingredient:INGREDIENT_A1,quantity:"2.500000",movement_type:"RECEIPT",source_entity_type:"GoodsReceiptLine"},
      {ingredient:INGREDIENT_A2,quantity:"1.250000",movement_type:"RECEIPT",source_entity_type:"GoodsReceiptLine"}
    ]);
    const stock=await pool.query("SELECT ingredient_id::text AS ingredient,on_hand_quantity::text AS quantity FROM ristoairen.stock_items ORDER BY ingredient_id");
    assert.deepEqual(stock.rows,[
      {ingredient:INGREDIENT_A1,quantity:"2.500000"},
      {ingredient:INGREDIENT_A2,quantity:"1.250000"}
    ]);
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='GOODS_RECEIPT_FINALIZED' AND resource_id=$1",[receiptId]);
    assert.equal(audit.rows[0].count,1);
  });

  await t.test("finalize replay converges without duplicate movement, stock increment or finalize audit",async()=>{
    const replay=await finalizeGoodsReceipt(
      context("mat027-finalize-replay",["procurement.goods_receipt.confirm"]),
      {goodsReceiptId:receiptId,expectedRowVersion:2},deps("2026-09-10T18:05:00.000Z")
    );
    assert.equal(replay.replayed,true);
    assert.equal(replay.movements.length,2);
    const movements=await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_movements");
    assert.equal(movements.rows[0].count,2);
    const stock=await pool.query("SELECT sum(on_hand_quantity)::text AS quantity FROM ristoairen.stock_items");
    assert.equal(stock.rows[0].quantity,"3.750000");
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='GOODS_RECEIPT_FINALIZED' AND resource_id=$1",[receiptId]);
    assert.equal(audit.rows[0].count,1);
  });

  await t.test("ledger boundaries deny direct StockItem overwrite and StockMovement mutation",async()=>{
    await expectRoleMutationDenied("UPDATE ristoairen.stock_items SET on_hand_quantity=999 WHERE tenant_id=$1::uuid AND location_id=$2::uuid",[TENANT_A,LOCATION_A]);
    await expectRoleMutationDenied("UPDATE ristoairen.stock_movements SET quantity_delta=999 WHERE tenant_id=$1::uuid AND location_id=$2::uuid",[TENANT_A,LOCATION_A]);
    await expectRoleMutationDenied("DELETE FROM ristoairen.stock_movements WHERE tenant_id=$1::uuid AND location_id=$2::uuid",[TENANT_A,LOCATION_A]);
    const stock=await pool.query("SELECT sum(on_hand_quantity)::text AS quantity FROM ristoairen.stock_items");
    assert.equal(stock.rows[0].quantity,"3.750000");
  });

  await t.test("confirmed receipt is immutable and cross-Location/Tenant scope stays hidden",async()=>{
    await assert.rejects(pool.query("UPDATE ristoairen.goods_receipts SET receipt_number='MUTATED' WHERE id=$1",[receiptId]),/CONFIRMED_GOODS_RECEIPT_IMMUTABLE/);
    await assert.rejects(
      recordGoodsReceiptLine(
        context("mat027-cross-location",["procurement.goods_receipt.create"],{locationId:LOCATION_A2}),
        {goodsReceiptId:receiptId,ingredientId:INGREDIENT_A1,uomId:UOM_A,quantityReceived:"1",idempotencyKey:"cross-location"},deps("2026-09-10T18:06:00.000Z")
      ),(error:unknown)=>hasCode(error,"NOT_FOUND")
    );
    assert.equal(await visibleCountAs(TENANT_A,LOCATION_A2,"goods_receipts"),0);
    assert.equal(await visibleCountAs(TENANT_A,LOCATION_A2,"stock_movements"),0);
    assert.equal(await visibleCountAs(TENANT_B,LOCATION_B,"goods_receipts"),0);
    assert.equal(await visibleCountAs(TENANT_B,LOCATION_B,"stock_items"),0);
  });
});
