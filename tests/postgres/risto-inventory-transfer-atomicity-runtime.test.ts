import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  createGoodsReceipt,
  finalizeGoodsReceipt,
  recordGoodsReceiptLine
} from "../../packages/ristoairen/src/inventory/inventory-receive-stock-movement.ts";
import { PostgresInventoryReceiveUnitOfWork } from "../../packages/persistence-postgres/src/risto-inventory-receive-stock-movement.ts";
import {
  createStockTransfer,
  postStockTransfer,
  recordStockTransferLine,
  transferMovementIdempotencyKey
} from "../../packages/ristoairen/src/inventory/inventory-transfer-atomicity.ts";
import { PostgresInventoryTransferUnitOfWork } from "../../packages/persistence-postgres/src/risto-inventory-transfer-atomicity.ts";

const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:DATABASE_URL,max:16});

const TENANT_A="28282828-1111-4111-8111-111111111111";
const LOCATION_SOURCE="28282828-2222-4222-8222-222222222221";
const LOCATION_DEST="28282828-2222-4222-8222-222222222222";
const LOCATION_NO_PERMISSION="28282828-2222-4222-8222-222222222223";
const LOCATION_NO_MEMBERSHIP="28282828-2222-4222-8222-222222222224";
const ACTOR="28282828-3333-4333-8333-333333333333";
const TENANT_MEMBERSHIP="28282828-3333-4333-8333-333333333334";
const LOCATION_MEMBERSHIP_SOURCE="28282828-3333-4333-8333-333333333335";
const LOCATION_MEMBERSHIP_DEST="28282828-3333-4333-8333-333333333336";
const LOCATION_MEMBERSHIP_NO_PERMISSION="28282828-3333-4333-8333-333333333337";
const TENANT_B="28282828-4444-4444-8444-444444444444";
const LOCATION_B="28282828-5555-4555-8555-555555555555";
const UOM="28282828-6666-4666-8666-666666666666";
const INGREDIENT="28282828-7777-4777-8777-777777777777";
const SUPPLIER="28282828-8888-4888-8888-888888888888";

const receiveUow=new PostgresInventoryReceiveUnitOfWork(pool);
const transferUow=new PostgresInventoryTransferUnitOfWork(pool);

function context(correlationId:string,permissions:readonly string[],options:Readonly<{entitlements?:readonly string[]}>={}):SecurityContext {
  return Object.freeze({
    correlationId,actorIdentityId:ACTOR,platformRoles:[],platformPermissions:[],tenantId:TENANT_A,locationId:LOCATION_SOURCE,
    tenantMembershipId:TENANT_MEMBERSHIP,locationMembershipId:LOCATION_MEMBERSHIP_SOURCE,
    tenantRole:"inventory_tenant",locationRole:"transfer_operator",permissions,
    entitlements:options.entitlements??["vertical.ristoairen","inventory.enabled"]
  });
}
function receiveContext(correlationId:string,permission:string):SecurityContext {
  return Object.freeze({
    correlationId,actorIdentityId:ACTOR,platformRoles:[],platformPermissions:[],tenantId:TENANT_A,locationId:LOCATION_SOURCE,
    tenantMembershipId:TENANT_MEMBERSHIP,locationMembershipId:LOCATION_MEMBERSHIP_SOURCE,
    tenantRole:"inventory_tenant",locationRole:"transfer_operator",permissions:[permission],entitlements:["vertical.ristoairen"]
  });
}
function transferDeps(at:string,faultInjector?:(point:"after_first_transfer_out")=>void|Promise<void>) {
  return {unitOfWork:transferUow,now:()=>at,environmentClass:"TEST_TEMPORARY" as const,...(faultInjector?{faultInjector}:{})};
}
function receiveDeps(at:string) { return {unitOfWork:receiveUow,now:()=>at,environmentClass:"TEST_TEMPORARY" as const}; }
function hasCode(error:unknown,code:string):boolean {
  return Boolean(error&&typeof error==="object"&&"code" in error&&(error as {code?:string}).code===code);
}

