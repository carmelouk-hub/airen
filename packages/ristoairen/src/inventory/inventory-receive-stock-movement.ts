import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const GOODS_RECEIPT_CREATE_PERMISSION = "procurement.goods_receipt.create";
export const GOODS_RECEIPT_CONFIRM_PERMISSION = "procurement.goods_receipt.confirm";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const GOODS_RECEIPT_CREATED_ACTION = "GOODS_RECEIPT_CREATED";
export const GOODS_RECEIPT_LINE_RECORDED_ACTION = "GOODS_RECEIPT_LINE_RECORDED";
export const GOODS_RECEIPT_FINALIZED_ACTION = "GOODS_RECEIPT_FINALIZED";

export type GoodsReceiptStatus = "DRAFT" | "CONFIRMED";
export type InventoryEnvironmentClass = "DEMO" | "SANDBOX" | "TEST_TEMPORARY";

export type GoodsReceiptRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  supplierId: string;
  receiptNumber: string;
  receivedAt: string;
  receivedByIdentityId: string;
  status: GoodsReceiptStatus;
  sourceRequestKey: string;
  rowVersion: number;
  environmentClass: InventoryEnvironmentClass;
  confirmedAt?: string;
  confirmedByIdentityId?: string;
}>;

export type GoodsReceiptLineRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  goodsReceiptId: string;
  ingredientId: string;
  uomId: string;
  quantityReceived: string;
  rejectedQuantity: string;
  sourceLineKey: string;
  rowVersion: number;
  environmentClass: InventoryEnvironmentClass;
}>;

export type IngredientMaterial = Readonly<{
  id: string;
  tenantId: string;
  baseUomId: string;
  active: boolean;
}>;

export type StockMovementRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  ingredientId: string;
  movementType: "RECEIPT";
  quantityDelta: string;
  uomId: string;
  sourceEntityId: string;
  idempotencyKey: string;
  occurredAt: string;
  postedAt: string;
}>;

export type StockItemRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  ingredientId: string;
  onHandQuantity: string;
  baseUomId: string;
  lastMovementAt?: string;
}>;

export interface InventoryReceiveTransaction extends TransactionContext {
  getSupplier(supplierId: string): Promise<Readonly<{ id: string; active: boolean }> | null>;
  findReceiptByRequestKey(sourceRequestKey: string): Promise<GoodsReceiptRecord | null>;
  insertReceipt(input: Readonly<{
    tenantId: string;
    locationId: string;
    supplierId: string;
    receiptNumber: string;
    receivedAt: string;
    receivedByIdentityId: string;
    sourceRequestKey: string;
    environmentClass: InventoryEnvironmentClass;
  }>): Promise<GoodsReceiptRecord>;
  getReceiptForLine(goodsReceiptId: string): Promise<GoodsReceiptRecord | null>;
  getIngredient(ingredientId: string): Promise<IngredientMaterial | null>;
  uomExists(uomId: string): Promise<boolean>;
  findLineByRequestKey(goodsReceiptId: string, sourceLineKey: string): Promise<GoodsReceiptLineRecord | null>;
  insertLine(input: Readonly<{
    tenantId: string;
    locationId: string;
    goodsReceiptId: string;
    ingredientId: string;
    uomId: string;
    quantityReceived: string;
    sourceLineKey: string;
    environmentClass: InventoryEnvironmentClass;
  }>): Promise<GoodsReceiptLineRecord>;
  getReceiptForFinalize(goodsReceiptId: string): Promise<GoodsReceiptRecord | null>;
  listReceiptLines(goodsReceiptId: string): Promise<readonly GoodsReceiptLineRecord[]>;
  confirmReceipt(input: Readonly<{
    goodsReceiptId: string;
    expectedRowVersion: number;
    confirmedAt: string;
    confirmedByIdentityId: string;
  }>): Promise<GoodsReceiptRecord>;
  insertReceiptMovement(input: Readonly<{
    tenantId: string;
    locationId: string;
    line: GoodsReceiptLineRecord;
    occurredAt: string;
    postedAt: string;
    postedByIdentityId: string;
    idempotencyKey: string;
    correlationId: string;
    environmentClass: InventoryEnvironmentClass;
  }>): Promise<Readonly<{ movement: StockMovementRecord; replayed: boolean }>>;
  listReceiptMovements(goodsReceiptId: string): Promise<readonly StockMovementRecord[]>;
  listReceiptStockItems(goodsReceiptId: string): Promise<readonly StockItemRecord[]>;
}

export type InventoryReceiveDependencies = Readonly<{
  unitOfWork: UnitOfWork<InventoryReceiveTransaction>;
  now?: () => string;
  environmentClass?: InventoryEnvironmentClass;
}>;

function validation(message: string): never { throw new AppError("VALIDATION_FAILED", message); }
function conflict(message: string): never { throw new AppError("CONFLICT", message); }
function notFound(message: string): never { throw new AppError("NOT_FOUND", message); }

