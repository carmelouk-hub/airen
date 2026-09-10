import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent, SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  GoodsReceiptLineRecord,
  GoodsReceiptRecord,
  IngredientMaterial,
  InventoryEnvironmentClass,
  InventoryReceiveTransaction,
  StockItemRecord,
  StockMovementRecord
} from "../../ristoairen/src/inventory/inventory-receive-stock-movement.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function iso(value: unknown): string { return new Date(String(value)).toISOString(); }

function receiptFromRow(row: Record<string,unknown>): GoodsReceiptRecord {
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),supplierId:String(row.supplierId),
    receiptNumber:String(row.receiptNumber),receivedAt:iso(row.receivedAt),receivedByIdentityId:String(row.receivedByIdentityId),
    status:String(row.status) as GoodsReceiptRecord["status"],sourceRequestKey:String(row.sourceRequestKey),
    rowVersion:Number(row.rowVersion),environmentClass:String(row.environmentClass) as InventoryEnvironmentClass,
    ...(row.confirmedAt==null?{}:{confirmedAt:iso(row.confirmedAt)}),
    ...(row.confirmedByIdentityId==null?{}:{confirmedByIdentityId:String(row.confirmedByIdentityId)})
  });
}

function lineFromRow(row: Record<string,unknown>): GoodsReceiptLineRecord {
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),goodsReceiptId:String(row.goodsReceiptId),
    ingredientId:String(row.ingredientId),uomId:String(row.uomId),quantityReceived:String(row.quantityReceived),
    rejectedQuantity:String(row.rejectedQuantity),sourceLineKey:String(row.sourceLineKey),rowVersion:Number(row.rowVersion),
    environmentClass:String(row.environmentClass) as InventoryEnvironmentClass
  });
}

function movementFromRow(row: Record<string,unknown>): StockMovementRecord {
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),ingredientId:String(row.ingredientId),
    movementType:"RECEIPT",quantityDelta:String(row.quantityDelta),uomId:String(row.uomId),sourceEntityId:String(row.sourceEntityId),
    idempotencyKey:String(row.idempotencyKey),occurredAt:iso(row.occurredAt),postedAt:iso(row.postedAt)
  });
}

function stockItemFromRow(row: Record<string,unknown>): StockItemRecord {
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),ingredientId:String(row.ingredientId),
    onHandQuantity:String(row.onHandQuantity),baseUomId:String(row.baseUomId),
    ...(row.lastMovementAt==null?{}:{lastMovementAt:iso(row.lastMovementAt)})
  });
}

const RECEIPT_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 supplier_id::text AS "supplierId",receipt_number AS "receiptNumber",received_at AS "receivedAt",
 received_by_identity_id::text AS "receivedByIdentityId",status,source_request_key AS "sourceRequestKey",
 row_version AS "rowVersion",environment_class AS "environmentClass",confirmed_at AS "confirmedAt",
 confirmed_by_identity_id::text AS "confirmedByIdentityId" FROM ristoairen.goods_receipts`;

const LINE_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 goods_receipt_id::text AS "goodsReceiptId",ingredient_id::text AS "ingredientId",uom_id::text AS "uomId",
 quantity_received::text AS "quantityReceived",rejected_quantity::text AS "rejectedQuantity",
 source_line_key AS "sourceLineKey",row_version AS "rowVersion",environment_class AS "environmentClass"
 FROM ristoairen.goods_receipt_lines`;

