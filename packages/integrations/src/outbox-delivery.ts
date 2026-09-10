export const OUTBOX_DELIVERY_FAILURE_REASON = "ADAPTER_DELIVERY_FAILED";

export type OutboxDeliveryStatus = "pending" | "processing" | "delivered" | "failed" | "dead_letter";

export type OutboxDeliveryMessage = Readonly<{
  id: string;
  tenantId?: string;
  locationId?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payloadVersion: number;
  payload: Readonly<Record<string, unknown>>;
  correlationId: string;
  /** Attempt number after the durable store has atomically claimed this delivery. */
  attemptCount: number;
}>;

export type OutboxDeliveryResult = Readonly<{
  status: "empty" | "delivered" | "failed" | "dead_letter";
  messageId?: string;
  attemptCount?: number;
}>;

/**
 * Durable outbox contract. claimNext MUST be atomic: an eligible pending/failed
 * row is moved to processing and attempt_count is incremented before it is
 * returned. delivered/dead_letter rows MUST NOT be claimable again.
 */
export interface OutboxDeliveryStore {
  claimNext(): Promise<OutboxDeliveryMessage | null>;
  markDelivered(messageId: string, deliveredAtIso: string): Promise<void>;
  markFailed(
    messageId: string,
    outcome: Readonly<{ terminal: boolean; reasonCode: typeof OUTBOX_DELIVERY_FAILURE_REASON }>
  ): Promise<void>;
}

/**
 * External delivery boundary only. An adapter receives an immutable DTO and
 * returns no domain state. Provider responses must never directly mutate Core.
 */
export interface OutboxDeliveryAdapter {
  deliver(message: OutboxDeliveryMessage): Promise<void>;
}

export type OutboxDispatcherDependencies = Readonly<{
  store: OutboxDeliveryStore;
  adapter: OutboxDeliveryAdapter;
  maxAttempts?: number;
  now?: () => string;
}>;

function validation(condition: boolean, message: string): void {
  if (!condition) throw new Error(`OUTBOX_CONFIGURATION_INVALID: ${message}`);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function immutableDeliveryView(message: OutboxDeliveryMessage): OutboxDeliveryMessage {
  const payload = structuredClone(message.payload) as Record<string, unknown>;
  return deepFreeze({ ...message, payload });
}

/**
 * Delivers at most one already-durable outbox message.
 *
 * Database work belongs to the store and must use short transactions. The
 * external adapter call occurs outside the domain transaction. Failure never
 * changes RISTOAIREN Core truth; only outbox delivery state is affected.
 */
export async function dispatchNextOutboxMessage(
  dependencies: OutboxDispatcherDependencies
): Promise<OutboxDeliveryResult> {
  const maxAttempts = dependencies.maxAttempts ?? 3;
  validation(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 100, "maxAttempts must be an integer between 1 and 100");

  const message = await dependencies.store.claimNext();
  if (!message) return Object.freeze({ status: "empty" });
  validation(Number.isInteger(message.attemptCount) && message.attemptCount >= 1, "claimed message attemptCount must be >= 1");

  const deliveryView = immutableDeliveryView(message);

  try {
    await dependencies.adapter.deliver(deliveryView);
    const deliveredAtIso = (dependencies.now ?? (() => new Date().toISOString()))();
    validation(Number.isFinite(Date.parse(deliveredAtIso)), "now() returned an invalid timestamp");
    await dependencies.store.markDelivered(message.id, deliveredAtIso);
    return Object.freeze({ status: "delivered", messageId: message.id, attemptCount: message.attemptCount });
  } catch {
    const terminal = message.attemptCount >= maxAttempts;
    // Never persist raw provider exceptions: they may contain secrets, tokens or PII.
    await dependencies.store.markFailed(message.id, {
      terminal,
      reasonCode: OUTBOX_DELIVERY_FAILURE_REASON
    });
    return Object.freeze({
      status: terminal ? "dead_letter" : "failed",
      messageId: message.id,
      attemptCount: message.attemptCount
    });
  }
}