function normalizeId(value: string, field: string): string {
  const normalized = value?.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) validation(`${field} is invalid`);
  return normalized.toLowerCase();
}

function normalizeKey(value: string, field: string, max = 200): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max) validation(`${field} is invalid`);
  return normalized;
}

function normalizeReceiptNumber(value: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 120) validation("receiptNumber is invalid");
  return normalized;
}

function normalizePositiveDecimal(value: string, field: string): string {
  const normalized = value?.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized) || /^0(?:\.0{1,6})?$/.test(normalized)) validation(`${field} must be a positive decimal string`);
  const [whole, fraction = ""] = normalized.split(".");
  if (whole.length > 12) validation(`${field} is too large`);
  return `${whole}.${fraction.padEnd(6,"0")}`;
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) validation(`${field} is invalid`);
  return new Date(value).toISOString();
}

function serverNow(now?: () => string): string {
  const value = (now ?? (() => new Date().toISOString()))();
  if (!Number.isFinite(Date.parse(value))) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Server clock returned invalid timestamp");
  return new Date(value).toISOString();
}

function environment(dependencies: InventoryReceiveDependencies): InventoryEnvironmentClass {
  return dependencies.environmentClass ?? "TEST_TEMPORARY";
}

function requireEntitlement(context: SecurityContext): void {
  if (!context.entitlements.includes(RISTOAIREN_ENTITLEMENT)) throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);
}

function requireLocationAuthority(context: SecurityContext): void {
  const tenantWide = context.permissions.includes("tenant.location.all");
  const platformOverride = context.platformPermissions.includes("platform.override_tenant_scope");
  if (!context.locationMembershipId && !tenantWide && !platformOverride) throw new AppError("LOCATION_MEMBERSHIP_REQUIRED", "Authorized Location scope is required for inventory receiving");
}

function authority(context: SecurityContext, permission: string): void {
  requireEntitlement(context);
  requireLocationAuthority(context);
  requirePermission(context, permission, { tenantId: context.tenantId, locationId: context.locationId });
}

function audit(context: SecurityContext, actionKey: string, resourceType: string, resourceId: string, metadata: Readonly<Record<string, unknown>>): AuditRecord {
  return Object.freeze({
    actorIdentityId: context.actorIdentityId,
    tenantId: context.tenantId,
    locationId: context.locationId,
    actionKey,
    resourceType,
    resourceId,
    correlationId: context.correlationId,
    outcome: "success",
    metadata
  });
}

export function receiptMovementIdempotencyKey(receiptId: string, lineId: string): string {
  return `goods-receipt:${receiptId}:line:${lineId}`;
}

export async function createGoodsReceipt(
  context: SecurityContext,
  rawInput: Readonly<{ supplierId: string; receiptNumber: string; receivedAt?: string; idempotencyKey: string }>,
  dependencies: InventoryReceiveDependencies
): Promise<Readonly<{ receipt: GoodsReceiptRecord; replayed: boolean }>> {
  authority(context, GOODS_RECEIPT_CREATE_PERMISSION);
  const supplierId = normalizeId(rawInput.supplierId,"supplierId");
  const receiptNumber = normalizeReceiptNumber(rawInput.receiptNumber);
  const sourceRequestKey = normalizeKey(rawInput.idempotencyKey,"idempotencyKey");
  const receivedAt = rawInput.receivedAt ? timestamp(rawInput.receivedAt,"receivedAt") : serverNow(dependencies.now);

  return dependencies.unitOfWork.transaction(async tx => {
    const existing = await tx.findReceiptByRequestKey(sourceRequestKey);
    if (existing) return Object.freeze({ receipt: existing, replayed: true });
    const supplier = await tx.getSupplier(supplierId);
    if (!supplier || !supplier.active) notFound("Active Supplier not found in Tenant scope");
    const receipt = await tx.insertReceipt(Object.freeze({
      tenantId: context.tenantId, locationId: context.locationId, supplierId, receiptNumber, receivedAt,
      receivedByIdentityId: context.actorIdentityId, sourceRequestKey, environmentClass: environment(dependencies)
    }));
    await tx.audit(audit(context,GOODS_RECEIPT_CREATED_ACTION,"GoodsReceipt",receipt.id,Object.freeze({ supplierId, receiptNumber })));
    return Object.freeze({ receipt, replayed: false });
  },context);
}

