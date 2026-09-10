import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const INVENTORY_TRANSFER_CREATE_PERMISSION = "inventory.transfer.create";
export const INVENTORY_TRANSFER_APPROVE_PERMISSION = "inventory.transfer.approve";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const INVENTORY_ENTITLEMENT = "inventory.enabled";
export const STOCK_TRANSFER_CREATED_ACTION = "STOCK_TRANSFER_CREATED";
export const STOCK_TRANSFER_LINE_RECORDED_ACTION = "STOCK_TRANSFER_LINE_RECORDED";
export const STOCK_TRANSFER_POSTED_ACTION = "STOCK_TRANSFER_POSTED";

export type InventoryTransferEnvironmentClass = "DEMO" | "SANDBOX" | "TEST_TEMPORARY";
export type StockTransferStatus = "DRAFT" | "POSTED";
export type StockTransferRecord = Readonly<{
  id:string;tenantId:string;fromLocationId:string;toLocationId:string;status:StockTransferStatus;
  sourceRequestKey:string;createdByIdentityId:string;createdCorrelationId:string;rowVersion:number;
  environmentClass:InventoryTransferEnvironmentClass;createdAt:string;postedAt?:string;postedByIdentityId?:string;postedCorrelationId?:string;
}>;
export type StockTransferLineRecord = Readonly<{
  id:string;tenantId:string;stockTransferId:string;ingredientId:string;uomId:string;quantity:string;
  sourceLineKey:string;rowVersion:number;environmentClass:InventoryTransferEnvironmentClass;
}>;
export type TransferStockMovementRecord = Readonly<{
  id:string;tenantId:string;locationId:string;ingredientId:string;movementType:"TRANSFER_OUT"|"TRANSFER_IN";
  quantityDelta:string;uomId:string;sourceEntityId:string;idempotencyKey:string;correlationId:string;occurredAt:string;postedAt:string;
}>;
export type TransferStockItemRecord = Readonly<{
  id:string;tenantId:string;locationId:string;ingredientId:string;onHandQuantity:string;baseUomId:string;lastMovementAt?:string;
}>;
export type TransferIngredientMaterial = Readonly<{id:string;tenantId:string;baseUomId:string;active:boolean}>;

export interface InventoryTransferTransaction extends TransactionContext {
  assertDualLocationAuthority(fromLocationId:string,toLocationId:string,permission:string):Promise<void>;
  findTransferByRequestKey(sourceRequestKey:string):Promise<StockTransferRecord|null>;
  insertTransfer(input:Readonly<{tenantId:string;fromLocationId:string;toLocationId:string;sourceRequestKey:string;createdByIdentityId:string;createdCorrelationId:string;environmentClass:InventoryTransferEnvironmentClass}>):Promise<StockTransferRecord>;
  getTransferForLine(stockTransferId:string):Promise<StockTransferRecord|null>;
  getIngredient(ingredientId:string):Promise<TransferIngredientMaterial|null>;
  findLineByRequestKey(stockTransferId:string,sourceLineKey:string):Promise<StockTransferLineRecord|null>;
  insertLine(input:Readonly<{tenantId:string;stockTransferId:string;ingredientId:string;uomId:string;quantity:string;sourceLineKey:string;environmentClass:InventoryTransferEnvironmentClass}>):Promise<StockTransferLineRecord>;
  getTransferForPost(stockTransferId:string):Promise<StockTransferRecord|null>;
  listTransferLines(stockTransferId:string):Promise<readonly StockTransferLineRecord[]>;
  markTransferPosted(input:Readonly<{stockTransferId:string;expectedRowVersion:number;postedAt:string;postedByIdentityId:string;postedCorrelationId:string}>):Promise<StockTransferRecord>;
  insertTransferMovement(input:Readonly<{transfer:StockTransferRecord;line:StockTransferLineRecord;side:"out"|"in";postedAt:string;postedByIdentityId:string;correlationId:string}>):Promise<Readonly<{movement:TransferStockMovementRecord;replayed:boolean}>>;
  listTransferMovements(transfer:StockTransferRecord):Promise<readonly TransferStockMovementRecord[]>;
  listTransferStockItems(transfer:StockTransferRecord):Promise<readonly TransferStockItemRecord[]>;
}

export type InventoryTransferDependencies = Readonly<{
  unitOfWork:UnitOfWork<InventoryTransferTransaction>;
  now?:()=>string;
  environmentClass?:InventoryTransferEnvironmentClass;
  faultInjector?:(point:"after_first_transfer_out")=>void|Promise<void>;
}>;

