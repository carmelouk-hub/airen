import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const GOODS_RECEIPT_CREATE_PERMISSION = "procurement.goods_receipt.create";
export const GOODS_RECEIPT_CONFIRM_PERMISSION = "procurement.goods_receipt.confirm";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const PROCUREMENT_ENTITLEMENT = "procurement.enabled";
export const INVENTORY_ENTITLEMENT = "inventory.enabled";
export const GOODS_RECEIPT_CREATED_ACTION = "GOODS_RECEIPT_CREATED";
export const GOODS_RECEIPT_LINE_RECORDED_ACTION = "GOODS_RECEIPT_LINE_RECORDED";
export const GOODS_RECEIPT_FINALIZED_ACTION = "GOODS_RECEIPT_FINALIZED";

export type GoodsReceiptStatus = "DRAFT" | "CONFIRMED";
export type InventoryEnvironmentClass = "DEMO" | "SANDBOX" | "TEST_TEMPORARY";
export type PurchaseOrderStatus = "DRAFT"|"PENDING_APPROVAL"|"APPROVED"|"SENT"|"PARTIALLY_RECEIVED"|"RECEIVED"|"CLOSED"|"CANCELLED";
export type GoodsReceiptRecord = Readonly<{id:string;tenantId:string;locationId:string;supplierId:string;purchaseOrderId?:string;receiptNumber:string;receivedAt:string;receivedByIdentityId:string;status:GoodsReceiptStatus;sourceRequestKey:string;rowVersion:number;environmentClass:InventoryEnvironmentClass;confirmedAt?:string;confirmedByIdentityId?:string}>;
export type GoodsReceiptLineRecord = Readonly<{id:string;tenantId:string;locationId:string;goodsReceiptId:string;ingredientId:string;uomId:string;quantityReceived:string;rejectedQuantity:string;purchaseOrderLineId?:string;unitCostActual?:string;sourceLineKey:string;rowVersion:number;environmentClass:InventoryEnvironmentClass}>;
export type IngredientMaterial = Readonly<{id:string;tenantId:string;baseUomId:string;active:boolean}>;
export type StockMovementRecord = Readonly<{id:string;tenantId:string;locationId:string;ingredientId:string;movementType:"RECEIPT";quantityDelta:string;uomId:string;sourceEntityId:string;idempotencyKey:string;occurredAt:string;postedAt:string}>;
export type StockItemRecord = Readonly<{id:string;tenantId:string;locationId:string;ingredientId:string;onHandQuantity:string;baseUomId:string;lastMovementAt?:string}>;
export type PurchaseOrderRecord = Readonly<{id:string;tenantId:string;locationId:string;supplierId:string;status:PurchaseOrderStatus;currency:string;rowVersion:number;environmentClass:InventoryEnvironmentClass}>;
export type PurchaseOrderLineMaterial = Readonly<{id:string;tenantId:string;locationId:string;purchaseOrderId:string;supplierItemId:string;supplierId:string;ingredientId:string;uomId:string;quantityOrdered:string;supplierItemActive:boolean;environmentClass:InventoryEnvironmentClass}>;
export type SupplierPriceRecord = Readonly<{id:string;tenantId:string;supplierItemId:string;unitCost:string;currency:string;effectiveAt:string;sourceEntityId:string;recordedByIdentityId:string;correlationId:string;environmentClass:InventoryEnvironmentClass}>;

