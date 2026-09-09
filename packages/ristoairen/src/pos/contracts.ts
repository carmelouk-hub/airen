import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";

export const CASH_REGISTER_STATUSES = ["OPEN", "CLOSING", "CLOSED"] as const;
export type CashRegisterStatus = (typeof CASH_REGISTER_STATUSES)[number];

export const SETTLEMENT_METHODS = ["CASH", "CARD", "MIXED", "OTHER"] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export type MoneyV1 = Readonly<{ amountMinor: number; currency: string }>;

export type CashRegisterSessionProjectionV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId: UUID;
  openedByIdentityId: UUID;
  status: CashRegisterStatus;
  openingFloat: MoneyV1;
  openedAt: string;
  closingStartedAt?: string;
  closedAt?: string;
  rowVersion: number;
}>;

export type PaymentAllocationV1 = Readonly<{
  method: SettlementMethod;
  amount: MoneyV1;
  externalPaymentReference?: string;
}>;

export type SettlementInputV1 = Readonly<{
  orderId: UUID;
  cashRegisterSessionId: UUID;
  allocations: readonly PaymentAllocationV1[];
  expectedOrderRowVersion: number;
}>;

export type RefundInputV1 = Readonly<{
  paymentId: UUID;
  amount?: MoneyV1;
  reason: string;
  expectedPaymentRowVersion: number;
}>;

export type ZReportProjectionV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId: UUID;
  cashRegisterSessionId: UUID;
  businessDate: string;
  grossSales: MoneyV1;
  refunds: MoneyV1;
  netSales: MoneyV1;
  paymentTotals: readonly PaymentAllocationV1[];
  orderCount: number;
  refundCount: number;
  generatedAt: string;
}>;

export interface PosProductAccessGuard {
  assertRistoAirenAccess(context: SecurityContext): void | Promise<void>;
}

export interface PosPaymentPort {
  collectExternalPayment(context: SecurityContext, input: PaymentAllocationV1, idempotencyKey: string): Promise<{ externalPaymentReference: string }>;
  refundExternalPayment(context: SecurityContext, externalPaymentReference: string, amount: MoneyV1 | undefined, idempotencyKey: string): Promise<void>;
}

export interface PosApplicationRepository {
  openSession(context: SecurityContext, openingFloat: MoneyV1): Promise<CashRegisterSessionProjectionV1>;
  settleOrder(context: SecurityContext, input: SettlementInputV1, idempotencyKey: string): Promise<{ paymentId: UUID; replayed: boolean }>;
  refundPayment(context: SecurityContext, input: RefundInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
  closeSessionAndGenerateZReport(context: SecurityContext, cashRegisterSessionId: UUID, expectedRowVersion: number, idempotencyKey: string): Promise<ZReportProjectionV1>;
}
