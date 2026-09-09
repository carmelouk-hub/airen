import { AppError } from "../../../shared-contracts/src/index.ts";
import type { MoneyV1, PaymentAllocationV1, SettlementMethod } from "./contracts.ts";

export const POS_DONOR_FORBIDDEN_FIELDS = [
  "tenant_id", "location_id", "created_by_id", "stripe_payment_intent", "stripe_session_id", "stripe_customer_id",
  "provider_reference", "provider_account", "payment_method_token", "client_secret", "secret", "api_key", "authorization",
] as const;

export type DonorCashOrderIntent = Readonly<{
  order_total?: number | string;
  payment_method?: string;
  cash_amount?: number | string;
  card_amount?: number | string;
  [key: string]: unknown;
}>;

function rejectDonorAuthority(source: Readonly<Record<string, unknown>>): void {
  for (const field of POS_DONOR_FORBIDDEN_FIELDS) {
    if (source[field] !== undefined && source[field] !== null && source[field] !== "") {
      throw new AppError("VALIDATION_FAILED", `REC003_FORBIDDEN_DONOR_AUTHORITY:${field}`);
    }
  }
}

function minor(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new AppError("VALIDATION_FAILED", "REC003_INVALID_AMOUNT");
  return Math.round(n * 100);
}

function money(amountMinor: number): MoneyV1 { return Object.freeze({ amountMinor, currency: "EUR" }); }

export function mapDonorSettlementMethod(value: unknown): SettlementMethod {
  const v = String(value ?? "cash").trim().toLowerCase();
  if (["cash", "contanti", "contante"].includes(v)) return "CASH";
  if (["card", "carta", "stripe", "pos"].includes(v)) return "CARD";
  if (["mixed", "misto", "split"].includes(v)) return "MIXED";
  return "OTHER";
}

export function recoverPortableSettlementIntent(source: DonorCashOrderIntent): Readonly<{ method: SettlementMethod; allocations: readonly PaymentAllocationV1[] }> {
  rejectDonorAuthority(source);
  const method = mapDonorSettlementMethod(source.payment_method);
  const allocations: PaymentAllocationV1[] = [];
  if (method === "MIXED") {
    const cash = minor(source.cash_amount ?? 0); const card = minor(source.card_amount ?? 0);
    if (cash > 0) allocations.push(Object.freeze({ method: "CASH", amount: money(cash) }));
    if (card > 0) allocations.push(Object.freeze({ method: "CARD", amount: money(card) }));
    if (!allocations.length) throw new AppError("VALIDATION_FAILED", "REC003_EMPTY_MIXED_SETTLEMENT");
  } else {
    allocations.push(Object.freeze({ method, amount: money(minor(source.order_total ?? 0)) }));
  }
  return Object.freeze({ method, allocations: Object.freeze(allocations) });
}

export const REC003_POS_RECOVERY_EVIDENCE = Object.freeze({
  source: "ex-corte",
  donorPatterns: Object.freeze([
    "CassaSession open/close lifecycle", "CassaReport Z-report snapshot", "direct cash order workflow",
    "refund/void UX", "split operational views", "tenant-scoped session concept",
  ]),
  canonicalization: Object.freeze([
    "CashRegisterSession replaces donor CassaSession authority",
    "ZReport is immutable canonical fiscal/operational snapshot",
    "Payment/Allocation remains RISTOAIREN Core truth while AIRenPay/provider is an adapter boundary",
    "Stripe/FastOrder/provider identifiers are never imported as Core authority",
  ]),
  acceptanceTests: Object.freeze(["GJ2-018", "GJ2-019", "GJ2-035"]),
});
