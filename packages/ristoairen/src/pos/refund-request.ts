import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const REFUND_REQUEST_PERMISSION = "pos.refund.request";
export const REFUND_APPROVE_PERMISSION = "pos.refund.approve";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const REFUND_REQUESTED_ACTION = "REFUND_REQUESTED";
export const REFUND_APPROVED_ACTION = "REFUND_APPROVED";

export type RefundRequestInput = Readonly<{
  paymentId: string;
  amount?: string;
  reason: string;
  expectedPaymentRowVersion: number;
  idempotencyKey: string;
}>;

export type RefundApproveInput = Readonly<{
  refundRequestId: string;
  expectedRefundRequestRowVersion: number;
}>;

export type PaymentForRefundRequest = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  orderId: string;
  paymentMethod: string;
  amount: string;
  currency: string;
  refundOfPaymentId?: string;
  rowVersion: number;
  environmentClass: string;
}>;

export type RefundLineagePayment = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  amount: string;
  currency: string;
  refundOfPaymentId: string;
}>;

export type RefundRequestRecord = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  paymentId: string;
  orderId: string;
  requestedAmount: string;
  currency: string;
  reason: string;
  requestedByIdentityId: string;
  requestedAt: string;
  requestIdempotencyKey: string;
  originalPaymentRowVersion: number;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  approvedByIdentityId?: string;
  approvedAt?: string;
  rejectedByIdentityId?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  rowVersion: number;
  environmentClass: string;
}>;

export interface RefundRequestTransaction extends TransactionContext {
  getPaymentForRefundRequest(paymentId: string): Promise<PaymentForRefundRequest | null>;
  listRefundLineage(paymentId: string): Promise<readonly RefundLineagePayment[]>;
  findRefundRequestByIdempotencyKey(idempotencyKey: string): Promise<RefundRequestRecord | null>;
  insertRefundRequest(request: Omit<RefundRequestRecord, "id">): Promise<RefundRequestRecord>;
  getRefundRequestForApproval(refundRequestId: string): Promise<RefundRequestRecord | null>;
  approveRefundRequest(refundRequestId: string, expectedRowVersion: number, approverIdentityId: string, approvedAt: string): Promise<RefundRequestRecord | null>;
}

export type RefundRequestDependencies = Readonly<{
  unitOfWork: UnitOfWork<RefundRequestTransaction>;
  now?: () => string;
}>;

export type RefundRequestResult = Readonly<{ refundRequest: RefundRequestRecord; replayed: boolean; monetaryEffectCreated: false }>;
export type RefundApprovalResult = Readonly<{ refundRequest: RefundRequestRecord; replayed: boolean; monetaryEffectCreated: false }>;

function validation(message: string): never { throw new AppError("VALIDATION_FAILED", message); }
function conflict(message: string): never { throw new AppError("CONFLICT", message); }

function decimalToMinor(value: string, field: string): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)) validation(`${field} must be a non-negative decimal with max 2 fraction digits`);
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) validation(`${field} is too large`);
  return Number(minor);
}

function minorToDecimal(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError("INTERNAL_ERROR", "Invalid internal money value");
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) validation("currency must be ISO 4217");
  return currency;
}

function requireAuthority(context: SecurityContext, permission: string): void {
  requirePermission(context, permission, { tenantId: context.tenantId, locationId: context.locationId });
  if (!context.entitlements.includes(RISTOAIREN_ENTITLEMENT)) throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);
}

