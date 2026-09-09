import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { MoneyV1, PaymentAllocationV1, RefundInputV1, SettlementInputV1 } from "./contracts.ts";

function assertMoney(value: MoneyV1): void {
  if (!Number.isInteger(value.amountMinor) || value.amountMinor < 0) throw new AppError("VALIDATION_FAILED", "INVALID_MONEY");
  if (!value.currency || value.currency.length !== 3) throw new AppError("VALIDATION_FAILED", "INVALID_CURRENCY");
}

export function requirePosWrite(context: SecurityContext): void {
  if (!context.tenantId || !context.locationId || !context.actorIdentityId) throw new AppError("FORBIDDEN", "MISSING_SECURITY_SCOPE");
}

export function validateSettlement(input: SettlementInputV1): SettlementInputV1 {
  if (!input.orderId || !input.cashRegisterSessionId) throw new AppError("VALIDATION_FAILED", "MISSING_SETTLEMENT_REFERENCE");
  if (!Number.isInteger(input.expectedOrderRowVersion) || input.expectedOrderRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_ORDER_ROW_VERSION");
  if (!input.allocations.length) throw new AppError("VALIDATION_FAILED", "EMPTY_PAYMENT_ALLOCATIONS");
  for (const allocation of input.allocations) assertMoney(allocation.amount);
  const currencies = new Set(input.allocations.map((allocation) => allocation.amount.currency));
  if (currencies.size !== 1) throw new AppError("VALIDATION_FAILED", "MIXED_CURRENCY_SETTLEMENT_NOT_ALLOWED");
  return Object.freeze({ ...input, allocations: Object.freeze(input.allocations.map((allocation: PaymentAllocationV1) => Object.freeze({ ...allocation, amount: Object.freeze({ ...allocation.amount }) }))) });
}

export function validateRefund(input: RefundInputV1): RefundInputV1 {
  if (!input.paymentId || !input.reason?.trim()) throw new AppError("VALIDATION_FAILED", "INVALID_REFUND_REQUEST");
  if (!Number.isInteger(input.expectedPaymentRowVersion) || input.expectedPaymentRowVersion < 0) throw new AppError("VALIDATION_FAILED", "INVALID_PAYMENT_ROW_VERSION");
  if (input.amount) assertMoney(input.amount);
  return Object.freeze({ ...input, reason: input.reason.trim() });
}
