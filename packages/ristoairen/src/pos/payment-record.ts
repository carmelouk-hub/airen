import { requirePermission } from "../../../authorization/src/index.ts";
import type { AuditRecord, TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const PAYMENT_RECORD_PERMISSION = "pos.payment.record";
export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const PAYMENT_RECORDED_ACTION = "PAYMENT_RECORDED";
export const PAYMENT_METHODS = ["CASH", "CARD", "MIXED", "OTHER"] as const;

export type PaymentMethod = typeof PAYMENT_METHODS[number];

export type PaymentRecordInput = Readonly<{
  orderId: string;
  paymentMethod: PaymentMethod;
  amount: string;
  currency: string;
  idempotencyKey: string;
  providerReference?: string;
}>;

export type OrderForPayment = Readonly<{
  id: string;
  tenantId: string;
  locationId: string;
  currency: string;
  total: string;
  rowVersion?: number;
  environmentClass?: string;
}>;

export type PaymentForRecord = Readonly<{
  id?: string;
  tenantId: string;
  locationId: string;
  orderId: string;
  paymentMethod: PaymentMethod;
  amount: string;
  currency: string;
  status: string;
  providerReference?: string;
  receivedAt: string;
  recordedBy: string;
  idempotencyKey: string;
  metadataSanitized: Readonly<Record<string, unknown>>;
  rowVersion: number;
  environmentClass: string;
}>;

export interface PaymentRecordTransaction extends TransactionContext {
  getOrderForPayment(orderId: string): Promise<OrderForPayment | null>;
  findPaymentByIdempotencyKey(idempotencyKey: string): Promise<PaymentForRecord | null>;
  listEffectivePaymentsForOrder(orderId: string): Promise<readonly PaymentForRecord[]>;
  insertPayment(payment: Omit<PaymentForRecord, "id">): Promise<PaymentForRecord>;
}

export type PaymentRecordDependencies = Readonly<{
  unitOfWork: UnitOfWork<PaymentRecordTransaction>;
  now?: () => string;
}>;

export type PaymentRecordResult = Readonly<{
  payment: PaymentForRecord;
  replayed: boolean;
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

function normalizeInput(input: PaymentRecordInput): Readonly<PaymentRecordInput & { amountMinor: number }> {
  if (!input.orderId?.trim()) validation("orderId is required");
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) validation("paymentMethod is invalid");
  const amountMinor = decimalToMinor(input.amount, "amount");
  if (amountMinor <= 0) validation("amount must be positive");
  if (!input.idempotencyKey?.trim() || input.idempotencyKey.trim().length > 240) validation("idempotencyKey is invalid");
  if (input.providerReference && input.providerReference.trim().length > 240) validation("providerReference is too long");
  return Object.freeze({
    ...input,
    orderId: input.orderId.trim(),
    currency: normalizeCurrency(input.currency),
    idempotencyKey: input.idempotencyKey.trim(),
    providerReference: input.providerReference?.trim() || undefined,
    amountMinor
  });
}

function requireRistoAirenPaymentAuthority(context: SecurityContext): void {
  requirePermission(context, PAYMENT_RECORD_PERMISSION, { tenantId: context.tenantId, locationId: context.locationId });
  if (!context.entitlements.includes(RISTOAIREN_ENTITLEMENT)) {
    throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);
  }
}

