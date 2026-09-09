import type {
  ProductionLineInputV1,
  ProductionPriority,
  ProductionStationType,
  ProductionTicketStatus,
} from "./contracts.ts";

export type DonorKitchenBarTicket = Readonly<{
  id?: string;
  fast_order_id?: string;
  tenant_id?: string;
  location_id?: string;
  status?: string;
  priority?: string;
  code?: string;
  customer_name?: string;
  table_label?: string;
  notes?: string;
  active?: boolean;
  items?: readonly unknown[];
  items_snapshot?: readonly unknown[];
  kind?: string;
  category?: string;
  bar_category?: string;
  receipt_at?: string;
  started_at?: string;
  ready_at?: string;
  served_at?: string;
}>;

export type PortableProductionIntent = Readonly<{
  stationType: ProductionStationType;
  sourceOrderReference?: string;
  sourceChannel: "DONOR_EVIDENCE";
  customerLabel?: string;
  tableLabel?: string;
  priority: ProductionPriority;
  status: ProductionTicketStatus;
  notes?: string;
  lines: readonly ProductionLineInputV1[];
}>;

const DONOR_ONLY_FIELDS = new Set([
  "id",
  "fast_order_id",
  "tenant_id",
  "location_id",
  "created_by_id",
  "stripe_payment_intent",
  "stripe_checkout_session_id",
]);

export function assertNoDonorAuthority(payload: Readonly<Record<string, unknown>>): void {
  for (const key of DONOR_ONLY_FIELDS) {
    if (payload[key] != null) {
      throw new Error(`DONOR_AUTHORITY_REJECTED:${key}`);
    }
  }
}

export function mapDonorProductionStatus(value?: string): ProductionTicketStatus {
  switch (String(value || "NUOVO").toUpperCase()) {
    case "NUOVO":
    case "NEW": return "NEW";
    case "IN_PREPARAZIONE":
    case "IN_PREPARATION": return "IN_PREPARATION";
    case "PRONTO":
    case "READY": return "READY";
    case "SERVITO":
    case "SERVED": return "SERVED";
    case "CANCELLED":
    case "ANNULLATO": return "CANCELLED";
    default: throw new Error(`UNSUPPORTED_DONOR_PRODUCTION_STATUS:${value}`);
  }
}

export function mapDonorPriority(value?: string): ProductionPriority {
  switch (String(value || "NORMALE").toUpperCase()) {
    case "VIP": return "VIP";
    case "ALTA":
    case "HIGH": return "HIGH";
    case "NORMALE":
    case "NORMAL": return "NORMAL";
    default: return "NORMAL";
  }
}

function normalizeLine(raw: any): ProductionLineInputV1 {
  const label = String(raw?.name ?? raw?.label ?? raw?.title ?? raw?.item_name ?? "").trim();
  if (!label) throw new Error("DONOR_PRODUCTION_LINE_LABEL_REQUIRED");
  const quantity = Math.max(1, Number.parseInt(String(raw?.qty ?? raw?.quantity ?? 1), 10) || 1);
  return Object.freeze({
    label,
    quantity,
    notes: raw?.notes ? String(raw.notes) : undefined,
    routingKey: raw?.bar_category ?? raw?.category ?? raw?.kind ?? undefined,
  });
}

export function recoverPortableProductionIntent(
  stationType: "KITCHEN" | "BAR",
  donor: DonorKitchenBarTicket,
): PortableProductionIntent {
  const source = donor.items_snapshot ?? donor.items ?? [];
  const lines = Array.isArray(source) ? source.map(normalizeLine) : [];
  if (!lines.length) throw new Error("DONOR_PRODUCTION_LINES_REQUIRED");

  return Object.freeze({
    stationType,
    sourceOrderReference: donor.fast_order_id ? "DONOR_ORDER_REFERENCE_PRESENT" : undefined,
    sourceChannel: "DONOR_EVIDENCE",
    customerLabel: donor.customer_name ? String(donor.customer_name) : undefined,
    tableLabel: donor.table_label ? String(donor.table_label) : undefined,
    priority: mapDonorPriority(donor.priority),
    status: donor.active === false && donor.status !== "SERVITO"
      ? "CANCELLED"
      : mapDonorProductionStatus(donor.status),
    notes: donor.notes ? String(donor.notes) : undefined,
    lines: Object.freeze(lines),
  });
}

export const DONOR_PRODUCTION_RECOVERY_RULES = Object.freeze({
  donor: "ex-corte",
  domains: ["C012"],
  reusablePatterns: [
    "realtime push board",
    "kitchen/bar split",
    "priority + FIFO presentation",
    "NEW→IN_PREPARATION→READY→SERVED lifecycle",
    "optimistic staff interaction",
    "derived ticket from canonical order",
  ],
  forbiddenAuthority: [
    "donor tenant/location ids",
    "FastOrder as new canonical order authority",
    "Stripe/webhook provider truth inside production Core",
    "direct entity mutation as authorization boundary",
    "legacy staff role hierarchy as platform authority",
  ],
  canonicalTarget: "ProductionTicket + ProductionStation + ProductionRoute + ProductionHandoffEvent",
  acceptance: ["GJ2-017", "GJ2-033", "GJ2-039"],
});
