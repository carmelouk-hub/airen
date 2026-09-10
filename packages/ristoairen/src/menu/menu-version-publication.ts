import { createHash } from "node:crypto";
import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const MENU_CREATE_PERMISSION = "menu.create";
export const MENU_UPDATE_PERMISSION = "menu.update";
export const MENU_PUBLISH_PERMISSION = "menu.publish";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const MENU_VERSION_CREATED_ACTION = "MENU_VERSION_CREATED";
export const MENU_VERSION_VALIDATED_ACTION = "MENU_VERSION_VALIDATED";
export const MENU_VERSION_PUBLISHED_ACTION = "MENU_VERSION_PUBLISHED";

export type MenuChannel = "PUBLIC_WEB" | "QR" | "STAFF" | "POS" | "FAST" | "SELF";
export type MenuVersionStatus = "DRAFT" | "VALIDATED" | "PUBLISHED" | "RETIRED";
export type MenuPublicationStatus = "SCHEDULED" | "ACTIVE" | "ENDED" | "REVOKED";

export type MenuRecord = Readonly<{
  id: string;
  tenantId: string;
  code: string;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  defaultCurrency: string;
  environmentClass: string;
}>;

export type MenuVersionRecord = Readonly<{
  id: string;
  tenantId: string;
  menuId: string;
  versionNumber: number;
  label?: string;
  status: MenuVersionStatus;
  contentHash?: string;
  sourceRequestKey: string;
  rowVersion: number;
  environmentClass: string;
  validatedAt?: string;
  publishedAt?: string;
}>;

export type MenuPublicationRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  menuId: string;
  menuVersionId: string;
  channel: MenuChannel;
  status: MenuPublicationStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  rowVersion: number;
}>;

export type CanonicalMenuCategory = Readonly<{
  id: string;
  code: string;
  name: string;
  publicLabel?: string;
  sortOrder: number;
  active: boolean;
}>;

export type CanonicalMenuItem = Readonly<{
  id: string;
  categoryId: string;
  code: string;
  name: string;
  description?: string;
  basePriceAmount: string;
  basePriceCurrency: string;
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
  sortOrder: number;
  allergenSummarySanitized?: string;
}>;

export type CanonicalMenuContent = Readonly<{
  categories: readonly CanonicalMenuCategory[];
  items: readonly CanonicalMenuItem[];
}>;

export type PublicMenuItem = Readonly<{
  id: string;
  code: string;
  name: string;
  description?: string;
  amount: string;
  currency: string;
  sortOrder: number;
  allergenSummarySanitized?: string;
}>;

export type PublicMenuCategory = Readonly<{
  id: string;
  code: string;
  name: string;
  publicLabel?: string;
  sortOrder: number;
  items: readonly PublicMenuItem[];
}>;

export type PublicMenuProjection = Readonly<{
  menuId: string;
  menuVersionId: string;
  versionNumber: number;
  contentHash: string;
  locationId: string;
  channel: MenuChannel;
  publicationId: string;
  categories: readonly PublicMenuCategory[];
}>;

export interface MenuVersionPublicationTransaction extends TransactionContext {
  getMenuForVersionCreation(menuId: string): Promise<MenuRecord | null>;
  findVersionByRequestKey(menuId: string, sourceRequestKey: string): Promise<MenuVersionRecord | null>;
  nextVersionNumber(menuId: string): Promise<number>;
  insertDraftVersion(input: Readonly<{
    tenantId: string;
    menuId: string;
    versionNumber: number;
    label?: string;
    sourceRequestKey: string;
    createdByIdentityId: string;
    environmentClass: string;
  }>): Promise<MenuVersionRecord>;
  getVersionForValidation(menuVersionId: string): Promise<MenuVersionRecord | null>;
  loadCanonicalContent(menuVersionId: string): Promise<CanonicalMenuContent>;
  markValidated(input: Readonly<{
    menuVersionId: string;
    expectedRowVersion: number;
    contentHash: string;
    validatedAt: string;
  }>): Promise<MenuVersionRecord>;
  getVersionForPublication(menuVersionId: string): Promise<MenuVersionRecord | null>;
  findPublicationForVersion(input: Readonly<{
    menuId: string;
    menuVersionId: string;
    locationId: string;
    channel: MenuChannel;
  }>): Promise<MenuPublicationRecord | null>;
  switchPublication(input: Readonly<{
    menuVersion: MenuVersionRecord;
    expectedRowVersion: number;
    locationId: string;
    channel: MenuChannel;
    effectiveFrom: string;
    effectiveTo?: string;
    now: string;
    publishedByIdentityId: string;
  }>): Promise<Readonly<{ version: MenuVersionRecord; publication: MenuPublicationRecord }>>;
}

