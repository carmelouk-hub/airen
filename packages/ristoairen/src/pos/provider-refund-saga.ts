import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import type { ProviderWebhookHandler, VerifiedProviderWebhookEvent } from "../../../integrations/src/webhook-replay.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const PROVIDER_REFUND_DISPATCH_EVENT = "RISTOAIREN_PROVIDER_REFUND_REQUESTED";
export const PROVIDER_REFUND_STARTED_ACTION = "PROVIDER_REFUND_SAGA_STARTED";
export const PROVIDER_REFUND_RECONCILED_ACTION = "PROVIDER_REFUND_RECONCILED";
export const REFUND_EXECUTE_PERMISSION = "pos.refund.execute";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";

export type ProviderRefundSagaStatus = "PENDING_DISPATCH" | "DISPATCHED" | "SUCCEEDED" | "FAILED";

export type ProviderRefundMaterial = Readonly<{
  refundRequestId: string;
  refundRequestStatus: string;
  refundPaymentId: string;
  refundPaymentStatus: string;
  originalPaymentId: string;
  providerSourceReference: string | null;
  amount: string;
  currency: string;
  environmentClass: string;
  refundRequestIdFromMetadata: string | null;
}>;

export type ProviderRefundSagaRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  refundRequestId: string;
  refundPaymentId: string;
  originalPaymentId: string;
  providerKey: string;
  providerSourceReference: string;
  idempotencyKey: string;
  status: ProviderRefundSagaStatus;
  providerRefundReference?: string;
  providerEventId?: string;
  resultCode?: string;
  rowVersion: number;
  environmentClass: string;
  reconciledAt?: string;
}>;

export interface ProviderRefundSagaTransaction extends TransactionContext {
  getRefundMaterial(refundRequestId: string, refundPaymentId: string): Promise<ProviderRefundMaterial | null>;
  findSagaByIdempotencyKey(idempotencyKey: string): Promise<ProviderRefundSagaRecord | null>;
  insertSaga(record: Omit<ProviderRefundSagaRecord, "id">): Promise<ProviderRefundSagaRecord>;
  enqueueRefundDispatch(input: Readonly<{
    saga: ProviderRefundSagaRecord;
    amount: string;
    currency: string;
    correlationId: string;
  }>): Promise<void>;
  getSagaForReconciliation(refundPaymentId: string): Promise<ProviderRefundSagaRecord | null>;
  reconcileSaga(input: Readonly<{
    sagaId: string;
    outcome: "SUCCEEDED" | "FAILED";
    providerRefundReference?: string;
    providerEventId: string;
    resultCode: string;
    reconciledAt: string;
  }>): Promise<ProviderRefundSagaRecord>;
}

export type ProviderRefundSagaDependencies = Readonly<{
  unitOfWork: UnitOfWork<ProviderRefundSagaTransaction>;
  now?: () => string;
}>;

export type StartProviderRefundInput = Readonly<{
  refundRequestId: string;
  refundPaymentId: string;
  providerKey: string;
}>;

export type StartProviderRefundResult = Readonly<{
  saga: ProviderRefundSagaRecord;
  replayed: boolean;
}>;

export type TrustedProviderRefundResolution = Readonly<{
  securityContext: SecurityContext;
  refundPaymentId: string;
  outcome: "SUCCEEDED" | "FAILED";
  providerRefundReference?: string;
  resultCode: string;
}>;

export type TrustedProviderRefundResolver = Readonly<{
  resolve(lookup: Readonly<{ providerEventId: string; eventType: string }>): Promise<TrustedProviderRefundResolution | null>;
}>;

function validation(message: string): never {
  throw new AppError("VALIDATION_FAILED", message);
}

function conflict(message: string): never {
  throw new AppError("CONFLICT", message);
}

function requireAuthority(context: SecurityContext): void {
  requirePermission(context, REFUND_EXECUTE_PERMISSION, { tenantId: context.tenantId, locationId: context.locationId });
  if (!context.entitlements.includes(RISTOAIREN_ENTITLEMENT)) {
    throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);
  }
}

function normalizeProviderKey(value: string): string {
  const providerKey = value?.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(providerKey)) validation("providerKey is invalid");
  return providerKey;
}

function validTimestamp(now: () => string): string {
  const value = now();
  if (!Number.isFinite(Date.parse(value))) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Server clock returned invalid timestamp");
  return value;
}

function deterministicIdempotencyKey(refundPaymentId: string, providerKey: string): string {
  return `provider-refund:${providerKey}:${refundPaymentId}`;
}

function sameSaga(existing: ProviderRefundSagaRecord, material: ProviderRefundMaterial, providerKey: string, key: string): boolean {
  return existing.refundRequestId === material.refundRequestId
    && existing.refundPaymentId === material.refundPaymentId
    && existing.originalPaymentId === material.originalPaymentId
    && existing.providerKey === providerKey
    && existing.providerSourceReference === material.providerSourceReference
    && existing.idempotencyKey === key
    && existing.environmentClass === material.environmentClass;
}

