import { createHash } from "node:crypto";
import type { DomainEvent, PlatformSecurityContext, SecurityContext } from "../../shared-contracts/src/index.ts";
import { AppError } from "../../shared-contracts/src/index.ts";

export type AuditRecord = Readonly<{ actorIdentityId: string; tenantId: string; locationId: string; actionKey: string; resourceType?: string; resourceId?: string; correlationId: string; outcome: "success" | "denied" | "failure"; metadata?: Readonly<Record<string, unknown>> }>;
export interface TransactionContext { audit(record: AuditRecord): Promise<void>; outbox(event: DomainEvent & { tenantId: string; locationId: string; correlationId: string }): Promise<void>; }
export interface UnitOfWork<TTx extends TransactionContext = TransactionContext> { transaction<T>(fn: (tx: TTx) => Promise<T>, context?: SecurityContext): Promise<T>; }
export function successAudit(context: SecurityContext, actionKey: string, resource?: { type: string; id: string }): AuditRecord { return { actorIdentityId: context.actorIdentityId, tenantId: context.tenantId, locationId: context.locationId, actionKey, resourceType: resource?.type, resourceId: resource?.id, correlationId: context.correlationId, outcome: "success" }; }

export type AuditOutcome = "success" | "denied" | "failure";

export type PlatformAuditQueryInput = Readonly<{
  createdFrom: string;
  createdUntil: string;
  tenantId?: string;
  locationId?: string;
  actorIdentityId?: string;
  actorKind?: string;
  actionKey?: string;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  outcome?: AuditOutcome;
  cursor?: string;
  limit?: number;
}>;

export type PlatformAuditQueryRow = Readonly<{
  id: string;
  tenantId?: string;
  locationId?: string;
  actorIdentityId?: string;
  actorKind: string;
  actionKey: string;
  resourceType?: string;
  resourceId?: string;
  correlationId: string;
  outcome: AuditOutcome;
  metadata: unknown;
  createdAt: string;
}>;

export type PlatformAuditQueryPage = Readonly<{
  items: readonly PlatformAuditQueryRow[];
  nextCursor?: string;
}>;

export type PlatformAuditStoreInput = Readonly<{
  createdFrom: string;
  createdUntil: string;
  tenantId?: string;
  locationId?: string;
  actorIdentityId?: string;
  actorKind?: string;
  actionKey?: string;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  outcome?: AuditOutcome;
  cursorCreatedAt?: string;
  cursorId?: string;
  limit: number;
}>;

export interface PlatformAuditQueryStore {
  queryPlatformAudit(input: PlatformAuditStoreInput, context: PlatformSecurityContext): Promise<readonly PlatformAuditQueryRow[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

function validation(message: string): never { throw new AppError("VALIDATION_FAILED", message); }
function uuid(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const v=value.trim();
  if (!UUID_RE.test(v)) validation(`${field} must be a UUID`);
  return v.toLowerCase();
}
function bounded(value: string | undefined, field: string, max: number, normalizeLower=false): string | undefined {
  if (value === undefined) return undefined;
  const v=value.trim();
  if (!v || v.length > max) validation(`${field} is invalid`);
  return normalizeLower ? v.toLowerCase() : v;
}
function iso(value:string, field:string):string {
  const ms=Date.parse(value);
  if (!Number.isFinite(ms)) validation(`${field} must be a valid timestamp`);
  return new Date(ms).toISOString();
}
function fingerprint(input: Omit<PlatformAuditStoreInput,"cursorCreatedAt"|"cursorId"|"limit">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
function encodeCursor(createdAt:string,id:string,filterFingerprint:string):string {
  return Buffer.from(JSON.stringify({v:1,createdAt,id,fingerprint:filterFingerprint}),"utf8").toString("base64url");
}
function decodeCursor(cursor:string,expectedFingerprint:string):{createdAt:string;id:string} {
  try {
    const raw=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")) as {v?:unknown;createdAt?:unknown;id?:unknown;fingerprint?:unknown};
    if (raw.v!==1 || typeof raw.createdAt!=="string" || typeof raw.id!=="string" || raw.fingerprint!==expectedFingerprint) validation("Cursor does not match the normalized Audit query");
    const createdAt=iso(raw.createdAt,"cursor.createdAt");
    const id=uuid(raw.id,"cursor.id");
    if (!id) validation("cursor.id is required");
    return {createdAt,id};
  } catch (error) {
    if (error instanceof AppError) throw error;
    validation("Cursor is malformed");
  }
}

export async function queryPlatformAudit(input: PlatformAuditQueryInput, deps:{context:PlatformSecurityContext;store:PlatformAuditQueryStore}):Promise<PlatformAuditQueryPage> {
  const {context,store}=deps;
  if (context.scopeKind!=="platform" || !context.platformPermissions.includes("platform.audit.read")) throw new AppError("PERMISSION_DENIED","platform.audit.read is required");
  const createdFrom=iso(input.createdFrom,"createdFrom");
  const createdUntil=iso(input.createdUntil,"createdUntil");
  const fromMs=Date.parse(createdFrom), untilMs=Date.parse(createdUntil);
  if (fromMs>=untilMs) validation("createdFrom must be before createdUntil");
  if (untilMs-fromMs>MAX_WINDOW_MS) validation("Audit query interval cannot exceed 31 days");
  const tenantId=uuid(input.tenantId,"tenantId");
  const locationId=uuid(input.locationId,"locationId");
  if (locationId && !tenantId) validation("locationId requires tenantId");
  const actorIdentityId=uuid(input.actorIdentityId,"actorIdentityId");
  const actorKind=bounded(input.actorKind,"actorKind",64,true);
  const actionKey=bounded(input.actionKey,"actionKey",160,true);
  const resourceType=bounded(input.resourceType,"resourceType",160);
  const resourceId=bounded(input.resourceId,"resourceId",256);
  const correlationId=bounded(input.correlationId,"correlationId",256);
  const outcome=input.outcome;
  if (outcome!==undefined && !["success","denied","failure"].includes(outcome)) validation("outcome is invalid");
  const limit=input.limit??50;
  if (!Number.isInteger(limit) || limit<1 || limit>100) validation("limit must be an integer between 1 and 100");
  const filters={createdFrom,createdUntil,tenantId,locationId,actorIdentityId,actorKind,actionKey,resourceType,resourceId,correlationId,outcome};
  const filterFingerprint=fingerprint(filters);
  const cursor=input.cursor ? decodeCursor(input.cursor,filterFingerprint) : undefined;
  const rows=await store.queryPlatformAudit({...filters,cursorCreatedAt:cursor?.createdAt,cursorId:cursor?.id,limit},context);
  const items=rows.slice(0,limit);
  const nextCursor=rows.length>limit && items.length ? encodeCursor(items[items.length-1].createdAt,items[items.length-1].id,filterFingerprint) : undefined;
  return nextCursor ? {items,nextCursor} : {items};
}