function assertOrderScope(context: SecurityContext, order: OrderForPayment | null, orderId: string): asserts order is OrderForPayment {
  if (!order) throw new AppError("NOT_FOUND", "Order not found");
  if (order.id !== orderId) throw new AppError("INTERNAL_ERROR", "Order repository identity mismatch");
  if (order.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "Order tenant mismatch");
  if (order.locationId !== context.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", "Order location mismatch");
}

function assertExistingPaymentScope(context: SecurityContext, payment: PaymentForRecord, orderId: string, currency: string): number {
  if (payment.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "Payment tenant mismatch");
  if (payment.locationId !== context.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", "Payment location mismatch");
  if (payment.orderId !== orderId) throw new AppError("TENANT_SCOPE_VIOLATION", "Payment parent mismatch");
  if (normalizeCurrency(payment.currency) !== currency) conflict("Existing payment currency mismatch");
  return decimalToMinor(payment.amount, "existing payment amount");
}

function sameSemanticRequest(existing: PaymentForRecord, input: ReturnType<typeof normalizeInput>): boolean {
  return existing.orderId === input.orderId
    && existing.paymentMethod === input.paymentMethod
    && decimalToMinor(existing.amount, "existing payment amount") === input.amountMinor
    && normalizeCurrency(existing.currency) === input.currency
    && (existing.providerReference ?? "") === (input.providerReference ?? "");
}

export async function recordPayment(
  context: SecurityContext,
  rawInput: PaymentRecordInput,
  dependencies: PaymentRecordDependencies
): Promise<PaymentRecordResult> {
  requireRistoAirenPaymentAuthority(context);
  const input = normalizeInput(rawInput);
  const now = dependencies.now ?? (() => new Date().toISOString());

  return dependencies.unitOfWork.transaction(async (tx) => {
    const replay = await tx.findPaymentByIdempotencyKey(input.idempotencyKey);
    if (replay) {
      if (!sameSemanticRequest(replay, input)) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key already used by a different payment request");
      assertExistingPaymentScope(context, replay, input.orderId, input.currency);
      return Object.freeze({ payment: replay, replayed: true });
    }

    const order = await tx.getOrderForPayment(input.orderId);
    assertOrderScope(context, order, input.orderId);
    const orderCurrency = normalizeCurrency(order.currency);
    if (orderCurrency !== input.currency) conflict("Payment currency does not match Order currency");

    const orderTotalMinor = decimalToMinor(order.total, "order total");
    const effectivePayments = await tx.listEffectivePaymentsForOrder(order.id);
    let paidMinor = 0;
    for (const payment of effectivePayments) {
      paidMinor += assertExistingPaymentScope(context, payment, order.id, orderCurrency);
      if (!Number.isSafeInteger(paidMinor)) throw new AppError("INTERNAL_ERROR", "Payment total overflow");
    }
    if (paidMinor > orderTotalMinor) throw new AppError("INTERNAL_ERROR", "Canonical Order is already overpaid");
    const outstandingMinor = orderTotalMinor - paidMinor;
    if (outstandingMinor <= 0) conflict("Order is already paid");
    if (input.amountMinor > outstandingMinor) conflict("Payment exceeds outstanding amount");

    const receivedAt = now();
    if (!Number.isFinite(Date.parse(receivedAt))) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Server clock returned an invalid timestamp");

    const draft: Omit<PaymentForRecord, "id"> = Object.freeze({
      tenantId: context.tenantId,
      locationId: context.locationId,
      orderId: order.id,
      paymentMethod: input.paymentMethod,
      amount: minorToDecimal(input.amountMinor),
      currency: orderCurrency,
      status: "RECORDED",
      ...(input.providerReference ? { providerReference: input.providerReference } : {}),
      receivedAt,
      recordedBy: context.actorIdentityId,
      idempotencyKey: input.idempotencyKey,
      metadataSanitized: Object.freeze({ source: "RST-F-POS-001", correlationId: context.correlationId }),
      rowVersion: 1,
      environmentClass: order.environmentClass ?? "PRODUCTION"
    });

    const payment = await tx.insertPayment(draft);
    const audit: AuditRecord = Object.freeze({
      actorIdentityId: context.actorIdentityId,
      tenantId: context.tenantId,
      locationId: context.locationId,
      actionKey: PAYMENT_RECORDED_ACTION,
      resourceType: "Payment",
      resourceId: payment.id,
      correlationId: context.correlationId,
      outcome: "success",
      metadata: Object.freeze({
        orderId: order.id,
        paymentMethod: input.paymentMethod,
        amount: draft.amount,
        currency: draft.currency,
        idempotencyKey: input.idempotencyKey,
        observedOrderTotalMinor: orderTotalMinor,
        observedEffectivePaidMinor: paidMinor,
        observedOutstandingMinor: outstandingMinor
      })
    });
    await tx.audit(audit);

    return Object.freeze({ payment, replayed: false });
  }, context);
}
