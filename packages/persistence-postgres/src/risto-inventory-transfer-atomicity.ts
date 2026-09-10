import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import { AppError, type DomainEvent, type SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  InventoryTransferEnvironmentClass,
  InventoryTransferTransaction,
  StockTransferLineRecord,
  StockTransferRecord,
  TransferIngredientMaterial,
  TransferStockItemRecord,
  TransferStockMovementRecord
} from "../../ristoairen/src/inventory/inventory-transfer-atomicity.ts";
import { transferMovementIdempotencyKey } from "../../ristoairen/src/inventory/inventory-transfer-atomicity.ts";

function assertRoleIdentifier(role:string):string {
  if(!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}
function iso(value:unknown):string { return new Date(String(value)).toISOString(); }
function transferFromRow(row:Record<string,unknown>):StockTransferRecord {
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),fromLocationId:String(row.fromLocationId),toLocationId:String(row.toLocationId),
    status:String(row.status) as StockTransferRecord["status"],sourceRequestKey:String(row.sourceRequestKey),
    createdByIdentityId:String(row.createdByIdentityId),createdCorrelationId:String(row.createdCorrelationId),
    rowVersion:Number(row.rowVersion),environmentClass:String(row.environmentClass) as InventoryTransferEnvironmentClass,createdAt:iso(row.createdAt),
    ...(row.postedAt==null?{}:{postedAt:iso(row.postedAt)}),
    ...(row.postedByIdentityId==null?{}:{postedByIdentityId:String(row.postedByIdentityId)}),
    ...(row.postedCorrelationId==null?{}:{postedCorrelationId:String(row.postedCorrelationId)})
  });
}
function lineFromRow(row:Record<string,unknown>):StockTransferLineRecord {
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),stockTransferId:String(row.stockTransferId),ingredientId:String(row.ingredientId),
    uomId:String(row.uomId),quantity:String(row.quantity),sourceLineKey:String(row.sourceLineKey),rowVersion:Number(row.rowVersion),
    environmentClass:String(row.environmentClass) as InventoryTransferEnvironmentClass
  });
}
function movementFromRow(row:Record<string,unknown>):TransferStockMovementRecord {
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),ingredientId:String(row.ingredientId),
    movementType:String(row.movementType) as TransferStockMovementRecord["movementType"],quantityDelta:String(row.quantityDelta),uomId:String(row.uomId),
    sourceEntityId:String(row.sourceEntityId),idempotencyKey:String(row.idempotencyKey),correlationId:String(row.correlationId),
    occurredAt:iso(row.occurredAt),postedAt:iso(row.postedAt)
  });
}
function stockItemFromRow(row:Record<string,unknown>):TransferStockItemRecord {
  return Object.freeze({
    id:String(row.id),tenantId:String(row.tenantId),locationId:String(row.locationId),ingredientId:String(row.ingredientId),
    onHandQuantity:String(row.onHandQuantity),baseUomId:String(row.baseUomId),
    ...(row.lastMovementAt==null?{}:{lastMovementAt:iso(row.lastMovementAt)})
  });
}

const TRANSFER_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",from_location_id::text AS "fromLocationId",
 to_location_id::text AS "toLocationId",status,source_request_key AS "sourceRequestKey",
 created_by_identity_id::text AS "createdByIdentityId",created_correlation_id AS "createdCorrelationId",
 posted_by_identity_id::text AS "postedByIdentityId",posted_correlation_id AS "postedCorrelationId",posted_at AS "postedAt",
 row_version AS "rowVersion",environment_class AS "environmentClass",created_at AS "createdAt" FROM ristoairen.stock_transfers`;
const LINE_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",stock_transfer_id::text AS "stockTransferId",
 ingredient_id::text AS "ingredientId",uom_id::text AS "uomId",quantity::text AS quantity,source_line_key AS "sourceLineKey",
 row_version AS "rowVersion",environment_class AS "environmentClass" FROM ristoairen.stock_transfer_lines`;
const MOVEMENT_SELECT=`SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 ingredient_id::text AS "ingredientId",movement_type AS "movementType",quantity_delta::text AS "quantityDelta",uom_id::text AS "uomId",
 source_entity_id::text AS "sourceEntityId",idempotency_key AS "idempotencyKey",correlation_id AS "correlationId",
 occurred_at AS "occurredAt",posted_at AS "postedAt" FROM ristoairen.stock_movements`;