function assertPaymentScope(context: SecurityContext, payment: PaymentForRefundRequest | null, paymentId: string): asserts payment is PaymentForRefundRequest {
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found");
  if (payment.id !== paymentId) throw new AppError("INTERNAL_ERROR", "Payment repository identity mismatch");
  if (payment.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "Payment tenant mismatch");
  if (payment.locationId !== context.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", "Payment location mismatch");
  if (payment.refundOfPaymentId) validation("A refund-lineage Payment cannot be used as the original refund target");
}

function assertRequestScope(context: SecurityContext, request: RefundRequestRecord | null): asserts request is RefundRequestRecord {
  if (!request) throw new AppError("NOT_FOUND", "RefundRequest not found");
  if (request.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "RefundRequest tenant mismatch");
  if (request.locationId !== context.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", "RefundRequest location mismatch");
}

function normalizeRequestInput(input: RefundRequestInput): RefundRequestInput {
  const paymentId = input.paymentId?.trim();
  const reason = input.reason?.trim();
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!paymentId) validation("paymentId is required");
  if (!reason || reason.length > 1000) validation("reason is required and must be at most 1000 characters");
  if (!Number.isInteger(input.expectedPaymentRowVersion) || input.expectedPaymentRowVersion < 1) validation("expectedPaymentRowVersion must be a positive integer");
  if (!idempotencyKey || idempotencyKey.length > 240) validation("idempotencyKey is invalid");
  if (input.amount !== undefined && decimalToMinor(input.amount, "amount") <= 0) validation("amount must be positive");
  return Object.freeze({ paymentId, ...(input.amount === undefined ? {} : { amount: input.amount }), reason, expectedPaymentRowVersion: input.expectedPaymentRowVersion, idempotencyKey });
}

function sameSemanticRequest(existing: RefundRequestRecord, input: RefundRequestInput, requestedAmount: string, currency: string): boolean {
  return existing.paymentId === input.paymentId
    && existing.requestedAmount === requestedAmount
    && existing.currency === currency
    && existing.reason === input.reason
    && existing.originalPaymentRowVersion === input.expectedPaymentRowVersion;
}

function validNow(now: () => string): string {
  const value = now();
  if (!Number.isFinite(Date.parse(value))) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Server clock returned an invalid timestamp");
  return value;
}

export async function requestRefund(context: SecurityContext, rawInput: RefundRequestInput, dependencies: RefundRequestDependencies): Promise<RefundRequestResult> {
  requireAuthority(context, REFUND_REQUEST_PERMISSION);
  const input = normalizeRequestInput(rawInput);
  const now = dependencies.now ?? (() => new Date().toISOString());

  return dependencies.unitOfWork.transaction(async (tx) => {
    const payment = await tx.getPaymentForRefundRequest(input.paymentId);
    assertPaymentScope(context, payment, input.paymentId);
    if (payment.rowVersion !== input.expectedPaymentRowVersion) conflict("Payment row version changed");
    const currency = normalizeCurrency(payment.currency);
    const originalMinor = decimalToMinor(payment.amount, "original payment amount");
    const lineage = await tx.listRefundLineage(payment.id);
    let refundedMinor = 0;
    for (const child of lineage) {
      if (child.tenantId !== context.tenantId || child.locationId !== context.locationId || child.refundOfPaymentId !== payment.id) throw new AppError("INTERNAL_ERROR", "Refund lineage scope mismatch");
      if (normalizeCurrency(child.currency) !== currency) throw new AppError("INTERNAL_ERROR", "Refund lineage currency mismatch");
      refundedMinor += decimalToMinor(child.amount, "refund lineage amount");
    }
    if (refundedMinor > originalMinor) throw new AppError("INTERNAL_ERROR", "Refund lineage exceeds original Payment amount");
    const refundableMinor = originalMinor - refundedMinor;
    if (refundableMinor <= 0) conflict("Payment has no refundable balance");
    const requestedMinor = input.amount === undefined ? refundableMinor : decimalToMinor(input.amount, "amount");
    if (requestedMinor <= 0) validation("amount must be positive");
    if (requestedMinor > refundableMinor) conflict("Refund request exceeds refundable balance");
    const requestedAmount = minorToDecimal(requestedMinor);

    const replay = await tx.findRefundRequestByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      assertRequestScope(context, replay);
      if (!sameSemanticRequest(replay, input, requestedAmount, currency)) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key already used by a different refund request");
      return Object.freeze({ refundRequest: replay, replayed: true, monetaryEffectCreated: false as const });
    }

    const requestedAt = validNow(now);
    const inserted = await tx.insertRefundRequest(Object.freeze({
      tenantId: context.tenantId,
      locationId: context.locationId,
      paymentId: payment.id,
      orderId: payment.orderId,
      requestedAmount,
      currency,
      reason: input.reason,
      requestedByIdentityId: context.actorIdentityId,
      requestedAt,
      requestIdempotencyKey: input.idempotencyKey,
      originalPaymentRowVersion: payment.rowVersion,
      status: "PENDING_APPROVAL" as const,
      rowVersion: 1,
      environmentClass: payment.environmentClass
    }));
    const audit: AuditRecord = Object.freeze({ actorIdentityId: context.actorIdentityId, tenantId: context.tenantId, locationId: context.locationId, actionKey: REFUND_REQUESTED_ACTION, resourceType: "RefundRequest", resourceId: inserted.id, correlationId: context.correlationId, outcome: "success", metadata: Object.freeze({ paymentId: payment.id, orderId: payment.orderId, requestedAmount, currency, requestIdempotencyKey: input.idempotencyKey, originalPaymentRowVersion: payment.rowVersion }) });
    await tx.audit(audit);
    return Object.freeze({ refundRequest: inserted, replayed: false, monetaryEffectCreated: false as const });
  }, context);
}