const MOVEMENT_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 ingredient_id::text AS "ingredientId",movement_type AS "movementType",quantity_delta::text AS "quantityDelta",
 uom_id::text AS "uomId",source_entity_id::text AS "sourceEntityId",idempotency_key AS "idempotencyKey",
 occurred_at AS "occurredAt",posted_at AS "postedAt" FROM ristoairen.stock_movements`;

export class PostgresInventoryReceiveTransaction implements InventoryReceiveTransaction {
  private readonly client: PoolClient;
  private readonly context: SecurityContext;

  constructor(client: PoolClient,context: SecurityContext) { this.client=client; this.context=context; }

  async getSupplier(supplierId:string): Promise<Readonly<{id:string;active:boolean}>|null> {
    const result=await this.client.query("SELECT id::text AS id,active FROM ristoairen.suppliers WHERE id=$1::uuid",[supplierId]);
    return result.rows[0]?Object.freeze({id:String(result.rows[0].id),active:Boolean(result.rows[0].active)}):null;
  }

  async findReceiptByRequestKey(sourceRequestKey:string): Promise<GoodsReceiptRecord|null> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`risto:goods-receipt:create:${this.context.tenantId}:${this.context.locationId}:${sourceRequestKey}`]);
    const result=await this.client.query(`${RECEIPT_SELECT} WHERE source_request_key=$1`,[sourceRequestKey]);
    return result.rows[0]?receiptFromRow(result.rows[0] as Record<string,unknown>):null;
  }

  async insertReceipt(input:Readonly<{tenantId:string;locationId:string;supplierId:string;receiptNumber:string;receivedAt:string;receivedByIdentityId:string;sourceRequestKey:string;environmentClass:InventoryEnvironmentClass}>): Promise<GoodsReceiptRecord> {
    const result=await this.client.query(
      `INSERT INTO ristoairen.goods_receipts
       (tenant_id,location_id,supplier_id,receipt_number,received_at,received_by_identity_id,status,source_request_key,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::timestamptz,$6::uuid,'DRAFT',$7,1,$8)
       RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",supplier_id::text AS "supplierId",
        receipt_number AS "receiptNumber",received_at AS "receivedAt",received_by_identity_id::text AS "receivedByIdentityId",status,
        source_request_key AS "sourceRequestKey",row_version AS "rowVersion",environment_class AS "environmentClass",
        confirmed_at AS "confirmedAt",confirmed_by_identity_id::text AS "confirmedByIdentityId"`,
      [input.tenantId,input.locationId,input.supplierId,input.receiptNumber,input.receivedAt,input.receivedByIdentityId,input.sourceRequestKey,input.environmentClass]
    );
    return receiptFromRow(result.rows[0] as Record<string,unknown>);
  }

  async getReceiptForLine(goodsReceiptId:string): Promise<GoodsReceiptRecord|null> {
    const result=await this.client.query(`${RECEIPT_SELECT} WHERE id=$1::uuid FOR UPDATE`,[goodsReceiptId]);
    return result.rows[0]?receiptFromRow(result.rows[0] as Record<string,unknown>):null;
  }

  async getIngredient(ingredientId:string): Promise<IngredientMaterial|null> {
    const result=await this.client.query("SELECT id::text AS id,tenant_id::text AS \"tenantId\",base_uom_id::text AS \"baseUomId\",active FROM ristoairen.ingredients WHERE id=$1::uuid",[ingredientId]);
    return result.rows[0]?Object.freeze({id:String(result.rows[0].id),tenantId:String(result.rows[0].tenantId),baseUomId:String(result.rows[0].baseUomId),active:Boolean(result.rows[0].active)}):null;
  }

  async uomExists(uomId:string): Promise<boolean> {
    const result=await this.client.query("SELECT 1 FROM ristoairen.units_of_measure WHERE id=$1::uuid AND active=true",[uomId]);
    return Boolean(result.rows[0]);
  }

  async findLineByRequestKey(goodsReceiptId:string,sourceLineKey:string): Promise<GoodsReceiptLineRecord|null> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`risto:goods-receipt:line:${this.context.tenantId}:${this.context.locationId}:${goodsReceiptId}:${sourceLineKey}`]);
    const result=await this.client.query(`${LINE_SELECT} WHERE goods_receipt_id=$1::uuid AND source_line_key=$2`,[goodsReceiptId,sourceLineKey]);
    return result.rows[0]?lineFromRow(result.rows[0] as Record<string,unknown>):null;
  }

  async insertLine(input:Readonly<{tenantId:string;locationId:string;goodsReceiptId:string;ingredientId:string;uomId:string;quantityReceived:string;sourceLineKey:string;environmentClass:InventoryEnvironmentClass}>): Promise<GoodsReceiptLineRecord> {
    const result=await this.client.query(
      `INSERT INTO ristoairen.goods_receipt_lines
       (tenant_id,location_id,goods_receipt_id,ingredient_id,uom_id,quantity_received,rejected_quantity,source_line_key,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::numeric,0,$7,1,$8)
       RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",goods_receipt_id::text AS "goodsReceiptId",
        ingredient_id::text AS "ingredientId",uom_id::text AS "uomId",quantity_received::text AS "quantityReceived",
        rejected_quantity::text AS "rejectedQuantity",source_line_key AS "sourceLineKey",row_version AS "rowVersion",environment_class AS "environmentClass"`,
      [input.tenantId,input.locationId,input.goodsReceiptId,input.ingredientId,input.uomId,input.quantityReceived,input.sourceLineKey,input.environmentClass]
    );
    return lineFromRow(result.rows[0] as Record<string,unknown>);
  }

  async getReceiptForFinalize(goodsReceiptId:string): Promise<GoodsReceiptRecord|null> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`risto:goods-receipt:finalize:${this.context.tenantId}:${this.context.locationId}:${goodsReceiptId}`]);
    const result=await this.client.query(`${RECEIPT_SELECT} WHERE id=$1::uuid FOR UPDATE`,[goodsReceiptId]);
    return result.rows[0]?receiptFromRow(result.rows[0] as Record<string,unknown>):null;
  }

  async listReceiptLines(goodsReceiptId:string): Promise<readonly GoodsReceiptLineRecord[]> {
    const result=await this.client.query(`${LINE_SELECT} WHERE goods_receipt_id=$1::uuid ORDER BY created_at,id`,[goodsReceiptId]);
    return Object.freeze((result.rows as Record<string,unknown>[]).map(lineFromRow));
  }

  async confirmReceipt(input:Readonly<{goodsReceiptId:string;expectedRowVersion:number;confirmedAt:string;confirmedByIdentityId:string}>): Promise<GoodsReceiptRecord> {
    const result=await this.client.query(
      `UPDATE ristoairen.goods_receipts SET status='CONFIRMED',confirmed_at=$3::timestamptz,confirmed_by_identity_id=$4::uuid,
       row_version=row_version+1,updated_at=$3::timestamptz WHERE id=$1::uuid AND status='DRAFT' AND row_version=$2
       RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",supplier_id::text AS "supplierId",
        receipt_number AS "receiptNumber",received_at AS "receivedAt",received_by_identity_id::text AS "receivedByIdentityId",status,
        source_request_key AS "sourceRequestKey",row_version AS "rowVersion",environment_class AS "environmentClass",
        confirmed_at AS "confirmedAt",confirmed_by_identity_id::text AS "confirmedByIdentityId"`,
      [input.goodsReceiptId,input.expectedRowVersion,input.confirmedAt,input.confirmedByIdentityId]
    );
    if(!result.rows[0]) throw new Error("GOODS_RECEIPT_CONFIRM_STATE_CONFLICT");
    return receiptFromRow(result.rows[0] as Record<string,unknown>);
  }

  async insertReceiptMovement(input:Readonly<{tenantId:string;locationId:string;line:GoodsReceiptLineRecord;occurredAt:string;postedAt:string;postedByIdentityId:string;idempotencyKey:string;correlationId:string;environmentClass:InventoryEnvironmentClass}>): Promise<Readonly<{movement:StockMovementRecord;replayed:boolean}>> {
    const existing=await this.client.query(`${MOVEMENT_SELECT} WHERE idempotency_key=$1`,[input.idempotencyKey]);
    if(existing.rows[0]) return Object.freeze({movement:movementFromRow(existing.rows[0] as Record<string,unknown>),replayed:true});
    const result=await this.client.query(
      `INSERT INTO ristoairen.stock_movements
       (tenant_id,location_id,ingredient_id,movement_type,quantity_delta,uom_id,base_quantity_delta,source_entity_type,source_entity_id,
        reason_code,occurred_at,posted_at,posted_by_identity_id,idempotency_key,correlation_id,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'RECEIPT',$4::numeric,$5::uuid,$4::numeric,'GoodsReceiptLine',$6::uuid,
        'GOODS_RECEIPT_CONFIRMED',$7::timestamptz,$8::timestamptz,$9::uuid,$10,$11,$12)
       ON CONFLICT (tenant_id,location_id,idempotency_key) DO NOTHING
       RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",ingredient_id::text AS "ingredientId",
        movement_type AS "movementType",quantity_delta::text AS "quantityDelta",uom_id::text AS "uomId",source_entity_id::text AS "sourceEntityId",
        idempotency_key AS "idempotencyKey",occurred_at AS "occurredAt",posted_at AS "postedAt"`,
      [input.tenantId,input.locationId,input.line.ingredientId,input.line.quantityReceived,input.line.uomId,input.line.id,input.occurredAt,input.postedAt,input.postedByIdentityId,input.idempotencyKey,input.correlationId,input.environmentClass]
    );
    if(result.rows[0]) return Object.freeze({movement:movementFromRow(result.rows[0] as Record<string,unknown>),replayed:false});
    const replay=await this.client.query(`${MOVEMENT_SELECT} WHERE idempotency_key=$1`,[input.idempotencyKey]);
    if(!replay.rows[0]) throw new Error("STOCK_MOVEMENT_IDEMPOTENCY_CONFLICT");
    return Object.freeze({movement:movementFromRow(replay.rows[0] as Record<string,unknown>),replayed:true});
  }

  async listReceiptMovements(goodsReceiptId:string): Promise<readonly StockMovementRecord[]> {
    const result=await this.client.query(
      `${MOVEMENT_SELECT} WHERE source_entity_id IN (SELECT id FROM ristoairen.goods_receipt_lines WHERE goods_receipt_id=$1::uuid) ORDER BY posted_at,id`,[goodsReceiptId]
    );
    return Object.freeze((result.rows as Record<string,unknown>[]).map(movementFromRow));
  }

  async listReceiptStockItems(goodsReceiptId:string): Promise<readonly StockItemRecord[]> {
    const result=await this.client.query(
      `SELECT DISTINCT ON (s.ingredient_id) s.id::text AS id,s.tenant_id::text AS "tenantId",s.location_id::text AS "locationId",
       s.ingredient_id::text AS "ingredientId",s.on_hand_quantity::text AS "onHandQuantity",s.base_uom_id::text AS "baseUomId",
       s.last_movement_at AS "lastMovementAt" FROM ristoairen.stock_items s
       JOIN ristoairen.goods_receipt_lines l ON l.tenant_id=s.tenant_id AND l.location_id=s.location_id AND l.ingredient_id=s.ingredient_id
       WHERE l.goods_receipt_id=$1::uuid ORDER BY s.ingredient_id,s.id`,[goodsReceiptId]
    );
    return Object.freeze((result.rows as Record<string,unknown>[]).map(stockItemFromRow));
  }

  async audit(record:AuditRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_events
       (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'system',$4,$5,$6,$7,$8,$9::jsonb)`,
      [record.tenantId,record.locationId,record.actorIdentityId,record.actionKey,record.resourceType??null,record.resourceId??null,record.correlationId,record.outcome,JSON.stringify(record.metadata??{})]
    );
  }

  async outbox(_event:DomainEvent & {tenantId:string;locationId:string;correlationId:string}): Promise<void> {
    throw new Error("MAT027_INVENTORY_RECEIVE_HAS_NO_OUTBOX");
  }
}

export class PostgresInventoryReceiveUnitOfWork implements UnitOfWork<InventoryReceiveTransaction> {
  private readonly pool:Pool;
  private readonly assumeRole:string;

  constructor(pool:Pool,assumeRole="airen_app") { this.pool=pool; this.assumeRole=assumeRole; }

  async transaction<T>(fn:(tx:InventoryReceiveTransaction)=>Promise<T>,context?:SecurityContext):Promise<T> {
    if(!context) throw new Error("SecurityContext is required for MAT-027 inventory runtime");
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]
      );
      const value=await fn(new PostgresInventoryReceiveTransaction(client,context));
      await client.query("COMMIT");
      return value;
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
