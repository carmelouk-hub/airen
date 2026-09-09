import { AppError } from "../../../shared-contracts/src/index.ts";
import type { ProductionPriority, ProductionTicketStatus } from "./contracts.ts";

const NEXT: Readonly<Record<ProductionTicketStatus, readonly ProductionTicketStatus[]>> = Object.freeze({
  NEW: ["IN_PREPARATION", "CANCELLED"],
  IN_PREPARATION: ["READY", "CANCELLED"],
  READY: ["SERVED", "CANCELLED"],
  SERVED: [],
  CANCELLED: [],
});

export function assertProductionTransition(from: ProductionTicketStatus, to: ProductionTicketStatus): void {
  if (from === to) return;
  if (!NEXT[from]?.includes(to)) {
    throw new AppError("CONFLICT", `INVALID_PRODUCTION_TRANSITION:${from}->${to}`);
  }
}

export function validateProductionPriority(priority: string): ProductionPriority {
  if (priority === "NORMAL" || priority === "HIGH" || priority === "VIP") return priority;
  throw new AppError("VALIDATION_FAILED", "INVALID_PRODUCTION_PRIORITY");
}

export function assertFreshProductionVersion(current: number, requested: number): void {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new AppError("VALIDATION_FAILED", "ROW_VERSION_REQUIRED");
  }
  if (current !== requested) {
    throw new AppError("CONFLICT", "STALE_PRODUCTION_TICKET_VERSION");
  }
}