export interface InventoryReceiveTransaction extends TransactionContext {
  getSupplier(supplierId:string):Promise<Readonly<{id:string;active:boolean}>|null>;
  findReceiptByRequestKey(sourceRequestKey:string):Promise<GoodsReceiptRecord|null>;
  insertReceipt(input:Readonly<{tenantId:string;locationId:string;supplierId:string;purchaseOrderId?:string;receiptNumber:string;receivedAt:string;receivedByIdentityId:string;sourceRequestKey:string;environmentClass:InventoryEnvironmentClass}>):Promise<GoodsReceiptRecord>;
  getReceiptForLine(goodsReceiptId:string):Promise<GoodsReceiptRecord|null>;
  getIngredient(ingredientId:string):Promise<IngredientMaterial|null>;
  uomExists(uomId:string):Promise<boolean>;
  findLineByRequestKey(goodsReceiptId:string,sourceLineKey:string):Promise<GoodsReceiptLineRecord|null>;
  insertLine(input:Readonly<{tenantId:string;locationId:string;goodsReceiptId:string;ingredientId:string;uomId:string;quantityReceived:string;purchaseOrderLineId?:string;unitCostActual?:string;sourceLineKey:string;environmentClass:InventoryEnvironmentClass}>):Promise<GoodsReceiptLineRecord>;
  getReceiptForFinalize(goodsReceiptId:string):Promise<GoodsReceiptRecord|null>;
  listReceiptLines(goodsReceiptId:string):Promise<readonly GoodsReceiptLineRecord[]>;
  confirmReceipt(input:Readonly<{goodsReceiptId:string;expectedRowVersion:number;confirmedAt:string;confirmedByIdentityId:string}>):Promise<GoodsReceiptRecord>;
  insertReceiptMovement(input:Readonly<{tenantId:string;locationId:string;line:GoodsReceiptLineRecord;occurredAt:string;postedAt:string;postedByIdentityId:string;idempotencyKey:string;correlationId:string;environmentClass:InventoryEnvironmentClass}>):Promise<Readonly<{movement:StockMovementRecord;replayed:boolean}>>;
  listReceiptMovements(goodsReceiptId:string):Promise<readonly StockMovementRecord[]>;
  listReceiptStockItems(goodsReceiptId:string):Promise<readonly StockItemRecord[]>;
  getPurchaseOrder(purchaseOrderId:string,forUpdate:boolean):Promise<PurchaseOrderRecord|null>;
  getPurchaseOrderLine(purchaseOrderLineId:string):Promise<PurchaseOrderLineMaterial|null>;
  getConfirmedQuantityForPurchaseOrderLine(purchaseOrderLineId:string):Promise<string>;
  insertSupplierPrice(input:Readonly<{tenantId:string;supplierItemId:string;unitCost:string;currency:string;effectiveAt:string;sourceEntityId:string;recordedByIdentityId:string;correlationId:string;environmentClass:InventoryEnvironmentClass}>):Promise<Readonly<{supplierPrice:SupplierPriceRecord;replayed:boolean}>>;
  listReceiptSupplierPrices(goodsReceiptId:string):Promise<readonly SupplierPriceRecord[]>;
  resolvePurchaseOrderReceivingStatus(purchaseOrderId:string):Promise<"PARTIALLY_RECEIVED"|"RECEIVED">;
  updatePurchaseOrderReceivingStatus(input:Readonly<{purchaseOrderId:string;expectedRowVersion:number;status:"PARTIALLY_RECEIVED"|"RECEIVED";updatedAt:string}>):Promise<PurchaseOrderRecord>;
}