export async function approveRefund(context: SecurityContext, input: RefundApproveInput, dependencies: RefundRequestDependencies): Promise<RefundApprovalResult> {
  requireAuthority(context, REFUND_APPROVE_PERMISSION);
  const refundRequestId = input.refundRequestId?.trim();
  if (!refundRequestId) validation("refundRequestId is required");
  if (!Number.isInteger(input.expectedRefundRequestRowVersion) || input.expectedRefundRequestRowVersion < 1) validation("expectedRefundRequestRowVersion must be a positive integer");
  const now = dependencies.now ?? (() => new Date().toISOString());

  return dependencies.unitOfWork.transaction(async (tx) => {
    const request = await tx.getRefundRequestForApproval(refundRequestId);
    assertRequestScope(context, request);
    if (request.requestedByIdentityId === context.actorIdentityId) throw new AppError("PERMISSION_DENIED", "Requester cannot approve own refund request");
    if (request.status === "REJECTED") conflict("Rejected refund request cannot be approved");
    if (request.status === "APPROVED") return Object.freeze({ refundRequest: request, replayed: true, monetaryEffectCreated: false as const });
    if (request.rowVersion !== input.expectedRefundRequestRowVersion) conflict("RefundRequest row version changed");

    const payment = await tx.getPaymentForRefundRequest(request.paymentId);
    assertPaymentScope(context, payment, request.paymentId);
    if (payment.orderId !== request.orderId) throw new AppError("INTERNAL_ERROR", "RefundRequest Order mismatch");
    if (normalizeCurrency(payment.currency) !== request.currency) conflict("RefundRequest currency no longer matches Payment");
    if (payment.rowVersion !== request.originalPaymentRowVersion) conflict("Original Payment row version changed");

    const approvedAt = validNow(now);
    const approved = await tx.approveRefundRequest(request.id, request.rowVersion, context.actorIdentityId, approvedAt);
    if (!approved) conflict("RefundRequest approval concurrency conflict");
    const audit: AuditRecord = Object.freeze({ actorIdentityId: context.actorIdentityId, tenantId: context.tenantId, locationId: context.locationId, actionKey: REFUND_APPROVED_ACTION, resourceType: "RefundRequest", resourceId: approved.id, correlationId: context.correlationId, outcome: "success", metadata: Object.freeze({ paymentId: approved.paymentId, orderId: approved.orderId, requestedAmount: approved.requestedAmount, currency: approved.currency, requestedByIdentityId: approved.requestedByIdentityId, approvedByIdentityId: context.actorIdentityId, previousRowVersion: request.rowVersion, newRowVersion: approved.rowVersion }) });
    await tx.audit(audit);
    return Object.freeze({ refundRequest: approved, replayed: false, monetaryEffectCreated: false as const });
  }, context);
}