function validation(message:string):never { throw new AppError("VALIDATION_FAILED",message); }
function conflict(message:string):never { throw new AppError("CONFLICT",message); }
function notFound(message:string):never { throw new AppError("NOT_FOUND",message); }
function normalizeId(value:string,field:string):string {
  const normalized=value?.trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) validation(`${field} is invalid`);
  return normalized.toLowerCase();
}
function normalizeKey(value:string,field:string,max=200):string {
  const normalized=value?.trim();
  if(!normalized||normalized.length>max) validation(`${field} is invalid`);
  return normalized;
}
function normalizePositiveDecimal(value:string,field:string):string {
  const normalized=value?.trim();
  if(!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)||/^0(?:\.0{1,6})?$/.test(normalized)) validation(`${field} must be a positive decimal string`);
  const [whole,fraction=""]=normalized.split(".");
  if(whole.length>12) validation(`${field} is too large`);
  return `${whole}.${fraction.padEnd(6,"0")}`;
}
function serverNow(now?:()=>string):string {
  const value=(now??(()=>new Date().toISOString()))();
  if(!Number.isFinite(Date.parse(value))) throw new AppError("RUNTIME_CONFIGURATION_INVALID","Server clock returned invalid timestamp");
  return new Date(value).toISOString();
}
function environment(deps:InventoryTransferDependencies):InventoryTransferEnvironmentClass { return deps.environmentClass??"TEST_TEMPORARY"; }
function requireEntitlements(context:SecurityContext):void {
  for(const entitlement of [RISTOAIREN_ENTITLEMENT,INVENTORY_ENTITLEMENT]) {
    if(!context.entitlements.includes(entitlement)) throw new AppError("ENTITLEMENT_REQUIRED",`Missing entitlement: ${entitlement}`);
  }
}
function authority(context:SecurityContext,permission:string):void {
  requireEntitlements(context);
  requirePermission(context,permission,{tenantId:context.tenantId,locationId:context.locationId});
}
function audit(context:SecurityContext,actionKey:string,resourceType:string,resourceId:string,metadata:Readonly<Record<string,unknown>>):AuditRecord {
  return Object.freeze({actorIdentityId:context.actorIdentityId,tenantId:context.tenantId,locationId:context.locationId,actionKey,resourceType,resourceId,correlationId:context.correlationId,outcome:"success",metadata});
}

export function transferMovementIdempotencyKey(transferId:string,lineId:string,side:"out"|"in"):string {
  return `stock-transfer:${transferId}:line:${lineId}:${side}`;
}

export async function createStockTransfer(
  context:SecurityContext,
  rawInput:Readonly<{toLocationId:string;idempotencyKey:string}>,
  dependencies:InventoryTransferDependencies
):Promise<Readonly<{transfer:StockTransferRecord;replayed:boolean}>> {
  authority(context,INVENTORY_TRANSFER_CREATE_PERMISSION);
  const toLocationId=normalizeId(rawInput.toLocationId,"toLocationId");
  const sourceRequestKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey");
  if(toLocationId===context.locationId) validation("Transfer source and destination Locations must be different");
  return dependencies.unitOfWork.transaction(async tx=>{
    await tx.assertDualLocationAuthority(context.locationId,toLocationId,INVENTORY_TRANSFER_CREATE_PERMISSION);
    const existing=await tx.findTransferByRequestKey(sourceRequestKey);
    if(existing) {
      if(existing.fromLocationId!==context.locationId||existing.toLocationId!==toLocationId) conflict("StockTransfer idempotency key was already used with different input");
      return Object.freeze({transfer:existing,replayed:true});
    }
    const transfer=await tx.insertTransfer(Object.freeze({tenantId:context.tenantId,fromLocationId:context.locationId,toLocationId,sourceRequestKey,createdByIdentityId:context.actorIdentityId,createdCorrelationId:context.correlationId,environmentClass:environment(dependencies)}));
    await tx.audit(audit(context,STOCK_TRANSFER_CREATED_ACTION,"StockTransfer",transfer.id,Object.freeze({fromLocationId:transfer.fromLocationId,toLocationId:transfer.toLocationId})));
    return Object.freeze({transfer,replayed:false});
  },context);
}