export type MenuRuntimeDependencies = Readonly<{
  unitOfWork: UnitOfWork<MenuVersionPublicationTransaction>;
  now?: () => string;
}>;

export type PublicMenuScope = Readonly<{
  tenantId: string;
  locationId: string;
  menuId: string;
  channel: MenuChannel;
}>;

export interface PublicMenuReader {
  fetch(scope: PublicMenuScope, atIso: string): Promise<PublicMenuProjection | null>;
}

function validation(message: string): never {
  throw new AppError("VALIDATION_FAILED", message);
}

function conflict(message: string): never {
  throw new AppError("CONFLICT", message);
}

function notFound(message: string): never {
  throw new AppError("NOT_FOUND", message);
}

function normalizeId(value: string, field: string): string {
  const normalized = value?.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) validation(`${field} is invalid`);
  return normalized.toLowerCase();
}

function normalizeRequestKey(value: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 200) validation("idempotencyKey is invalid");
  return normalized;
}

function normalizeChannel(value: string): MenuChannel {
  const normalized = value?.trim().toUpperCase() as MenuChannel;
  if (!["PUBLIC_WEB","QR","STAFF","POS","FAST","SELF"].includes(normalized)) validation("channel is invalid");
  return normalized;
}

function normalizeLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) validation("label is invalid");
  return normalized;
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

function requireEntitlement(context: SecurityContext): void {
  if (!context.entitlements.includes(RISTOAIREN_ENTITLEMENT)) {
    throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);
  }
}

function requireLocationAuthority(context: SecurityContext): void {
  const tenantWide = context.permissions.includes("tenant.location.all");
  const platformOverride = context.platformPermissions.includes("platform.override_tenant_scope");
  if (!context.locationMembershipId && !tenantWide && !platformOverride) {
    throw new AppError("LOCATION_MEMBERSHIP_REQUIRED", "Authorized Location scope is required for menu publication");
  }
}

function authority(context: SecurityContext, permission: string): void {
  requireEntitlement(context);
  requirePermission(context, permission, { tenantId: context.tenantId, locationId: context.locationId });
}

function audit(context: SecurityContext, actionKey: string, resourceId: string, metadata: Readonly<Record<string, unknown>>): AuditRecord {
  return Object.freeze({
    actorIdentityId: context.actorIdentityId,
    tenantId: context.tenantId,
    locationId: context.locationId,
    actionKey,
    resourceType: "MenuVersion",
    resourceId,
    correlationId: context.correlationId,
    outcome: "success",
    metadata
  });
}

function canonicalString(content: CanonicalMenuContent): string {
  const categories = [...content.categories]
    .sort((a,b) => a.sortOrder-b.sortOrder || a.code.localeCompare(b.code) || a.id.localeCompare(b.id))
    .map(category => ({
      id: category.id,
      code: category.code,
      name: category.name,
      publicLabel: category.publicLabel ?? null,
      sortOrder: category.sortOrder,
      active: category.active
    }));
  const items = [...content.items]
    .sort((a,b) => a.sortOrder-b.sortOrder || a.code.localeCompare(b.code) || a.id.localeCompare(b.id))
    .map(item => ({
      id: item.id,
      categoryId: item.categoryId,
      code: item.code,
      name: item.name,
      description: item.description ?? null,
      basePriceAmount: item.basePriceAmount,
      basePriceCurrency: item.basePriceCurrency,
      status: item.status,
      sortOrder: item.sortOrder,
      allergenSummarySanitized: item.allergenSummarySanitized ?? null
    }));
  return JSON.stringify({ categories, items });
}