export class PostgresInventoryTransferTransaction implements InventoryTransferTransaction {
  private readonly client:PoolClient;
  private readonly context:SecurityContext;
  constructor(client:PoolClient,context:SecurityContext) { this.client=client;this.context=context; }

  private async setLocation(locationId:string):Promise<void> {
    await this.client.query("SELECT set_config('airen.location_id',$1,true)",[locationId]);
  }

  private async assertOneLocationAuthority(locationId:string,permission:string):Promise<void> {
    await this.setLocation(locationId);
    const location=await this.client.query(
      "SELECT id::text AS id FROM platform.locations WHERE tenant_id=$1::uuid AND id=$2::uuid AND status='active'",
      [this.context.tenantId,locationId]
    );
    if(!location.rows[0]) throw new AppError("LOCATION_SCOPE_DENIED","Active Location not found in Tenant scope");
    const tenantMembership=await this.client.query(
      "SELECT id::text AS id,role_key AS \"roleKey\" FROM authz.tenant_memberships WHERE tenant_id=$1::uuid AND identity_id=$2::uuid AND status='active'",
      [this.context.tenantId,this.context.actorIdentityId]
    );
    if(!tenantMembership.rows[0]) throw new AppError("TENANT_MEMBERSHIP_REQUIRED","Active TenantMembership is required");
    const locationMembership=await this.client.query(
      `SELECT id::text AS id,role_key AS "roleKey" FROM authz.location_memberships
        WHERE tenant_id=$1::uuid AND tenant_membership_id=$2::uuid AND location_id=$3::uuid AND status='active'`,
      [this.context.tenantId,String(tenantMembership.rows[0].id),locationId]
    );
    if(!locationMembership.rows[0]) throw new AppError("LOCATION_MEMBERSHIP_REQUIRED","Active LocationMembership is required for both transfer Locations");
    const allowed=await this.client.query(
      `SELECT EXISTS(
         SELECT 1 FROM authz.role_permission_grants g
          WHERE g.permission_key=$1 AND g.effect='allow' AND (
            (g.scope_kind='tenant' AND g.role_key=$2)
            OR (g.scope_kind='location' AND g.role_key=$3)
          )
       ) AS allowed`,
      [permission,String(tenantMembership.rows[0].roleKey),String(locationMembership.rows[0].roleKey)]
    );
    if(!Boolean(allowed.rows[0]?.allowed)) throw new AppError("PERMISSION_DENIED",`Missing effective permission ${permission} at Location`);
  }

  async assertDualLocationAuthority(fromLocationId:string,toLocationId:string,permission:string):Promise<void> {
    if(fromLocationId!==this.context.locationId) throw new AppError("LOCATION_SCOPE_DENIED","Transfer source must be the active server-derived Location");
    if(fromLocationId===toLocationId) throw new AppError("VALIDATION_FAILED","Transfer Locations must be distinct");
    try {
      await this.assertOneLocationAuthority(fromLocationId,permission);
      await this.assertOneLocationAuthority(toLocationId,permission);
      await this.setLocation(this.context.locationId);
    } catch(error) {
      try { await this.setLocation(this.context.locationId); } catch { /* preserve original failure */ }
      throw error;
    }
  }