export type InventoryReceiveDependencies=Readonly<{unitOfWork:UnitOfWork<InventoryReceiveTransaction>;now?:()=>string;environmentClass?:InventoryEnvironmentClass;faultInjector?:(point:"after_first_supplier_price")=>void|Promise<void>}>;
function validation(message:string):never{throw new AppError("VALIDATION_FAILED",message);}
function conflict(message:string):never{throw new AppError("CONFLICT",message);}
function notFound(message:string):never{throw new AppError("NOT_FOUND",message);}
function normalizeId(value:string,field:string):string{const n=value?.trim();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(n))validation(`${field} is invalid`);return n.toLowerCase();}
function normalizeKey(value:string,field:string,max=200):string{const n=value?.trim();if(!n||n.length>max)validation(`${field} is invalid`);return n;}
function normalizeReceiptNumber(value:string):string{const n=value?.trim();if(!n||n.length>120)validation("receiptNumber is invalid");return n;}
function normalizePositiveDecimal(value:string,field:string):string{const n=value?.trim();if(!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(n)||/^0(?:\.0{1,6})?$/.test(n))validation(`${field} must be a positive decimal string`);const [whole,fraction=""]=n.split(".");if(whole.length>12)validation(`${field} is too large`);return `${whole}.${fraction.padEnd(6,"0")}`;}
function decimal6(value:string):bigint{const n=value?.trim();if(!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(n))validation("Server decimal is invalid");const [whole,fraction=""]=n.split(".");if(whole.length>12)validation("Server decimal is too large");return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,"0"));}
function timestamp(value:string,field:string):string{if(!Number.isFinite(Date.parse(value)))validation(`${field} is invalid`);return new Date(value).toISOString();}
function serverNow(now?:()=>string):string{const value=(now??(()=>new Date().toISOString()))();if(!Number.isFinite(Date.parse(value)))throw new AppError("RUNTIME_CONFIGURATION_INVALID","Server clock returned invalid timestamp");return new Date(value).toISOString();}
function environment(dependencies:InventoryReceiveDependencies):InventoryEnvironmentClass{return dependencies.environmentClass??"TEST_TEMPORARY";}
function requireBaseEntitlement(context:SecurityContext):void{if(!context.entitlements.includes(RISTOAIREN_ENTITLEMENT))throw new AppError("ENTITLEMENT_REQUIRED",`Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);}
function requireProcurementEntitlements(context:SecurityContext):void{for(const entitlement of [RISTOAIREN_ENTITLEMENT,PROCUREMENT_ENTITLEMENT,INVENTORY_ENTITLEMENT])if(!context.entitlements.includes(entitlement))throw new AppError("ENTITLEMENT_REQUIRED",`Missing entitlement: ${entitlement}`);}
function requireLocationAuthority(context:SecurityContext):void{const tenantWide=context.permissions.includes("tenant.location.all");const platformOverride=context.platformPermissions.includes("platform.override_tenant_scope");if(!context.locationMembershipId&&!tenantWide&&!platformOverride)throw new AppError("LOCATION_MEMBERSHIP_REQUIRED","Authorized Location scope is required for inventory receiving");}
function authority(context:SecurityContext,permission:string):void{requireBaseEntitlement(context);requireLocationAuthority(context);requirePermission(context,permission,{tenantId:context.tenantId,locationId:context.locationId});}
function procurementAuthority(context:SecurityContext,permission:string):void{requireProcurementEntitlements(context);requireLocationAuthority(context);requirePermission(context,permission,{tenantId:context.tenantId,locationId:context.locationId});}
function audit(context:SecurityContext,actionKey:string,resourceType:string,resourceId:string,metadata:Readonly<Record<string,unknown>>):AuditRecord{return Object.freeze({actorIdentityId:context.actorIdentityId,tenantId:context.tenantId,locationId:context.locationId,actionKey,resourceType,resourceId,correlationId:context.correlationId,outcome:"success",metadata});}
function receivable(status:PurchaseOrderStatus):boolean{return status==="APPROVED"||status==="SENT"||status==="PARTIALLY_RECEIVED";}
export function receiptMovementIdempotencyKey(receiptId:string,lineId:string):string{return `goods-receipt:${receiptId}:line:${lineId}`;}

// MAT-027 free-receipt path retained unchanged in authority and semantics.
export async function createGoodsReceipt(context:SecurityContext,rawInput:Readonly<{supplierId:string;receiptNumber:string;receivedAt?:string;idempotencyKey:string}>,dependencies:InventoryReceiveDependencies):Promise<Readonly<{receipt:GoodsReceiptRecord;replayed:boolean}>>{
  authority(context,GOODS_RECEIPT_CREATE_PERMISSION);
  const supplierId=normalizeId(rawInput.supplierId,"supplierId"),receiptNumber=normalizeReceiptNumber(rawInput.receiptNumber),sourceRequestKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey");
  const explicitReceivedAt=rawInput.receivedAt?timestamp(rawInput.receivedAt,"receivedAt"):undefined,receivedAt=explicitReceivedAt??serverNow(dependencies.now);
  return dependencies.unitOfWork.transaction(async tx=>{
    const existing=await tx.findReceiptByRequestKey(sourceRequestKey);
    if(existing){if(existing.purchaseOrderId||existing.supplierId!==supplierId||existing.receiptNumber!==receiptNumber||(explicitReceivedAt!==undefined&&existing.receivedAt!==explicitReceivedAt))conflict("GoodsReceipt idempotency key was already used with different input");return Object.freeze({receipt:existing,replayed:true});}
    const supplier=await tx.getSupplier(supplierId);if(!supplier||!supplier.active)notFound("Active Supplier not found in Tenant scope");
    const receipt=await tx.insertReceipt(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,supplierId,receiptNumber,receivedAt,receivedByIdentityId:context.actorIdentityId,sourceRequestKey,environmentClass:environment(dependencies)}));
    await tx.audit(audit(context,GOODS_RECEIPT_CREATED_ACTION,"GoodsReceipt",receipt.id,Object.freeze({supplierId,receiptNumber,source:"FREE_RECEIPT"})));
    return Object.freeze({receipt,replayed:false});
  },context);
}

export async function recordGoodsReceiptLine(context:SecurityContext,rawInput:Readonly<{goodsReceiptId:string;ingredientId:string;uomId:string;quantityReceived:string;idempotencyKey:string}>,dependencies:InventoryReceiveDependencies):Promise<Readonly<{line:GoodsReceiptLineRecord;replayed:boolean}>>{
  authority(context,GOODS_RECEIPT_CREATE_PERMISSION);
  const goodsReceiptId=normalizeId(rawInput.goodsReceiptId,"goodsReceiptId"),ingredientId=normalizeId(rawInput.ingredientId,"ingredientId"),uomId=normalizeId(rawInput.uomId,"uomId"),quantityReceived=normalizePositiveDecimal(rawInput.quantityReceived,"quantityReceived"),sourceLineKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey");
  return dependencies.unitOfWork.transaction(async tx=>{
    const receipt=await tx.getReceiptForLine(goodsReceiptId);if(!receipt)notFound("GoodsReceipt not found");if(receipt.purchaseOrderId)conflict("PO-backed GoodsReceipt requires the procurement line command");if(receipt.status!=="DRAFT")conflict("Only DRAFT GoodsReceipt can accept lines");
    const existing=await tx.findLineByRequestKey(goodsReceiptId,sourceLineKey);if(existing){if(existing.purchaseOrderLineId||existing.ingredientId!==ingredientId||existing.uomId!==uomId||existing.quantityReceived!==quantityReceived)conflict("GoodsReceiptLine idempotency key was already used with different input");return Object.freeze({line:existing,replayed:true});}
    const ingredient=await tx.getIngredient(ingredientId);if(!ingredient||!ingredient.active)notFound("Active Ingredient not found in Tenant scope");if(!(await tx.uomExists(uomId)))notFound("UnitOfMeasure not found in Tenant scope");if(ingredient.baseUomId!==uomId)conflict("MAT-027 receipt baseline requires Ingredient base UOM");
    const line=await tx.insertLine(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,goodsReceiptId,ingredientId,uomId,quantityReceived,sourceLineKey,environmentClass:receipt.environmentClass}));
    await tx.audit(audit(context,GOODS_RECEIPT_LINE_RECORDED_ACTION,"GoodsReceiptLine",line.id,Object.freeze({goodsReceiptId,ingredientId,quantityReceived,uomId,source:"FREE_RECEIPT"})));
    return Object.freeze({line,replayed:false});
  },context);
}

export async function finalizeGoodsReceipt(context:SecurityContext,rawInput:Readonly<{goodsReceiptId:string;expectedRowVersion:number}>,dependencies:InventoryReceiveDependencies):Promise<Readonly<{receipt:GoodsReceiptRecord;movements:readonly StockMovementRecord[];stockItems:readonly StockItemRecord[];replayed:boolean}>>{
  authority(context,GOODS_RECEIPT_CONFIRM_PERMISSION);
  const goodsReceiptId=normalizeId(rawInput.goodsReceiptId,"goodsReceiptId");if(!Number.isInteger(rawInput.expectedRowVersion)||rawInput.expectedRowVersion<1)validation("expectedRowVersion is invalid");const now=serverNow(dependencies.now);
  return dependencies.unitOfWork.transaction(async tx=>{
    const receipt=await tx.getReceiptForFinalize(goodsReceiptId);if(!receipt)notFound("GoodsReceipt not found");if(receipt.purchaseOrderId)conflict("PO-backed GoodsReceipt requires the procurement finalize command");
    if(receipt.status==="CONFIRMED")return Object.freeze({receipt,movements:Object.freeze([...(await tx.listReceiptMovements(goodsReceiptId))]),stockItems:Object.freeze([...(await tx.listReceiptStockItems(goodsReceiptId))]),replayed:true});
    if(receipt.rowVersion!==rawInput.expectedRowVersion)conflict("GoodsReceipt row_version is stale");const lines=await tx.listReceiptLines(goodsReceiptId);if(!lines.length)conflict("GoodsReceipt requires at least one line before finalize");
    const confirmed=await tx.confirmReceipt(Object.freeze({goodsReceiptId,expectedRowVersion:rawInput.expectedRowVersion,confirmedAt:now,confirmedByIdentityId:context.actorIdentityId}));
    const movements:StockMovementRecord[]=[];for(const line of lines){const posted=await tx.insertReceiptMovement(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,line,occurredAt:receipt.receivedAt,postedAt:now,postedByIdentityId:context.actorIdentityId,idempotencyKey:receiptMovementIdempotencyKey(goodsReceiptId,line.id),correlationId:context.correlationId,environmentClass:receipt.environmentClass}));movements.push(posted.movement);}
    const stockItems=await tx.listReceiptStockItems(goodsReceiptId);await tx.audit(audit(context,GOODS_RECEIPT_FINALIZED_ACTION,"GoodsReceipt",confirmed.id,Object.freeze({movementCount:movements.length,movementIds:movements.map(m=>m.id),source:"FREE_RECEIPT"})));
    return Object.freeze({receipt:confirmed,movements:Object.freeze(movements),stockItems:Object.freeze([...stockItems]),replayed:false});
  },context);
}

export async function createPurchaseOrderGoodsReceipt(context:SecurityContext,rawInput:Readonly<{purchaseOrderId:string;receiptNumber:string;receivedAt?:string;idempotencyKey:string}>,dependencies:InventoryReceiveDependencies):Promise<Readonly<{receipt:GoodsReceiptRecord;purchaseOrder:PurchaseOrderRecord;replayed:boolean}>>{
  procurementAuthority(context,GOODS_RECEIPT_CREATE_PERMISSION);
  const purchaseOrderId=normalizeId(rawInput.purchaseOrderId,"purchaseOrderId"),receiptNumber=normalizeReceiptNumber(rawInput.receiptNumber),sourceRequestKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey");
  const explicitReceivedAt=rawInput.receivedAt?timestamp(rawInput.receivedAt,"receivedAt"):undefined,receivedAt=explicitReceivedAt??serverNow(dependencies.now);
  return dependencies.unitOfWork.transaction(async tx=>{
    const existing=await tx.findReceiptByRequestKey(sourceRequestKey);
    if(existing){if(existing.purchaseOrderId!==purchaseOrderId||existing.receiptNumber!==receiptNumber||(explicitReceivedAt!==undefined&&existing.receivedAt!==explicitReceivedAt))conflict("GoodsReceipt idempotency key was already used with different input");const purchaseOrder=await tx.getPurchaseOrder(purchaseOrderId,false);if(!purchaseOrder)notFound("PurchaseOrder not found");return Object.freeze({receipt:existing,purchaseOrder,replayed:true});}
    const purchaseOrder=await tx.getPurchaseOrder(purchaseOrderId,false);if(!purchaseOrder)notFound("PurchaseOrder not found");if(!receivable(purchaseOrder.status))conflict("PurchaseOrder is not receivable");
    const receipt=await tx.insertReceipt(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,supplierId:purchaseOrder.supplierId,purchaseOrderId:purchaseOrder.id,receiptNumber,receivedAt,receivedByIdentityId:context.actorIdentityId,sourceRequestKey,environmentClass:environment(dependencies)}));
    await tx.audit(audit(context,GOODS_RECEIPT_CREATED_ACTION,"GoodsReceipt",receipt.id,Object.freeze({purchaseOrderId:purchaseOrder.id,supplierId:purchaseOrder.supplierId,receiptNumber,source:"PURCHASE_ORDER"})));
    return Object.freeze({receipt,purchaseOrder,replayed:false});
  },context);
}

export async function recordPurchaseOrderGoodsReceiptLine(context:SecurityContext,rawInput:Readonly<{goodsReceiptId:string;purchaseOrderLineId:string;quantityReceived:string;unitCostActual:string;idempotencyKey:string}>,dependencies:InventoryReceiveDependencies):Promise<Readonly<{line:GoodsReceiptLineRecord;purchaseOrderLine:PurchaseOrderLineMaterial;replayed:boolean}>>{
  procurementAuthority(context,GOODS_RECEIPT_CREATE_PERMISSION);
  const goodsReceiptId=normalizeId(rawInput.goodsReceiptId,"goodsReceiptId"),purchaseOrderLineId=normalizeId(rawInput.purchaseOrderLineId,"purchaseOrderLineId"),quantityReceived=normalizePositiveDecimal(rawInput.quantityReceived,"quantityReceived"),unitCostActual=normalizePositiveDecimal(rawInput.unitCostActual,"unitCostActual"),sourceLineKey=normalizeKey(rawInput.idempotencyKey,"idempotencyKey");
  return dependencies.unitOfWork.transaction(async tx=>{
    const receipt=await tx.getReceiptForLine(goodsReceiptId);if(!receipt)notFound("GoodsReceipt not found");if(!receipt.purchaseOrderId)conflict("GoodsReceipt is not PurchaseOrder-backed");if(receipt.status!=="DRAFT")conflict("Only DRAFT GoodsReceipt can accept lines");
    const existing=await tx.findLineByRequestKey(goodsReceiptId,sourceLineKey);const material=await tx.getPurchaseOrderLine(purchaseOrderLineId);if(!material)notFound("PurchaseOrderLine not found");
    if(existing){if(existing.purchaseOrderLineId!==purchaseOrderLineId||existing.quantityReceived!==quantityReceived||existing.unitCostActual!==unitCostActual)conflict("GoodsReceiptLine idempotency key was already used with different input");return Object.freeze({line:existing,purchaseOrderLine:material,replayed:true});}
    if(material.purchaseOrderId!==receipt.purchaseOrderId||material.supplierId!==receipt.supplierId||!material.supplierItemActive)conflict("PurchaseOrderLine does not belong to the receipt authority");
    const purchaseOrder=await tx.getPurchaseOrder(receipt.purchaseOrderId,false);if(!purchaseOrder||!receivable(purchaseOrder.status))conflict("PurchaseOrder is not receivable");
    const alreadyConfirmed=await tx.getConfirmedQuantityForPurchaseOrderLine(purchaseOrderLineId);if(decimal6(alreadyConfirmed)+decimal6(quantityReceived)>decimal6(material.quantityOrdered))conflict("PurchaseOrder quantity would be over-received");
    const line=await tx.insertLine(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,goodsReceiptId,ingredientId:material.ingredientId,uomId:material.uomId,quantityReceived,purchaseOrderLineId:material.id,unitCostActual,sourceLineKey,environmentClass:receipt.environmentClass}));
    await tx.audit(audit(context,GOODS_RECEIPT_LINE_RECORDED_ACTION,"GoodsReceiptLine",line.id,Object.freeze({goodsReceiptId,purchaseOrderId:receipt.purchaseOrderId,purchaseOrderLineId:material.id,supplierItemId:material.supplierItemId,ingredientId:material.ingredientId,uomId:material.uomId,quantityReceived,unitCostActual,source:"PURCHASE_ORDER"})));
    return Object.freeze({line,purchaseOrderLine:material,replayed:false});
  },context);
}

export async function finalizePurchaseOrderGoodsReceipt(context:SecurityContext,rawInput:Readonly<{goodsReceiptId:string;expectedRowVersion:number}>,dependencies:InventoryReceiveDependencies):Promise<Readonly<{receipt:GoodsReceiptRecord;purchaseOrder:PurchaseOrderRecord;supplierPrices:readonly SupplierPriceRecord[];movements:readonly StockMovementRecord[];stockItems:readonly StockItemRecord[];replayed:boolean}>>{
  procurementAuthority(context,GOODS_RECEIPT_CONFIRM_PERMISSION);
  const goodsReceiptId=normalizeId(rawInput.goodsReceiptId,"goodsReceiptId");if(!Number.isInteger(rawInput.expectedRowVersion)||rawInput.expectedRowVersion<1)validation("expectedRowVersion is invalid");const now=serverNow(dependencies.now);
  return dependencies.unitOfWork.transaction(async tx=>{
    const receipt=await tx.getReceiptForFinalize(goodsReceiptId);if(!receipt)notFound("GoodsReceipt not found");if(!receipt.purchaseOrderId)conflict("GoodsReceipt is not PurchaseOrder-backed");
    const purchaseOrder=await tx.getPurchaseOrder(receipt.purchaseOrderId,true);if(!purchaseOrder)notFound("PurchaseOrder not found");
    if(receipt.status==="CONFIRMED")return Object.freeze({receipt,purchaseOrder,supplierPrices:Object.freeze([...(await tx.listReceiptSupplierPrices(goodsReceiptId))]),movements:Object.freeze([...(await tx.listReceiptMovements(goodsReceiptId))]),stockItems:Object.freeze([...(await tx.listReceiptStockItems(goodsReceiptId))]),replayed:true});
    if(!receivable(purchaseOrder.status)||purchaseOrder.supplierId!==receipt.supplierId)conflict("PurchaseOrder is not receivable");if(receipt.rowVersion!==rawInput.expectedRowVersion)conflict("GoodsReceipt row_version is stale");
    const lines=await tx.listReceiptLines(goodsReceiptId);if(!lines.length)conflict("GoodsReceipt requires at least one line before finalize");
    const materials=new Map<string,PurchaseOrderLineMaterial>();
    for(const line of lines){if(!line.purchaseOrderLineId||!line.unitCostActual)conflict("PO-backed GoodsReceipt contains an invalid line");const material=await tx.getPurchaseOrderLine(line.purchaseOrderLineId);if(!material||material.purchaseOrderId!==purchaseOrder.id||material.supplierId!==purchaseOrder.supplierId||material.ingredientId!==line.ingredientId||material.uomId!==line.uomId||!material.supplierItemActive)conflict("GoodsReceiptLine PurchaseOrder authority mismatch");const alreadyConfirmed=await tx.getConfirmedQuantityForPurchaseOrderLine(material.id);if(decimal6(alreadyConfirmed)+decimal6(line.quantityReceived)>decimal6(material.quantityOrdered))conflict("PurchaseOrder quantity would be over-received");materials.set(line.id,material);}
    const confirmed=await tx.confirmReceipt(Object.freeze({goodsReceiptId,expectedRowVersion:rawInput.expectedRowVersion,confirmedAt:now,confirmedByIdentityId:context.actorIdentityId}));
    const supplierPrices:SupplierPriceRecord[]=[];let injected=false;
    for(const line of lines){const material=materials.get(line.id)!;const price=await tx.insertSupplierPrice(Object.freeze({tenantId:context.tenantId,supplierItemId:material.supplierItemId,unitCost:line.unitCostActual!,currency:purchaseOrder.currency,effectiveAt:receipt.receivedAt,sourceEntityId:line.id,recordedByIdentityId:context.actorIdentityId,correlationId:context.correlationId,environmentClass:receipt.environmentClass}));supplierPrices.push(price.supplierPrice);if(!injected&&dependencies.faultInjector){injected=true;await dependencies.faultInjector("after_first_supplier_price");}}
    const movements:StockMovementRecord[]=[];for(const line of lines){const posted=await tx.insertReceiptMovement(Object.freeze({tenantId:context.tenantId,locationId:context.locationId,line,occurredAt:receipt.receivedAt,postedAt:now,postedByIdentityId:context.actorIdentityId,idempotencyKey:receiptMovementIdempotencyKey(goodsReceiptId,line.id),correlationId:context.correlationId,environmentClass:receipt.environmentClass}));movements.push(posted.movement);}
    const nextStatus=await tx.resolvePurchaseOrderReceivingStatus(purchaseOrder.id);const updatedPurchaseOrder=await tx.updatePurchaseOrderReceivingStatus(Object.freeze({purchaseOrderId:purchaseOrder.id,expectedRowVersion:purchaseOrder.rowVersion,status:nextStatus,updatedAt:now}));
    const stockItems=await tx.listReceiptStockItems(goodsReceiptId);await tx.audit(audit(context,GOODS_RECEIPT_FINALIZED_ACTION,"GoodsReceipt",confirmed.id,Object.freeze({purchaseOrderId:purchaseOrder.id,purchaseOrderStatus:updatedPurchaseOrder.status,supplierPriceIds:supplierPrices.map(p=>p.id),movementIds:movements.map(m=>m.id),lineCount:lines.length,source:"PURCHASE_ORDER"})));
    return Object.freeze({receipt:confirmed,purchaseOrder:updatedPurchaseOrder,supplierPrices:Object.freeze(supplierPrices),movements:Object.freeze(movements),stockItems:Object.freeze([...stockItems]),replayed:false});
  },context);
}
