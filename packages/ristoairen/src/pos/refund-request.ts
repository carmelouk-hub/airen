import { createHash } from "node:crypto";
import { requirePermission } from "../../../authorization/src/index.ts";
import type { TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const REFUND_REQUEST_PERMISSION = "pos.refund.request";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";

export type RefundRequestInput = Readonly<{
  paymentId: string;
  amount?: string;
  reason: string;
  expectedPaymentRowVersion: number;
  idempotencyKey: string;
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

export interface RefundRequestTransaction extends TransactionContext {
  getPaymentForRefundRequest(paymentId: string): Promise<PaymentForRefundRequest | null>;
  listRefundLineage(paymentId: string): Promise<readonly RefundLineagePayment[]>;
}

export type RefundRequestDependencies = Readonly<{
  unitOfWork: UnitOfWork<RefundRequestTransaction>;
}>;

export type RefundApprovalEnvelope = Readonly<{
  schema: "risto.refund-approval-envelope.v1";
  tenantId: string;
  locationId: string;
  orderId: string;
  paymentId: string;
  requestedAmount: string;
  currency: string;
  reason: string;
  requestedBy: string;
  requestIdempotencyKey: string;
  expectedPaymentRowVersion: number;
  observedRefundedAmount: string;
  observedRefundableBeforeRequest: string;
  environmentClass: string;
  approvalRequired: true;
  monetaryEffectCreated: false;
  envelopeDigest: string;
}>;

function validation(message: string): never {
  throw new AppError("VALIDATION_FAILED", message);
}

function conflict(message: string): never {
  throw new AppError("CONFLICT", message);
}

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

function normalizeInput(input: RefundRequestInput): Readonly<RefundRequestInput> {
  const paymentId = input.paymentId?.trim();
  if (!paymentId) validation("paymentId is required");
  const reason = input.reason?.trim();
  if (!reason || reason.length > 1000) validation("reason is required and must be at most 1000 characters");
  if (!Number.isInteger(input.expectedPaymentRowVersion) || input.expectedPaymentRowVersion < 1) validation("expectedPaymentRowVersion must be a positive integer");
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey || idempotencyKey.length > 240) validation("idempotencyKey is invalid");
  if (input.amount !== undefined) {
    const minor = decimalToMinor(input.amount, "amount");
    if (minor <= 0) validation("amount must be positive");
  }
  return Object.freeze({
    paymentId,
    ...(input.amount === undefined ? {} : { amount: input.amount }),
    reason,
    expectedPaymentRowVersion: input.expectedPaymentRowVersion,
    idempotencyKey
  });
}

function requireRefundRequestAuthority(context: SecurityContext): void {
  requirePermission(context, REFUND_REQUEST_PERMISSION, { tenantId: context.tenantId, locationId: context.locationId });
  if (!context.entitlements.includes(RISTOAIREN_ENTITLEMENT)) {
    throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);
  }
}

function assertPaymentScope(context: SecurityContext, payment: PaymentForRefundRequest | null, paymentId: string): asserts payment is PaymentForRefundRequest {
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found");
  if (payment.id !== paymentId) throw new AppError("INTERNAL_ERROR", "Payment repository identity mismatch");
  if (payment.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "Payment tenant mismatch");
  if (payment.locationId !== context.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", "Payment location mismatch");
  if (payment.refundOfPaymentId) validation("A refund-lineage Payment cannot be used as the original refund target");
}

function envelopeDigest(fields: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export async function requestRefund(
  context: SecurityContext,
  rawInput: RefundRequestInput,
  dependencies: RefundRequestDependencies
): Promise<RefundApprovalEnvelope> {
  requireRefundRequestAuthority(context);
  const input = normalizeInput(rawInput);

  return dependencies.unitOfWork.transaction(async (tx) => {
    const payment = await tx.getPaymentForRefundRequest(input.paymentId);
    assertPaymentScope(context, payment, input.paymentId);
    if (payment.rowVersion !== input.expectedPaymentRowVersion) conflict("Payment row version changed");

    const currency = normalizeCurrency(payment.currency);
    const originalMinor = decimalToMinor(payment.amount, "original payment amount");
    if (originalMinor <= 0) throw new AppError("INTERNAL_ERROR", "Original Payment amount must be positive");

    const lineage = await tx.listRefundLineage(payment.id);
    let refundedMinor = 0;
    for (const child of lineage) {
      if (child.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "Refund lineage tenant mismatch");
      if (child.locationId !== context.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", "Refund lineage location mismatch");
      if (child.refundOfPaymentId !== payment.id) throw new AppError("INTERNAL_ERROR", "Refund lineage parent mismatch");
      if (normalizeCurrency(child.currency) !== currency) throw new AppError("INTERNAL_ERROR", "Refund lineage currency mismatch");
      refundedMinor += decimalToMinor(child.amount, "refund lineage amount");
      if (!Number.isSafeInteger(refundedMinor)) throw new AppError("INTERNAL_ERROR", "Refund lineage total overflow");
    }
    if (refundedMinor > originalMinor) throw new AppError("INTERNAL_ERROR", "Refund lineage exceeds original Payment amount");

    const refundableMinor = originalMinor - refundedMinor;
    if (refundableMinor <= 0) conflict("Payment has no refundable balance");
    const requestedMinor = input.amount === undefined ? refundableMinor : decimalToMinor(input.amount, "amount");
    if (requestedMinor <= 0) validation("amount must be positive");
    if (requestedMinor > refundableMinor) conflict("Refund request exceeds refundable balance");

    const requestedAmount = minorToDecimal(requestedMinor);
    const observedRefundedAmount = minorToDecimal(refundedMinor);
    const observedRefundableBeforeRequest = minorToDecimal(refundableMinor);
    const digest = envelopeDigest([
      context.tenantId,
      context.locationId,
      payment.orderId,
      payment.id,
      requestedAmount,
      currency,
      input.reason,
      context.actorIdentityId,
      input.idempotencyKey,
      String(input.expectedPaymentRowVersion),
      observedRefundedAmount,
      observedRefundableBeforeRequest,
      payment.environmentClass
    ]);

    return Object.freeze({
      schema: "risto.refund-approval-envelope.v1",
      tenantId: context.tenantId,
      locationId: context.locationId,
      orderId: payment.orderId,
      paymentId: payment.id,
      requestedAmount,
      currency,
      reason: input.reason,
      requestedBy: context.actorIdentityId,
      requestIdempotencyKey: input.idempotencyKey,
      expectedPaymentRowVersion: input.expectedPaymentRowVersion,
      observedRefundedAmount,
      observedRefundableBeforeRequest,
      environmentClass: payment.environmentClass,
      approvalRequired: true,
      monetaryEffectCreated: false,
      envelopeDigest: digest
    });
  }, context);
}