export async function startProviderRefundSaga(
  context: SecurityContext,
  rawInput: StartProviderRefundInput,
  dependencies: ProviderRefundSagaDependencies
): Promise<StartProviderRefundResult> {
  requireAuthority(context);
  const refundRequestId = rawInput.refundRequestId?.trim();
  const refundPaymentId = rawInput.refundPaymentId?.trim();
  if (!refundRequestId || !refundPaymentId) validation("refundRequestId and refundPaymentId are required");
  const providerKey = normalizeProviderKey(rawInput.providerKey);

  return dependencies.unitOfWork.transaction(async (tx) => {
    const material = await tx.getRefundMaterial(refundRequestId, refundPaymentId);
    if (!material) throw new AppError("NOT_FOUND", "Refund provider material not found");
    if (material.refundRequestStatus !== "APPROVED") conflict("RefundRequest must remain APPROVED");
    if (material.refundPaymentStatus !== "RECORDED") conflict("MAT-023 refund Payment must be RECORDED");
    if (material.refundRequestIdFromMetadata !== refundRequestId) conflict("Refund Payment is not bound to this RefundRequest");
    if (!material.providerSourceReference) conflict("Original Payment has no provider reference to refund");

    const key = deterministicIdempotencyKey(refundPaymentId, providerKey);
    const existing = await tx.findSagaByIdempotencyKey(key);
    if (existing) {
      if (!sameSaga(existing, material, providerKey, key)) {
        throw new AppError("IDEMPOTENCY_CONFLICT", "Provider refund idempotency key is bound to incompatible semantics");
      }
      return Object.freeze({ saga: existing, replayed: true });
    }

    const saga = await tx.insertSaga(Object.freeze({
      tenantId: context.tenantId,
      locationId: context.locationId,
      refundRequestId,
      refundPaymentId,
      originalPaymentId: material.originalPaymentId,
      providerKey,
      providerSourceReference: material.providerSourceReference,
      idempotencyKey: key,
      status: "PENDING_DISPATCH",
      rowVersion: 1,
      environmentClass: material.environmentClass
    }));

    await tx.enqueueRefundDispatch(Object.freeze({ saga, amount: material.amount, currency: material.currency, correlationId: context.correlationId }));
    const audit: AuditRecord = Object.freeze({
      actorIdentityId: context.actorIdentityId,
      tenantId: context.tenantId,
      locationId: context.locationId,
      actionKey: PROVIDER_REFUND_STARTED_ACTION,
      resourceType: "ProviderRefundSaga",
      resourceId: saga.id,
      correlationId: context.correlationId,
      outcome: "success",
      metadata: Object.freeze({ refundRequestId, refundPaymentId, providerKey })
    });
    await tx.audit(audit);
    return Object.freeze({ saga, replayed: false });
  }, context);
}

export async function reconcileTrustedProviderRefund(
  resolution: TrustedProviderRefundResolution,
  providerEventId: string,
  dependencies: ProviderRefundSagaDependencies
): Promise<ProviderRefundSagaRecord> {
  const context = resolution.securityContext;
  requireAuthority(context);
  const refundPaymentId = resolution.refundPaymentId?.trim();
  if (!refundPaymentId) validation("refundPaymentId is required");
  const eventId = providerEventId?.trim();
  if (!eventId) validation("providerEventId is required");
  const resultCode = resolution.resultCode?.trim().toUpperCase();
  if (!/^[A-Z0-9_][A-Z0-9_.-]{0,63}$/.test(resultCode)) validation("resultCode is invalid");
  if (resolution.outcome === "SUCCEEDED" && !resolution.providerRefundReference?.trim()) {
    validation("providerRefundReference is required for successful provider refund");
  }
  const reconciledAt = validTimestamp(dependencies.now ?? (() => new Date().toISOString()));

  return dependencies.unitOfWork.transaction(async (tx) => {
    const saga = await tx.getSagaForReconciliation(refundPaymentId);
    if (!saga) throw new AppError("NOT_FOUND", "Provider refund saga not found");
    if (saga.tenantId !== context.tenantId || saga.locationId !== context.locationId) {
      throw new AppError("TENANT_SCOPE_VIOLATION", "Provider refund saga scope mismatch");
    }

    if (saga.status === "SUCCEEDED" || saga.status === "FAILED") {
      const same = saga.status === resolution.outcome
        && saga.providerEventId === eventId
        && saga.resultCode === resultCode
        && (saga.providerRefundReference ?? undefined) === (resolution.providerRefundReference?.trim() || undefined);
      if (!same) throw new AppError("IDEMPOTENCY_CONFLICT", "Terminal provider refund result conflicts with prior reconciliation");
      return saga;
    }

    const updated = await tx.reconcileSaga(Object.freeze({
      sagaId: saga.id,
      outcome: resolution.outcome,
      ...(resolution.providerRefundReference?.trim() ? { providerRefundReference: resolution.providerRefundReference.trim() } : {}),
      providerEventId: eventId,
      resultCode,
      reconciledAt
    }));
    const audit: AuditRecord = Object.freeze({
      actorIdentityId: context.actorIdentityId,
      tenantId: context.tenantId,
      locationId: context.locationId,
      actionKey: PROVIDER_REFUND_RECONCILED_ACTION,
      resourceType: "ProviderRefundSaga",
      resourceId: updated.id,
      correlationId: context.correlationId,
      outcome: "success",
      metadata: Object.freeze({ refundPaymentId, providerEventId: eventId, resultCode, status: updated.status })
    });
    await tx.audit(audit);
    return updated;
  }, context);
}

/** Provider payload is never used as financial/scope authority. */
export function createProviderRefundResultHandler(
  resolver: TrustedProviderRefundResolver,
  dependencies: ProviderRefundSagaDependencies
): ProviderWebhookHandler {
  return async (event: VerifiedProviderWebhookEvent): Promise<void> => {
    const lookup = Object.freeze({ providerEventId: event.providerEventId, eventType: event.eventType });
    const resolution = await resolver.resolve(lookup);
    if (!resolution) throw new Error("PROVIDER_REFUND_BINDING_NOT_FOUND");
    await reconcileTrustedProviderRefund(resolution, event.providerEventId, dependencies);
  };
}