export async function recordGoodsReceiptLine(
  context: SecurityContext,
  rawInput: Readonly<{ goodsReceiptId: string; ingredientId: string; uomId: string; quantityReceived: string; idempotencyKey: string }>,
  dependencies: InventoryReceiveDependencies
): Promise<Readonly<{ line: GoodsReceiptLineRecord; replayed: boolean }>> {
  authority(context, GOODS_RECEIPT_CREATE_PERMISSION);
  const goodsReceiptId = normalizeId(rawInput.goodsReceiptId,"goodsReceiptId");
  const ingredientId = normalizeId(rawInput.ingredientId,"ingredientId");
  const uomId = normalizeId(rawInput.uomId,"uomId");
  const quantityReceived = normalizePositiveDecimal(rawInput.quantityReceived,"quantityReceived");
  const sourceLineKey = normalizeKey(rawInput.idempotencyKey,"idempotencyKey");

  return dependencies.unitOfWork.transaction(async tx => {
    const receipt = await tx.getReceiptForLine(goodsReceiptId);
    if (!receipt) notFound("GoodsReceipt not found");
    if (receipt.status !== "DRAFT") conflict("Only DRAFT GoodsReceipt can accept lines");
    const existing = await tx.findLineByRequestKey(goodsReceiptId,sourceLineKey);
    if (existing) return Object.freeze({ line: existing, replayed: true });
    const ingredient = await tx.getIngredient(ingredientId);
    if (!ingredient || !ingredient.active) notFound("Active Ingredient not found in Tenant scope");
    if (!(await tx.uomExists(uomId))) notFound("UnitOfMeasure not found in Tenant scope");
    if (ingredient.baseUomId !== uomId) conflict("MAT-027 receipt baseline requires Ingredient base UOM");
    const line = await tx.insertLine(Object.freeze({
      tenantId: context.tenantId, locationId: context.locationId, goodsReceiptId, ingredientId, uomId,
      quantityReceived, sourceLineKey, environmentClass: receipt.environmentClass
    }));
    await tx.audit(audit(context,GOODS_RECEIPT_LINE_RECORDED_ACTION,"GoodsReceiptLine",line.id,Object.freeze({ goodsReceiptId, ingredientId, quantityReceived, uomId })));
    return Object.freeze({ line, replayed: false });
  },context);
}

export async function finalizeGoodsReceipt(
  context: SecurityContext,
  rawInput: Readonly<{ goodsReceiptId: string; expectedRowVersion: number }>,
  dependencies: InventoryReceiveDependencies
): Promise<Readonly<{
  receipt: GoodsReceiptRecord;
  movements: readonly StockMovementRecord[];
  stockItems: readonly StockItemRecord[];
  replayed: boolean;
}>> {
  authority(context, GOODS_RECEIPT_CONFIRM_PERMISSION);
  const goodsReceiptId = normalizeId(rawInput.goodsReceiptId,"goodsReceiptId");
  if (!Number.isInteger(rawInput.expectedRowVersion) || rawInput.expectedRowVersion < 1) validation("expectedRowVersion is invalid");
  const now = serverNow(dependencies.now);

  return dependencies.unitOfWork.transaction(async tx => {
    const receipt = await tx.getReceiptForFinalize(goodsReceiptId);
    if (!receipt) notFound("GoodsReceipt not found");
    if (receipt.status === "CONFIRMED") {
      return Object.freeze({
        receipt,
        movements: Object.freeze([...(await tx.listReceiptMovements(goodsReceiptId))]),
        stockItems: Object.freeze([...(await tx.listReceiptStockItems(goodsReceiptId))]),
        replayed: true
      });
    }
    if (receipt.rowVersion !== rawInput.expectedRowVersion) conflict("GoodsReceipt row_version is stale");
    const lines = await tx.listReceiptLines(goodsReceiptId);
    if (!lines.length) conflict("GoodsReceipt requires at least one line before finalize");

    const confirmed = await tx.confirmReceipt(Object.freeze({
      goodsReceiptId, expectedRowVersion: rawInput.expectedRowVersion, confirmedAt: now,
      confirmedByIdentityId: context.actorIdentityId
    }));
    const movements: StockMovementRecord[] = [];
    for (const line of lines) {
      const posted = await tx.insertReceiptMovement(Object.freeze({
        tenantId: context.tenantId,
        locationId: context.locationId,
        line,
        occurredAt: receipt.receivedAt,
        postedAt: now,
        postedByIdentityId: context.actorIdentityId,
        idempotencyKey: receiptMovementIdempotencyKey(goodsReceiptId,line.id),
        correlationId: context.correlationId,
        environmentClass: receipt.environmentClass
      }));
      movements.push(posted.movement);
    }
    const stockItems = await tx.listReceiptStockItems(goodsReceiptId);
    await tx.audit(audit(context,GOODS_RECEIPT_FINALIZED_ACTION,"GoodsReceipt",confirmed.id,Object.freeze({
      movementCount: movements.length,
      movementIds: movements.map(movement => movement.id),
      source: "GoodsReceipt"
    })));
    return Object.freeze({ receipt: confirmed, movements: Object.freeze(movements), stockItems: Object.freeze([...stockItems]), replayed: false });
  },context);
}
