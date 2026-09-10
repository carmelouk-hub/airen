import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { RefundRequestRecord } from "./refund-request.ts";

export const REFUND_EXECUTE_PERMISSION = "pos.refund.execute";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const PAYMENT_REFUNDED_ACTION = "PAYMENT_REFUNDED";
export const REFUND_EFFECT_WORKFLOW = "refund.effect";

export type RefundEffectInput = Readonly<{
  refundRequestId: string;
  expectedRefundRequestRowVersion: number;
}>;

export type PaymentForRefundEffect = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  orderId: string;
  paymentMethod: string;
  amount: string;
  currency: string;
  status: string;
  providerReference?: string;
  receivedAt: string;
  recordedBy: string;
  refundOfPaymentId?: string;
  idempotencyKey: string;
  metadataSanitized: Readonly<Record<string, unknown>>;
  rowVersion: number;
  environmentClass: string;
}>;

export type RefundChildPayment = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  amount: string;
  currency: string;
  refundOfPaymentId: string;
}>;

export interface RefundEffectTransaction extends TransactionContext {
  getRefundRequestForEffect(refundRequestId: string): Promise<RefundRequestRecord | null>;
  getOriginalPaymentForRefundEffect(paymentId: string): Promise<PaymentForRefundEffect | null>;
  findRefundEffectByIdempotencyKey(idempotencyKey: string): Promise<PaymentForRefundEffect | null>;
  listRefundChildren(paymentId: string): Promise<readonly RefundChildPayment[]>;
  insertCompensatingPayment(payment: Omit<PaymentForRefundEffect, "id">): Promise<PaymentForRefundEffect>;
}

export type RefundEffectDependencies = Readonly<{
  unitOfWork: UnitOfWork<RefundEffectTransaction>;
  now?: () => string;
}>;

export type RefundEffectResult = Readonly<{
  payment: PaymentForRefundEffect;
  refundRequestId: string;
  replayed: boolean;
}>;

function validation(message: string): never {
  throw new AppError("VALIDATION_FAILED", message);
}

function conflict(message: string): never {
  throw new AppError("CONFLICT", message);
}

function requireAuthority(context: SecurityContext): void {
  requirePermission(context, REFUND_EXECUTE_PERMISSION, {
    tenantId: context.tenantId,
    locationId: context.locationId
  });
  if (!context.entitlements.includes(RISTOAIREN_ENTITLEMENT)) {
    throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);
  }
}

function decimalToMinor(value: string, field: string): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)) {
    validation(`${field} must be a non-negative decimal with max 2 fraction digits`);
  }
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) validation(`${field} is too large`);
  return Number(minor);
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) validation("currency must be ISO 4217");
  return currency;
}

function validNow(now: () => string): string {
  const value = now();
  if (!Number.isFinite(Date.parse(value))) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Server clock returned an invalid timestamp");
  }
  return value;
}

