import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";

export const PRODUCTION_TICKET_STATUSES = ["NEW", "IN_PREPARATION", "READY", "SERVED", "CANCELLED"] as const;
export type ProductionTicketStatus = (typeof PRODUCTION_TICKET_STATUSES)[number];

export const PRODUCTION_STATION_TYPES = ["KITCHEN", "BAR", "OTHER"] as const;
export type ProductionStationType = (typeof PRODUCTION_STATION_TYPES)[number];

export const PRODUCTION_PRIORITIES = ["NORMAL", "HIGH", "VIP"] as const;
export type ProductionPriority = (typeof PRODUCTION_PRIORITIES)[number];

export type ProductionLineInputV1 = Readonly<{
  sourceOrderItemId?: UUID;
  productId?: UUID;
  label: string;
  quantity: number;
  notes?: string;
  routingKey?: string;
}>;

export type ProductionTicketCreateInputV1 = Readonly<{
  orderId: UUID;
  stationId: UUID;
  stationType: ProductionStationType;
  sourceChannel: string;
  customerLabel?: string;
  tableLabel?: string;
  priority: ProductionPriority;
  lines: readonly ProductionLineInputV1[];
}>;

export type ProductionTicketProjectionV1 = Readonly<{
  id: UUID;
  orderId: UUID;
  stationId: UUID;
  stationType: ProductionStationType;
  status: ProductionTicketStatus;
  priority: ProductionPriority;
  sourceChannel: string;
  customerLabel?: string;
  tableLabel?: string;
  lines: readonly ProductionLineInputV1[];
  receivedAt: string;
  preparationStartedAt?: string;
  readyAt?: string;
  servedAt?: string;
  rowVersion: number;
}>;

export type ProductionTransitionInputV1 = Readonly<{
  requestedStatus: ProductionTicketStatus;
  rowVersion: number;
  reason?: string;
}>;

export type ProductionPriorityInputV1 = Readonly<{
  priority: ProductionPriority;
  rowVersion: number;
}>;

export interface ProductionRoutingPort {
  resolveStations(
    context: SecurityContext,
    lines: readonly ProductionLineInputV1[],
  ): Promise<readonly Readonly<{
    stationId: UUID;
    stationType: ProductionStationType;
    lineIndexes: readonly number[];
  }>[]>;
}

export interface ProductionMutationTransaction {
  findVisibleById(ticketId: UUID): Promise<ProductionTicketProjectionV1 | null>;
  insertTicket(context: SecurityContext, input: ProductionTicketCreateInputV1): Promise<ProductionTicketProjectionV1>;
  transitionStatus(context: SecurityContext, ticketId: UUID, input: ProductionTransitionInputV1): Promise<ProductionTicketProjectionV1>;
  updatePriority(context: SecurityContext, ticketId: UUID, input: ProductionPriorityInputV1): Promise<ProductionTicketProjectionV1>;
  appendAudit(event: Readonly<Record<string, unknown>>): Promise<void>;
  appendOutbox(event: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface ProductionUnitOfWork {
  transaction<T>(context: SecurityContext, fn: (tx: ProductionMutationTransaction) => Promise<T>): Promise<T>;
}