export function computeCanonicalMenuContentHash(content: CanonicalMenuContent): string {
  if (!content.categories.length) validation("MenuVersion must contain at least one category");
  if (!content.items.some(item => item.status === "ACTIVE")) validation("MenuVersion must contain at least one active item");
  const categoryIds = new Set(content.categories.map(category => category.id));
  if (categoryIds.size !== content.categories.length) validation("MenuVersion contains duplicate categories");
  const itemIds = new Set(content.items.map(item => item.id));
  if (itemIds.size !== content.items.length) validation("MenuVersion contains duplicate items");
  for (const item of content.items) {
    if (!categoryIds.has(item.categoryId)) validation("Menu item references a category outside this version");
    if (!/^\d+(?:\.\d{1,2})?$/.test(item.basePriceAmount) || Number(item.basePriceAmount) < 0) validation("Menu item price is invalid");
    if (!/^[A-Z]{3}$/.test(item.basePriceCurrency)) validation("Menu item currency is invalid");
  }
  return createHash("sha256").update(canonicalString(content)).digest("hex");
}

export async function createMenuVersion(
  context: SecurityContext,
  rawInput: Readonly<{ menuId: string; label?: string; idempotencyKey: string }>,
  dependencies: MenuRuntimeDependencies
): Promise<Readonly<{ version: MenuVersionRecord; replayed: boolean }>> {
  authority(context, MENU_CREATE_PERMISSION);
  const menuId = normalizeId(rawInput.menuId, "menuId");
  const label = normalizeLabel(rawInput.label);
  const sourceRequestKey = normalizeRequestKey(rawInput.idempotencyKey);

  return dependencies.unitOfWork.transaction(async tx => {
    const menu = await tx.getMenuForVersionCreation(menuId);
    if (!menu) notFound("Menu not found");
    if (menu.status === "ARCHIVED") conflict("Archived Menu cannot create versions");
    const existing = await tx.findVersionByRequestKey(menuId, sourceRequestKey);
    if (existing) return Object.freeze({ version: existing, replayed: true });
    const version = await tx.insertDraftVersion(Object.freeze({
      tenantId: context.tenantId,
      menuId,
      versionNumber: await tx.nextVersionNumber(menuId),
      ...(label ? { label } : {}),
      sourceRequestKey,
      createdByIdentityId: context.actorIdentityId,
      environmentClass: menu.environmentClass
    }));
    await tx.audit(audit(context, MENU_VERSION_CREATED_ACTION, version.id, Object.freeze({ menuId, versionNumber: version.versionNumber })));
    return Object.freeze({ version, replayed: false });
  }, context);
}

export async function validateMenuVersion(
  context: SecurityContext,
  rawInput: Readonly<{ menuVersionId: string; expectedRowVersion: number }>,
  dependencies: MenuRuntimeDependencies
): Promise<MenuVersionRecord> {
  authority(context, MENU_UPDATE_PERMISSION);
  const menuVersionId = normalizeId(rawInput.menuVersionId, "menuVersionId");
  if (!Number.isInteger(rawInput.expectedRowVersion) || rawInput.expectedRowVersion < 1) validation("expectedRowVersion is invalid");
  const validatedAt = serverNow(dependencies.now);

  return dependencies.unitOfWork.transaction(async tx => {
    const version = await tx.getVersionForValidation(menuVersionId);
    if (!version) notFound("MenuVersion not found");
    if (version.status !== "DRAFT") conflict("Only DRAFT MenuVersion can be validated");
    if (version.rowVersion !== rawInput.expectedRowVersion) conflict("MenuVersion row_version is stale");
    const content = await tx.loadCanonicalContent(menuVersionId);
    const contentHash = computeCanonicalMenuContentHash(content);
    const updated = await tx.markValidated(Object.freeze({
      menuVersionId,
      expectedRowVersion: rawInput.expectedRowVersion,
      contentHash,
      validatedAt
    }));
    await tx.audit(audit(context, MENU_VERSION_VALIDATED_ACTION, updated.id, Object.freeze({ menuId: updated.menuId, versionNumber: updated.versionNumber, contentHash })));
    return updated;
  }, context);
}