function assertRequestScope(
  context: SecurityContext,
  request: RefundRequestRecord | null,
  refundRequestId: string
): asserts request is RefundRequestRecord {
  if (!request) throw new AppError("NOT_FOUND", "RefundRequest not found");
  if (request.id !== refundRequestId) throw new AppError("INTERNAL_ERROR", "RefundRequest repository identity mismatch");
  if (request.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "RefundRequest tenant mismatch");
  if (request.locationId !== context.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", "RefundRequest location mismatch");
}

function assertOriginalPaymentScope(
  context: SecurityContext,
  payment: PaymentForRefundEffect | null,
  request: RefundRequestRecord
): asserts payment is PaymentForRefundEffect {
  if (!payment) throw new AppError("NOT_FOUND", "Original Payment not found");
  if (payment.id !== request.paymentId) throw new AppError("INTERNAL_ERROR", "Payment repository identity mismatch");
  if (payment.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "Payment tenant mismatch");
  if (payment.locationId !== context.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", "Payment location mismatch");
  if (payment.refundOfPaymentId) validation("A refund-lineage Payment cannot be the original refund target");
  if (payment.orderId !== request.orderId) conflict("RefundRequest Order no longer matches original Payment");
  if (normalizeCurrency(payment.currency) !== normalizeCurrency(request.currency)) conflict("RefundRequest currency no longer matches original Payment");
  if (payment.rowVersion !== request.originalPaymentRowVersion) conflict("Original Payment row version changed");
}

function deterministicIdempotencyKey(refundRequestId: string): string {
  return `refund-effect:${refundRequestId}`;
}

function sameSemanticEffect(
  effect: PaymentForRefundEffect,
  request: RefundRequestRecord,
  original: PaymentForRefundEffect,
  idempotencyKey: string
): boolean {
  return effect.tenantId === request.tenantId
    && effect.locationId === request.locationId
    && effect.orderId === request.orderId
    && effect.paymentMethod === original.paymentMethod
    && effect.amount === request.requestedAmount
    && normalizeCurrency(effect.currency) === normalizeCurrency(request.currency)
    && effect.status === "RECORDED"
    && effect.refundOfPaymentId === original.id
    && effect.idempotencyKey === idempotencyKey
    && effect.providerReference === undefined
    && effect.environmentClass === original.environmentClass
    && effect.metadataSanitized.refundRequestId === request.id
    && effect.metadataSanitized.workflow === REFUND_EFFECT_WORKFLOW;
}

export async function executeApprovedRefund(
  context: SecurityContext,
  rawInput: RefundEffectInput,
  dependencies: RefundEffectDependencies
): Promise<RefundEffectResult> {
  requireAuthority(context);

  const refundRequestId = rawInput.refundRequestId?.trim();
  if (!refundRequestId) validation("refundRequestId is required");
  if (!Number.isInteger(rawInput.expectedRefundRequestRowVersion) || rawInput.expectedRefundRequestRowVersion < 1) {
    validation("expectedRefundRequestRowVersion must be a positive integer");
  }
  const now = dependencies.now ?? (() => new Date().toISOString());

  return dependencies.unitOfWork.transaction(async (tx) => {
    const request = await tx.getRefundRequestForEffect(refundRequestId);
    assertRequestScope(context, request, refundRequestId);

    if (request.status !== "APPROVED") conflict("RefundRequest must be APPROVED before monetary effect");
    if (request.rowVersion !== rawInput.expectedRefundRequestRowVersion) conflict("RefundRequest row version changed");

    const original = await tx.getOriginalPaymentForRefundEffect(request.paymentId);
    assertOriginalPaymentScope(context, original, request);

    const requestedMinor = decimalToMinor(request.requestedAmount, "requested refund amount");
    if (requestedMinor <= 0) validation("requested refund amount must be positive");
    const originalMinor = decimalToMinor(original.amount, "original payment amount");
    if (requestedMinor > originalMinor) conflict("Refund request exceeds original Payment amount");

    const idempotencyKey = deterministicIdempotencyKey(request.id);
    const existing = await tx.findRefundEffectByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (!sameSemanticEffect(existing, request, original, idempotencyKey)) {
        throw new AppError("IDEMPOTENCY_CONFLICT", "Refund effect idempotency key is bound to incompatible semantics");
      }
      return Object.freeze({ payment: existing, refundRequestId: request.id, replayed: true });
    }

    const children = await tx.listRefundChildren(original.id);
    let refundedMinor = 0;
    for (const child of children) {
      if (child.tenantId !== context.tenantId || child.locationId !== context.locationId || child.refundOfPaymentId !== original.id) {
        throw new AppError("INTERNAL_ERROR", "Refund lineage scope mismatch");
      }
      if (normalizeCurrency(child.currency) !== normalizeCurrency(original.currency)) {
        throw new AppError("INTERNAL_ERROR", "Refund lineage currency mismatch");
      }
      refundedMinor += decimalToMinor(child.amount, "refund lineage amount");
    }
    if (refundedMinor > originalMinor) throw new AppError("INTERNAL_ERROR", "Refund lineage exceeds original Payment amount");
    const refundableMinor = originalMinor - refundedMinor;
    if (requestedMinor > refundableMinor) conflict("Refund effect exceeds current refundable balance");

    const receivedAt = validNow(now);
    const payment = await tx.insertCompensatingPayment(Object.freeze({
      tenantId: context.tenantId,
      locationId: context.locationId,
      orderId: original.orderId,
      paymentMethod: original.paymentMethod,
      amount: request.requestedAmount,
      currency: normalizeCurrency(request.currency),
      status: "RECORDED",
      receivedAt,
      recordedBy: context.actorIdentityId,
      refundOfPaymentId: original.id,
      idempotencyKey,
      metadataSanitized: Object.freeze({ refundRequestId: request.id, workflow: REFUND_EFFECT_WORKFLOW }),
      rowVersion: 1,
      environmentClass: original.environmentClass
    }));

    const audit: AuditRecord = Object.freeze({
      actorIdentityId: context.actorIdentityId,
      tenantId: context.tenantId,
      locationId: context.locationId,
      actionKey: PAYMENT_REFUNDED_ACTION,
      resourceType: "Payment",
      resourceId: payment.id,
      correlationId: context.correlationId,
      outcome: "success",
      metadata: Object.freeze({
        refundRequestId: request.id,
        originalPaymentId: original.id,
        refundPaymentId: payment.id,
        orderId: original.orderId,
        amount: payment.amount,
        currency: payment.currency
      })
    });
    await tx.audit(audit);

    return Object.freeze({ payment, refundRequestId: request.id, replayed: false });
  }, context);
}