async function seed():Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT_A}','mat028-a','MAT028 A'),('${TENANT_B}','mat028-b','MAT028 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,status)
    VALUES ('${LOCATION_SOURCE}','${TENANT_A}','source','MAT028 Source','Europe/Rome','active'),
           ('${LOCATION_DEST}','${TENANT_A}','dest','MAT028 Destination','Europe/Rome','active'),
           ('${LOCATION_NO_PERMISSION}','${TENANT_A}','viewer','MAT028 No Permission','Europe/Rome','active'),
           ('${LOCATION_NO_MEMBERSHIP}','${TENANT_A}','nomember','MAT028 No Membership','Europe/Rome','active'),
           ('${LOCATION_B}','${TENANT_B}','foreign','MAT028 Foreign','Europe/Rome','active');
    INSERT INTO identity.identities (id,display_name) VALUES ('${ACTOR}','MAT028 Inventory Manager');
    INSERT INTO authz.tenant_memberships (id,tenant_id,identity_id,role_key,status)
    VALUES ('${TENANT_MEMBERSHIP}','${TENANT_A}','${ACTOR}','inventory_tenant','active');
    INSERT INTO authz.location_memberships (id,tenant_id,tenant_membership_id,location_id,role_key,status)
    VALUES ('${LOCATION_MEMBERSHIP_SOURCE}','${TENANT_A}','${TENANT_MEMBERSHIP}','${LOCATION_SOURCE}','transfer_operator','active'),
           ('${LOCATION_MEMBERSHIP_DEST}','${TENANT_A}','${TENANT_MEMBERSHIP}','${LOCATION_DEST}','transfer_operator','active'),
           ('${LOCATION_MEMBERSHIP_NO_PERMISSION}','${TENANT_A}','${TENANT_MEMBERSHIP}','${LOCATION_NO_PERMISSION}','inventory_viewer','active');
    INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
    VALUES ('location','transfer_operator','inventory.transfer.create','allow'),
           ('location','transfer_operator','inventory.transfer.approve','allow')
    ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow';
    INSERT INTO ristoairen.units_of_measure (id,tenant_id,code,name,decimal_scale,active,environment_class)
    VALUES ('${UOM}','${TENANT_A}','KG','Kilogram',6,true,'TEST_TEMPORARY');
    INSERT INTO ristoairen.ingredients (id,tenant_id,code,name,base_uom_id,active,environment_class)
    VALUES ('${INGREDIENT}','${TENANT_A}','TOMATO','Tomato','${UOM}',true,'TEST_TEMPORARY');
    INSERT INTO ristoairen.suppliers (id,tenant_id,code,name,active,environment_class)
    VALUES ('${SUPPLIER}','${TENANT_A}','SUP-A','Supplier A',true,'TEST_TEMPORARY');
  `);

  const receipt=await createGoodsReceipt(
    receiveContext("mat028-seed-receipt","procurement.goods_receipt.create"),
    {supplierId:SUPPLIER,receiptNumber:"GR-MAT028-SEED",receivedAt:"2026-09-10T18:40:00.000Z",idempotencyKey:"mat028-seed-receipt"},
    receiveDeps("2026-09-10T18:40:01.000Z")
  );
  await recordGoodsReceiptLine(
    receiveContext("mat028-seed-line","procurement.goods_receipt.create"),
    {goodsReceiptId:receipt.receipt.id,ingredientId:INGREDIENT,uomId:UOM,quantityReceived:"10",idempotencyKey:"mat028-seed-line"},
    receiveDeps("2026-09-10T18:40:02.000Z")
  );
  await finalizeGoodsReceipt(
    receiveContext("mat028-seed-finalize","procurement.goods_receipt.confirm"),
    {goodsReceiptId:receipt.receipt.id,expectedRowVersion:1},receiveDeps("2026-09-10T18:40:03.000Z")
  );
}

async function stock(locationId:string):Promise<string|null> {
  const result=await pool.query(
    "SELECT on_hand_quantity::text AS quantity FROM ristoairen.stock_items WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND ingredient_id=$3::uuid",
    [TENANT_A,locationId,INGREDIENT]
  );
  return result.rows[0]?.quantity??null;
}
async function expectRoleMutationDenied(sql:string,params:readonly unknown[]):Promise<void> {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.tenant_id',$1,true),set_config('airen.location_id',$2,true)",[TENANT_A,LOCATION_SOURCE]);
    await assert.rejects(client.query(sql,[...params]),/permission denied/i);await client.query("ROLLBACK");
  } finally { client.release(); }
}
async function visibleTransferCount(tenantId:string,locationId:string):Promise<number> {
  const client=await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.tenant_id',$1,true),set_config('airen.location_id',$2,true)",[tenantId,locationId]);
    const result=await client.query("SELECT count(*)::int AS count FROM ristoairen.stock_transfers");await client.query("COMMIT");return Number(result.rows[0].count);
  } finally { client.release(); }
}


test("MAT-028 / GJ2-022 inventory transfer atomicity runtime",async t=>{
  await seed();
  t.after(async()=>{await pool.end();});
  let transferId="";
  let lineId="";

  await t.test("seed stock is real MAT-027 RECEIPT ledger evidence, not a direct balance write",async()=>{
    assert.equal(await stock(LOCATION_SOURCE),"10.000000");
    assert.equal(await stock(LOCATION_DEST),null);
    const receiptMovements=await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_movements WHERE movement_type='RECEIPT' AND tenant_id=$1",[TENANT_A]);
    assert.equal(receiptMovements.rows[0].count,1);
  });

  await t.test("dual-Location authority is resolved from real AIRenOS membership and permission rows",async()=>{
    await assert.rejects(
      createStockTransfer(context("mat028-no-entitlement",["inventory.transfer.create"],{entitlements:["vertical.ristoairen"]}),{toLocationId:LOCATION_DEST,idempotencyKey:"no-entitlement"},transferDeps("2026-09-10T18:41:00.000Z")),
      (error:unknown)=>hasCode(error,"ENTITLEMENT_REQUIRED")
    );
    await assert.rejects(
      createStockTransfer(context("mat028-no-permission-dest",["inventory.transfer.create"]),{toLocationId:LOCATION_NO_PERMISSION,idempotencyKey:"no-dest-permission"},transferDeps("2026-09-10T18:41:01.000Z")),
      (error:unknown)=>hasCode(error,"PERMISSION_DENIED")
    );
    await assert.rejects(
      createStockTransfer(context("mat028-no-membership-dest",["inventory.transfer.create"]),{toLocationId:LOCATION_NO_MEMBERSHIP,idempotencyKey:"no-dest-membership"},transferDeps("2026-09-10T18:41:02.000Z")),
      (error:unknown)=>hasCode(error,"LOCATION_MEMBERSHIP_REQUIRED")
    );
    await assert.rejects(
      createStockTransfer(context("mat028-cross-tenant",["inventory.transfer.create"]),{toLocationId:LOCATION_B,idempotencyKey:"cross-tenant"},transferDeps("2026-09-10T18:41:03.000Z")),
      (error:unknown)=>hasCode(error,"LOCATION_SCOPE_DENIED")
    );
    await assert.rejects(
      createStockTransfer(context("mat028-same-location",["inventory.transfer.create"]),{toLocationId:LOCATION_SOURCE,idempotencyKey:"same-location"},transferDeps("2026-09-10T18:41:04.000Z")),
      (error:unknown)=>hasCode(error,"VALIDATION_FAILED")
    );
  });

  await t.test("create and line-record persist a DRAFT transfer with explicit immutable StockTransferLine",async()=>{
    const created=await createStockTransfer(
      context("mat028-create",["inventory.transfer.create"]),{toLocationId:LOCATION_DEST,idempotencyKey:"mat028-transfer-main"},transferDeps("2026-09-10T18:42:00.000Z")
    );
    transferId=created.transfer.id;assert.equal(created.replayed,false);assert.equal(created.transfer.status,"DRAFT");
    assert.equal(created.transfer.fromLocationId,LOCATION_SOURCE);assert.equal(created.transfer.toLocationId,LOCATION_DEST);
    const replay=await createStockTransfer(
      context("mat028-create-replay",["inventory.transfer.create"]),{toLocationId:LOCATION_DEST,idempotencyKey:"mat028-transfer-main"},transferDeps("2026-09-10T18:42:01.000Z")
    );
    assert.equal(replay.replayed,true);assert.equal(replay.transfer.id,transferId);
    const line=await recordStockTransferLine(
      context("mat028-line",["inventory.transfer.create"]),
      {stockTransferId:transferId,ingredientId:INGREDIENT,uomId:UOM,quantity:"3",idempotencyKey:"tomato-3kg"},transferDeps("2026-09-10T18:42:02.000Z")
    );
    lineId=line.line.id;assert.equal(line.line.quantity,"3.000000");
    const lineReplay=await recordStockTransferLine(
      context("mat028-line-replay",["inventory.transfer.create"]),
      {stockTransferId:transferId,ingredientId:INGREDIENT,uomId:UOM,quantity:"3.000000",idempotencyKey:"tomato-3kg"},transferDeps("2026-09-10T18:42:03.000Z")
    );
    assert.equal(lineReplay.replayed,true);assert.equal(lineReplay.line.id,lineId);
    const persisted=await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_transfer_lines WHERE stock_transfer_id=$1",[transferId]);
    assert.equal(persisted.rows[0].count,1);
  });

  await t.test("post commits equal/opposite transfer movements and both StockItem projections atomically",async()=>{
    const posted=await postStockTransfer(
      context("mat028-post",["inventory.transfer.approve"]),{stockTransferId:transferId,expectedRowVersion:1},transferDeps("2026-09-10T18:43:00.000Z")
    );
    assert.equal(posted.replayed,false);assert.equal(posted.transfer.status,"POSTED");assert.equal(posted.transfer.rowVersion,2);
    assert.equal(posted.movements.length,2);
    assert.deepEqual(posted.movements.map(m=>({location:m.locationId,type:m.movementType,quantity:m.quantityDelta,key:m.idempotencyKey,correlation:m.correlationId})),[
      {location:LOCATION_SOURCE,type:"TRANSFER_OUT",quantity:"-3.000000",key:transferMovementIdempotencyKey(transferId,lineId,"out"),correlation:"mat028-post"},
      {location:LOCATION_DEST,type:"TRANSFER_IN",quantity:"3.000000",key:transferMovementIdempotencyKey(transferId,lineId,"in"),correlation:"mat028-post"}
    ]);
    assert.equal(await stock(LOCATION_SOURCE),"7.000000");assert.equal(await stock(LOCATION_DEST),"3.000000");
    const lineStillThere=await pool.query("SELECT quantity::text AS quantity FROM ristoairen.stock_transfer_lines WHERE id=$1",[lineId]);
    assert.equal(lineStillThere.rows[0].quantity,"3.000000");
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='STOCK_TRANSFER_POSTED' AND resource_id=$1",[transferId]);
    assert.equal(audit.rows[0].count,1);
  });

  await t.test("posted replay returns the same ledger effect without moving stock or auditing twice",async()=>{
    const replay=await postStockTransfer(
      context("mat028-post-replay",["inventory.transfer.approve"]),{stockTransferId:transferId,expectedRowVersion:2},transferDeps("2026-09-10T18:44:00.000Z")
    );
    assert.equal(replay.replayed,true);assert.equal(replay.movements.length,2);
    assert.equal(await stock(LOCATION_SOURCE),"7.000000");assert.equal(await stock(LOCATION_DEST),"3.000000");
    const count=await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_movements WHERE source_entity_type='StockTransferLine' AND source_entity_id=$1",[lineId]);
    assert.equal(count.rows[0].count,2);
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='STOCK_TRANSFER_POSTED' AND resource_id=$1",[transferId]);
    assert.equal(audit.rows[0].count,1);
  });

  await t.test("insufficient source stock fails closed with DRAFT state and zero partial transfer effect",async()=>{
    const transfer=await createStockTransfer(context("mat028-insufficient-create",["inventory.transfer.create"]),{toLocationId:LOCATION_DEST,idempotencyKey:"insufficient"},transferDeps("2026-09-10T18:45:00.000Z"));
    const line=await recordStockTransferLine(context("mat028-insufficient-line",["inventory.transfer.create"]),{stockTransferId:transfer.transfer.id,ingredientId:INGREDIENT,uomId:UOM,quantity:"20",idempotencyKey:"too-much"},transferDeps("2026-09-10T18:45:01.000Z"));
    await assert.rejects(
      postStockTransfer(context("mat028-insufficient-post",["inventory.transfer.approve"]),{stockTransferId:transfer.transfer.id,expectedRowVersion:1},transferDeps("2026-09-10T18:45:02.000Z")),
      /INSUFFICIENT_STOCK/
    );
    const state=await pool.query("SELECT status,row_version AS version FROM ristoairen.stock_transfers WHERE id=$1",[transfer.transfer.id]);
    assert.deepEqual(state.rows[0],{status:"DRAFT",version:1});
    const movements=await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_movements WHERE source_entity_type='StockTransferLine' AND source_entity_id=$1",[line.line.id]);
    assert.equal(movements.rows[0].count,0);assert.equal(await stock(LOCATION_SOURCE),"7.000000");assert.equal(await stock(LOCATION_DEST),"3.000000");
  });

  await t.test("injected failure after TRANSFER_OUT rolls back state, both ledgers, projections and post audit",async()=>{
    const transfer=await createStockTransfer(context("mat028-fault-create",["inventory.transfer.create"]),{toLocationId:LOCATION_DEST,idempotencyKey:"fault"},transferDeps("2026-09-10T18:46:00.000Z"));
    const line=await recordStockTransferLine(context("mat028-fault-line",["inventory.transfer.create"]),{stockTransferId:transfer.transfer.id,ingredientId:INGREDIENT,uomId:UOM,quantity:"1",idempotencyKey:"fault-line"},transferDeps("2026-09-10T18:46:01.000Z"));
    await assert.rejects(
      postStockTransfer(context("mat028-fault-post",["inventory.transfer.approve"]),{stockTransferId:transfer.transfer.id,expectedRowVersion:1},transferDeps("2026-09-10T18:46:02.000Z",async point=>{assert.equal(point,"after_first_transfer_out");throw new Error("MAT028_INJECTED_MID_PAIR_FAILURE");})),
      /MAT028_INJECTED_MID_PAIR_FAILURE/
    );
    const state=await pool.query("SELECT status,row_version AS version FROM ristoairen.stock_transfers WHERE id=$1",[transfer.transfer.id]);
    assert.deepEqual(state.rows[0],{status:"DRAFT",version:1});
    const movements=await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_movements WHERE source_entity_type='StockTransferLine' AND source_entity_id=$1",[line.line.id]);
    assert.equal(movements.rows[0].count,0);assert.equal(await stock(LOCATION_SOURCE),"7.000000");assert.equal(await stock(LOCATION_DEST),"3.000000");
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='STOCK_TRANSFER_POSTED' AND resource_id=$1",[transfer.transfer.id]);
    assert.equal(audit.rows[0].count,0);
  });

  await t.test("concurrent posting attempts serialize and converge to exactly one stock effect",async()=>{
    const transfer=await createStockTransfer(context("mat028-concurrent-create",["inventory.transfer.create"]),{toLocationId:LOCATION_DEST,idempotencyKey:"concurrent"},transferDeps("2026-09-10T18:47:00.000Z"));
    const line=await recordStockTransferLine(context("mat028-concurrent-line",["inventory.transfer.create"]),{stockTransferId:transfer.transfer.id,ingredientId:INGREDIENT,uomId:UOM,quantity:"0.5",idempotencyKey:"concurrent-line"},transferDeps("2026-09-10T18:47:01.000Z"));
    const results=await Promise.all([
      postStockTransfer(context("mat028-concurrent-a",["inventory.transfer.approve"]),{stockTransferId:transfer.transfer.id,expectedRowVersion:1},transferDeps("2026-09-10T18:47:02.000Z")),
      postStockTransfer(context("mat028-concurrent-b",["inventory.transfer.approve"]),{stockTransferId:transfer.transfer.id,expectedRowVersion:1},transferDeps("2026-09-10T18:47:03.000Z"))
    ]);
    assert.deepEqual(results.map(result=>result.replayed).sort(),[false,true]);
    const movements=await pool.query("SELECT count(*)::int AS count FROM ristoairen.stock_movements WHERE source_entity_type='StockTransferLine' AND source_entity_id=$1",[line.line.id]);
    assert.equal(movements.rows[0].count,2);assert.equal(await stock(LOCATION_SOURCE),"6.500000");assert.equal(await stock(LOCATION_DEST),"3.500000");
    const audit=await pool.query("SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='STOCK_TRANSFER_POSTED' AND resource_id=$1",[transfer.transfer.id]);
    assert.equal(audit.rows[0].count,1);
  });

  await t.test("append-only boundaries and cross-Tenant RLS remain enforced after transfer support",async()=>{
    await expectRoleMutationDenied("UPDATE ristoairen.stock_items SET on_hand_quantity=999 WHERE tenant_id=$1::uuid AND location_id=$2::uuid",[TENANT_A,LOCATION_SOURCE]);
    await expectRoleMutationDenied("UPDATE ristoairen.stock_movements SET quantity_delta=999 WHERE tenant_id=$1::uuid AND location_id=$2::uuid",[TENANT_A,LOCATION_SOURCE]);
    await expectRoleMutationDenied("DELETE FROM ristoairen.stock_movements WHERE tenant_id=$1::uuid AND location_id=$2::uuid",[TENANT_A,LOCATION_SOURCE]);
    assert.equal(await stock(LOCATION_SOURCE),"6.500000");assert.equal(await stock(LOCATION_DEST),"3.500000");
    assert.equal(await visibleTransferCount(TENANT_B,LOCATION_B),0);
  });
});