export async function recordStockTransferLine(
  context:SecurityContext,
  rawInput:Readonly<{stockTransferId:string;ingredientId:string;uomId:string;quantity:string;idempotencyKey:string}>,
  dependencies:InventoryTransferDependencies
):Promise<Readonly<{line:StockTransferLineRecord;replayed:boolean}>> {
  authority(context,INVENTORY_TRANSFER_CREATE_PERMISSION);
  const stockTransferId=normalizeId(rawInput.stockTransferId,"stockTransferId");
  const ingredientId=normalizeId(rawInput.ingredientId,"ingredientId");
  const uomId=normalizeId(rawInput.uomId,"uomId");
  const quantity=normalizePositiveDecimal(rawInput.quantity,"quantity");
  const sourceLineKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey");
  return dependencies.unitOfWork.transaction(async tx=>{
    const transfer=await tx.getTransferForLine(stockTransferId);
    if(!transfer) notFound("StockTransfer not found");
    if(transfer.fromLocationId!==context.locationId) notFound("StockTransfer not found");
    if(transfer.status!=="DRAFT") conflict("Only DRAFT StockTransfer can accept lines");
    await tx.assertDualLocationAuthority(transfer.fromLocationId,transfer.toLocationId,INVENTORY_TRANSFER_CREATE_PERMISSION);
    const existing=await tx.findLineByRequestKey(stockTransferId,sourceLineKey);
    if(existing) {
      if(existing.ingredientId!==ingredientId||existing.uomId!==uomId||existing.quantity!==quantity) conflict("StockTransferLine idempotency key was already used with different input");
      return Object.freeze({line:existing,replayed:true});
    }
    const ingredient=await tx.getIngredient(ingredientId);
    if(!ingredient||!ingredient.active) notFound("Active Ingredient not found in Tenant scope");
    if(ingredient.baseUomId!==uomId) conflict("MAT-028 transfer baseline requires Ingredient base UOM");
    const line=await tx.insertLine(Object.freeze({tenantId:context.tenantId,stockTransferId,ingredientId,uomId,quantity,sourceLineKey,environmentClass:transfer.environmentClass}));
    await tx.audit(audit(context,STOCK_TRANSFER_LINE_RECORDED_ACTION,"StockTransferLine",line.id,Object.freeze({stockTransferId,ingredientId,uomId,quantity,toLocationId:transfer.toLocationId})));
    return Object.freeze({line,replayed:false});
  },context);
}

export async function postStockTransfer(
  context:SecurityContext,
  rawInput:Readonly<{stockTransferId:string;expectedRowVersion:number}>,
  dependencies:InventoryTransferDependencies
):Promise<Readonly<{transfer:StockTransferRecord;movements:readonly TransferStockMovementRecord[];stockItems:readonly TransferStockItemRecord[];replayed:boolean}>> {
  authority(context,INVENTORY_TRANSFER_APPROVE_PERMISSION);
  const stockTransferId=normalizeId(rawInput.stockTransferId,"stockTransferId");
  if(!Number.isInteger(rawInput.expectedRowVersion)||rawInput.expectedRowVersion<1) validation("expectedRowVersion is invalid");
  const now=serverNow(dependencies.now);
  return dependencies.unitOfWork.transaction(async tx=>{
    const transfer=await tx.getTransferForPost(stockTransferId);
    if(!transfer||transfer.fromLocationId!==context.locationId) notFound("StockTransfer not found");
    await tx.assertDualLocationAuthority(transfer.fromLocationId,transfer.toLocationId,INVENTORY_TRANSFER_APPROVE_PERMISSION);
    if(transfer.status==="POSTED") {
      return Object.freeze({transfer,movements:Object.freeze([...(await tx.listTransferMovements(transfer))]),stockItems:Object.freeze([...(await tx.listTransferStockItems(transfer))]),replayed:true});
    }
    if(transfer.rowVersion!==rawInput.expectedRowVersion) conflict("StockTransfer row_version is stale");
    const lines=await tx.listTransferLines(stockTransferId);
    if(!lines.length) conflict("StockTransfer requires at least one line before posting");
    const posted=await tx.markTransferPosted(Object.freeze({stockTransferId,expectedRowVersion:rawInput.expectedRowVersion,postedAt:now,postedByIdentityId:context.actorIdentityId,postedCorrelationId:context.correlationId}));
    const movements:TransferStockMovementRecord[]=[];
    let injected=false;
    for(const line of lines) {
      const out=await tx.insertTransferMovement(Object.freeze({transfer:posted,line,side:"out",postedAt:now,postedByIdentityId:context.actorIdentityId,correlationId:context.correlationId}));
      movements.push(out.movement);
      if(!injected&&dependencies.faultInjector) {
        injected=true;
        await dependencies.faultInjector("after_first_transfer_out");
      }
      const incoming=await tx.insertTransferMovement(Object.freeze({transfer:posted,line,side:"in",postedAt:now,postedByIdentityId:context.actorIdentityId,correlationId:context.correlationId}));
      movements.push(incoming.movement);
    }
    const stockItems=await tx.listTransferStockItems(posted);
    await tx.audit(audit(context,STOCK_TRANSFER_POSTED_ACTION,"StockTransfer",posted.id,Object.freeze({fromLocationId:posted.fromLocationId,toLocationId:posted.toLocationId,lineCount:lines.length,movementIds:movements.map(m=>m.id)})));
    return Object.freeze({transfer:posted,movements:Object.freeze(movements),stockItems:Object.freeze([...stockItems]),replayed:false});
  },context);
}