  async findTransferByRequestKey(sourceRequestKey:string):Promise<StockTransferRecord|null> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`risto:stock-transfer:create:${this.context.tenantId}:${this.context.locationId}:${sourceRequestKey}`]);
    const result=await this.client.query(`${TRANSFER_SELECT} WHERE from_location_id=$1::uuid AND source_request_key=$2`,[this.context.locationId,sourceRequestKey]);
    return result.rows[0]?transferFromRow(result.rows[0] as Record<string,unknown>):null;
  }

  async insertTransfer(input:Readonly<{tenantId:string;fromLocationId:string;toLocationId:string;sourceRequestKey:string;createdByIdentityId:string;createdCorrelationId:string;environmentClass:InventoryTransferEnvironmentClass}>):Promise<StockTransferRecord> {
    const result=await this.client.query(
      `INSERT INTO ristoairen.stock_transfers
       (tenant_id,from_location_id,to_location_id,status,source_request_key,created_by_identity_id,created_correlation_id,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'DRAFT',$4,$5::uuid,$6,1,$7)
       RETURNING id::text AS id,tenant_id::text AS "tenantId",from_location_id::text AS "fromLocationId",to_location_id::text AS "toLocationId",
        status,source_request_key AS "sourceRequestKey",created_by_identity_id::text AS "createdByIdentityId",created_correlation_id AS "createdCorrelationId",
        posted_by_identity_id::text AS "postedByIdentityId",posted_correlation_id AS "postedCorrelationId",posted_at AS "postedAt",
        row_version AS "rowVersion",environment_class AS "environmentClass",created_at AS "createdAt"`,
      [input.tenantId,input.fromLocationId,input.toLocationId,input.sourceRequestKey,input.createdByIdentityId,input.createdCorrelationId,input.environmentClass]
    );
    return transferFromRow(result.rows[0] as Record<string,unknown>);
  }

  async getTransferForLine(stockTransferId:string):Promise<StockTransferRecord|null> {
    const result=await this.client.query(`${TRANSFER_SELECT} WHERE id=$1::uuid FOR UPDATE`,[stockTransferId]);
    return result.rows[0]?transferFromRow(result.rows[0] as Record<string,unknown>):null;
  }

  async getIngredient(ingredientId:string):Promise<TransferIngredientMaterial|null> {
    const result=await this.client.query(
      "SELECT id::text AS id,tenant_id::text AS \"tenantId\",base_uom_id::text AS \"baseUomId\",active FROM ristoairen.ingredients WHERE id=$1::uuid",
      [ingredientId]
    );
    return result.rows[0]?Object.freeze({id:String(result.rows[0].id),tenantId:String(result.rows[0].tenantId),baseUomId:String(result.rows[0].baseUomId),active:Boolean(result.rows[0].active)}):null;
  }

  async findLineByRequestKey(stockTransferId:string,sourceLineKey:string):Promise<StockTransferLineRecord|null> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`risto:stock-transfer:line:${this.context.tenantId}:${stockTransferId}:${sourceLineKey}`]);
    const result=await this.client.query(`${LINE_SELECT} WHERE stock_transfer_id=$1::uuid AND source_line_key=$2`,[stockTransferId,sourceLineKey]);
    return result.rows[0]?lineFromRow(result.rows[0] as Record<string,unknown>):null;
  }

  async insertLine(input:Readonly<{tenantId:string;stockTransferId:string;ingredientId:string;uomId:string;quantity:string;sourceLineKey:string;environmentClass:InventoryTransferEnvironmentClass}>):Promise<StockTransferLineRecord> {
    const result=await this.client.query(
      `INSERT INTO ristoairen.stock_transfer_lines
       (tenant_id,stock_transfer_id,ingredient_id,uom_id,quantity,source_line_key,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::numeric,$6,1,$7)
       RETURNING id::text AS id,tenant_id::text AS "tenantId",stock_transfer_id::text AS "stockTransferId",ingredient_id::text AS "ingredientId",
        uom_id::text AS "uomId",quantity::text AS quantity,source_line_key AS "sourceLineKey",row_version AS "rowVersion",environment_class AS "environmentClass"`,
      [input.tenantId,input.stockTransferId,input.ingredientId,input.uomId,input.quantity,input.sourceLineKey,input.environmentClass]
    );
    return lineFromRow(result.rows[0] as Record<string,unknown>);
  }

  async getTransferForPost(stockTransferId:string):Promise<StockTransferRecord|null> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`risto:stock-transfer:post:${this.context.tenantId}:${stockTransferId}`]);
    const result=await this.client.query(`${TRANSFER_SELECT} WHERE id=$1::uuid FOR UPDATE`,[stockTransferId]);
    return result.rows[0]?transferFromRow(result.rows[0] as Record<string,unknown>):null;
  }

  async listTransferLines(stockTransferId:string):Promise<readonly StockTransferLineRecord[]> {
    const result=await this.client.query(`${LINE_SELECT} WHERE stock_transfer_id=$1::uuid ORDER BY created_at,id`,[stockTransferId]);
    return Object.freeze((result.rows as Record<string,unknown>[]).map(lineFromRow));
  }

  async markTransferPosted(input:Readonly<{stockTransferId:string;expectedRowVersion:number;postedAt:string;postedByIdentityId:string;postedCorrelationId:string}>):Promise<StockTransferRecord> {
    const result=await this.client.query(
      `UPDATE ristoairen.stock_transfers
          SET status='POSTED',posted_at=$3::timestamptz,posted_by_identity_id=$4::uuid,posted_correlation_id=$5,row_version=row_version+1,updated_at=$3::timestamptz
        WHERE id=$1::uuid AND status='DRAFT' AND row_version=$2
        RETURNING id::text AS id,tenant_id::text AS "tenantId",from_location_id::text AS "fromLocationId",to_location_id::text AS "toLocationId",
         status,source_request_key AS "sourceRequestKey",created_by_identity_id::text AS "createdByIdentityId",created_correlation_id AS "createdCorrelationId",
         posted_by_identity_id::text AS "postedByIdentityId",posted_correlation_id AS "postedCorrelationId",posted_at AS "postedAt",
         row_version AS "rowVersion",environment_class AS "environmentClass",created_at AS "createdAt"`,
      [input.stockTransferId,input.expectedRowVersion,input.postedAt,input.postedByIdentityId,input.postedCorrelationId]
    );
    if(!result.rows[0]) throw new AppError("CONFLICT","StockTransfer post state changed concurrently");
    return transferFromRow(result.rows[0] as Record<string,unknown>);
  }

  async insertTransferMovement(input:Readonly<{transfer:StockTransferRecord;line:StockTransferLineRecord;side:"out"|"in";postedAt:string;postedByIdentityId:string;correlationId:string}>):Promise<Readonly<{movement:TransferStockMovementRecord;replayed:boolean}>> {
    const locationId=input.side==="out"?input.transfer.fromLocationId:input.transfer.toLocationId;
    const movementType=input.side==="out"?"TRANSFER_OUT":"TRANSFER_IN";
    const quantityDelta=input.side==="out"?`-${input.line.quantity}`:input.line.quantity;
    const idempotencyKey=transferMovementIdempotencyKey(input.transfer.id,input.line.id,input.side);
    await this.setLocation(locationId);
    const existing=await this.client.query(`${MOVEMENT_SELECT} WHERE idempotency_key=$1`,[idempotencyKey]);
    if(existing.rows[0]) {
      const movement=movementFromRow(existing.rows[0] as Record<string,unknown>);
      if(movement.movementType!==movementType||movement.sourceEntityId!==input.line.id||movement.quantityDelta!==quantityDelta||movement.correlationId!==input.correlationId) {
        throw new AppError("IDEMPOTENCY_CONFLICT","Transfer movement key is bound to different semantics");
      }
      await this.setLocation(this.context.locationId);
      return Object.freeze({movement,replayed:true});
    }
    const result=await this.client.query(
      `INSERT INTO ristoairen.stock_movements
       (tenant_id,location_id,ingredient_id,movement_type,quantity_delta,uom_id,base_quantity_delta,source_entity_type,source_entity_id,
        reason_code,occurred_at,posted_at,posted_by_identity_id,idempotency_key,correlation_id,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::numeric,$6::uuid,$5::numeric,'StockTransferLine',$7::uuid,
        'STOCK_TRANSFER_POSTED',$8::timestamptz,$8::timestamptz,$9::uuid,$10,$11,$12)
       ON CONFLICT (tenant_id,location_id,idempotency_key) DO NOTHING
       RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",ingredient_id::text AS "ingredientId",
        movement_type AS "movementType",quantity_delta::text AS "quantityDelta",uom_id::text AS "uomId",source_entity_id::text AS "sourceEntityId",
        idempotency_key AS "idempotencyKey",correlation_id AS "correlationId",occurred_at AS "occurredAt",posted_at AS "postedAt"`,
      [input.transfer.tenantId,locationId,input.line.ingredientId,movementType,quantityDelta,input.line.uomId,input.line.id,input.postedAt,input.postedByIdentityId,idempotencyKey,input.correlationId,input.transfer.environmentClass]
    );
    let movement:TransferStockMovementRecord;
    let replayed=false;
    if(result.rows[0]) movement=movementFromRow(result.rows[0] as Record<string,unknown>);
    else {
      const replay=await this.client.query(`${MOVEMENT_SELECT} WHERE idempotency_key=$1`,[idempotencyKey]);
      if(!replay.rows[0]) throw new AppError("IDEMPOTENCY_CONFLICT","Transfer movement insertion did not converge");
      movement=movementFromRow(replay.rows[0] as Record<string,unknown>);replayed=true;
    }
    await this.setLocation(this.context.locationId);
    return Object.freeze({movement,replayed});
  }

  async listTransferMovements(transfer:StockTransferRecord):Promise<readonly TransferStockMovementRecord[]> {
    const rows:TransferStockMovementRecord[]=[];
    for(const locationId of [transfer.fromLocationId,transfer.toLocationId]) {
      await this.setLocation(locationId);
      const result=await this.client.query(
        `${MOVEMENT_SELECT} WHERE source_entity_type='StockTransferLine' AND source_entity_id IN
          (SELECT id FROM ristoairen.stock_transfer_lines WHERE stock_transfer_id=$1::uuid) ORDER BY source_entity_id,movement_type,id`,[transfer.id]
      );
      rows.push(...(result.rows as Record<string,unknown>[]).map(movementFromRow));
    }
    await this.setLocation(this.context.locationId);
    return Object.freeze(rows);
  }

  async listTransferStockItems(transfer:StockTransferRecord):Promise<readonly TransferStockItemRecord[]> {
    const rows:TransferStockItemRecord[]=[];
    for(const locationId of [transfer.fromLocationId,transfer.toLocationId]) {
      await this.setLocation(locationId);
      const result=await this.client.query(
        `SELECT DISTINCT ON (s.ingredient_id) s.id::text AS id,s.tenant_id::text AS "tenantId",s.location_id::text AS "locationId",
         s.ingredient_id::text AS "ingredientId",s.on_hand_quantity::text AS "onHandQuantity",s.base_uom_id::text AS "baseUomId",
         s.last_movement_at AS "lastMovementAt"
         FROM ristoairen.stock_items s
         JOIN ristoairen.stock_transfer_lines l ON l.tenant_id=s.tenant_id AND l.ingredient_id=s.ingredient_id
         WHERE l.stock_transfer_id=$1::uuid ORDER BY s.ingredient_id,s.id`,[transfer.id]
      );
      rows.push(...(result.rows as Record<string,unknown>[]).map(stockItemFromRow));
    }
    await this.setLocation(this.context.locationId);
    return Object.freeze(rows);
  }

  async audit(record:AuditRecord):Promise<void> {
    await this.setLocation(this.context.locationId);
    await this.client.query(
      `INSERT INTO audit.audit_events
       (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'user',$4,$5,$6,$7,$8,$9::jsonb)`,
      [record.tenantId,record.locationId,record.actorIdentityId,record.actionKey,record.resourceType??null,record.resourceId??null,record.correlationId,record.outcome,JSON.stringify(record.metadata??{})]
    );
  }

  async outbox(_event:DomainEvent & {tenantId:string;locationId:string;correlationId:string}):Promise<void> {
    throw new Error("MAT028_INVENTORY_TRANSFER_HAS_NO_OUTBOX");
  }
}

export class PostgresInventoryTransferUnitOfWork implements UnitOfWork<InventoryTransferTransaction> {
  private readonly pool:Pool;
  private readonly assumeRole:string;
  constructor(pool:Pool,assumeRole="airen_app") { this.pool=pool;this.assumeRole=assumeRole; }
  async transaction<T>(fn:(tx:InventoryTransferTransaction)=>Promise<T>,context?:SecurityContext):Promise<T> {
    if(!context) throw new Error("SecurityContext is required for MAT-028 inventory transfer runtime");
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]
      );
      const value=await fn(new PostgresInventoryTransferTransaction(client,context));
      await client.query("COMMIT");
      return value;
    } catch(error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    } finally { client.release(); }
  }
}