export async function publishMenuVersion(
  context: SecurityContext,
  rawInput: Readonly<{
    menuVersionId: string;
    expectedRowVersion: number;
    channel: MenuChannel;
    effectiveFrom?: string;
    effectiveTo?: string;
  }>,
  dependencies: MenuRuntimeDependencies
): Promise<Readonly<{ version: MenuVersionRecord; publication: MenuPublicationRecord; replayed: boolean }>> {
  authority(context, MENU_PUBLISH_PERMISSION);
  requireLocationAuthority(context);
  const menuVersionId = normalizeId(rawInput.menuVersionId, "menuVersionId");
  if (!Number.isInteger(rawInput.expectedRowVersion) || rawInput.expectedRowVersion < 1) validation("expectedRowVersion is invalid");
  const channel = normalizeChannel(rawInput.channel);
  const now = serverNow(dependencies.now);
  const effectiveFrom = rawInput.effectiveFrom ? timestamp(rawInput.effectiveFrom, "effectiveFrom") : now;
  const effectiveTo = rawInput.effectiveTo ? timestamp(rawInput.effectiveTo, "effectiveTo") : undefined;
  if (effectiveTo && Date.parse(effectiveTo) <= Date.parse(effectiveFrom)) validation("effectiveTo must be after effectiveFrom");

  return dependencies.unitOfWork.transaction(async tx => {
    const version = await tx.getVersionForPublication(menuVersionId);
    if (!version) notFound("MenuVersion not found");
    const existing = await tx.findPublicationForVersion(Object.freeze({
      menuId: version.menuId,
      menuVersionId,
      locationId: context.locationId,
      channel
    }));
    if (existing && version.status === "PUBLISHED" && (existing.status === "ACTIVE" || existing.status === "SCHEDULED")) {
      return Object.freeze({ version, publication: existing, replayed: true });
    }
    if (version.status !== "VALIDATED") conflict("Only VALIDATED MenuVersion can be published");
    if (!version.contentHash) conflict("Validated MenuVersion is missing content_hash");
    if (version.rowVersion !== rawInput.expectedRowVersion) conflict("MenuVersion row_version is stale");
    const switched = await tx.switchPublication(Object.freeze({
      menuVersion: version,
      expectedRowVersion: rawInput.expectedRowVersion,
      locationId: context.locationId,
      channel,
      effectiveFrom,
      ...(effectiveTo ? { effectiveTo } : {}),
      now,
      publishedByIdentityId: context.actorIdentityId
    }));
    await tx.audit(audit(context, MENU_VERSION_PUBLISHED_ACTION, switched.version.id, Object.freeze({
      menuId: switched.version.menuId,
      versionNumber: switched.version.versionNumber,
      publicationId: switched.publication.id,
      channel,
      locationId: context.locationId
    })));
    return Object.freeze({ ...switched, replayed: false });
  }, context);
}

/**
 * The scope passed here must come from trusted server-side tenant/location routing.
 * Browser/client identifiers are not authority. The reader enforces the same scope again through PostgreSQL RLS.
 */
export async function fetchPublicMenu(
  rawScope: PublicMenuScope,
  reader: PublicMenuReader,
  atIso: string
): Promise<PublicMenuProjection | null> {
  const scope = Object.freeze({
    tenantId: normalizeId(rawScope.tenantId, "tenantId"),
    locationId: normalizeId(rawScope.locationId, "locationId"),
    menuId: normalizeId(rawScope.menuId, "menuId"),
    channel: normalizeChannel(rawScope.channel)
  });
  return reader.fetch(scope, timestamp(atIso, "atIso"));
}
