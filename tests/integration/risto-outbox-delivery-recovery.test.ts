import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTBOX_DELIVERY_FAILURE_REASON,
  dispatchNextOutboxMessage,
  type OutboxDeliveryAdapter,
  type OutboxDeliveryMessage,
  type OutboxDeliveryStatus,
  type OutboxDeliveryStore
} from "../../packages/integrations/src/outbox-delivery.ts";

type MutableRow = {
  id: string;
  tenantId: string;
  locationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payloadVersion: number;
  payload: Record<string, unknown>;
  correlationId: string;
  deliveryStatus: OutboxDeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  deliveredAt: string | null;
};

function row(): MutableRow {
  return {
    id: "outbox-1",
    tenantId: "tenant-1",
    locationId: "location-1",
    eventType: "SYNTHETIC_PROVIDER_DELIVERY_REQUESTED",
    aggregateType: "Payment",
    aggregateId: "payment-1",
    payloadVersion: 1,
    payload: { paymentId: "payment-1", amount: "30.00", currency: "EUR" },
    correlationId: "corr-1",
    deliveryStatus: "pending",
    attemptCount: 0,
    lastError: null,
    deliveredAt: null
  };
}

class MemoryOutboxStore implements OutboxDeliveryStore {
  readonly state: MutableRow;
  constructor(initial = row()) { this.state = initial; }

  async claimNext(): Promise<OutboxDeliveryMessage | null> {
    if (this.state.deliveryStatus !== "pending" && this.state.deliveryStatus !== "failed") return null;
    this.state.deliveryStatus = "processing";
    this.state.attemptCount += 1;
    return Object.freeze({
      id: this.state.id,
      tenantId: this.state.tenantId,
      locationId: this.state.locationId,
      eventType: this.state.eventType,
      aggregateType: this.state.aggregateType,
      aggregateId: this.state.aggregateId,
      payloadVersion: this.state.payloadVersion,
      payload: this.state.payload,
      correlationId: this.state.correlationId,
      attemptCount: this.state.attemptCount
    });
  }

  async markDelivered(messageId: string, deliveredAtIso: string): Promise<void> {
    assert.equal(messageId, this.state.id);
    assert.equal(this.state.deliveryStatus, "processing");
    this.state.deliveryStatus = "delivered";
    this.state.deliveredAt = deliveredAtIso;
    this.state.lastError = null;
  }

  async markFailed(
    messageId: string,
    outcome: Readonly<{ terminal: boolean; reasonCode: typeof OUTBOX_DELIVERY_FAILURE_REASON }>
  ): Promise<void> {
    assert.equal(messageId, this.state.id);
    assert.equal(this.state.deliveryStatus, "processing");
    this.state.deliveryStatus = outcome.terminal ? "dead_letter" : "failed";
    this.state.lastError = outcome.reasonCode;
  }
}

class SyntheticAdapter implements OutboxDeliveryAdapter {
  deliveries = 0;
  failuresRemaining: number;
  observed?: OutboxDeliveryMessage;

  constructor(failuresRemaining = 0) { this.failuresRemaining = failuresRemaining; }

  async deliver(message: OutboxDeliveryMessage): Promise<void> {
    this.deliveries += 1;
    this.observed = message;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("provider failure secret=SHOULD_NEVER_BE_PERSISTED");
    }
  }
}

const fixedNow = () => "2026-09-10T09:50:00.000Z";

test("successful delivery becomes terminal delivered and is not redelivered", async () => {
  const store = new MemoryOutboxStore();
  const adapter = new SyntheticAdapter();

  const first = await dispatchNextOutboxMessage({ store, adapter, now: fixedNow });
  assert.deepEqual(first, { status: "delivered", messageId: "outbox-1", attemptCount: 1 });
  assert.equal(store.state.deliveryStatus, "delivered");
  assert.equal(store.state.deliveredAt, fixedNow());

  const second = await dispatchNextOutboxMessage({ store, adapter, now: fixedNow });
  assert.deepEqual(second, { status: "empty" });
  assert.equal(adapter.deliveries, 1);
});

test("synthetic provider failure moves to failed and retry can recover", async () => {
  const store = new MemoryOutboxStore();
  const adapter = new SyntheticAdapter(1);

  const failed = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3, now: fixedNow });
  assert.equal(failed.status, "failed");
  assert.equal(store.state.deliveryStatus, "failed");
  assert.equal(store.state.attemptCount, 1);
  assert.equal(store.state.lastError, OUTBOX_DELIVERY_FAILURE_REASON);

  const recovered = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3, now: fixedNow });
  assert.equal(recovered.status, "delivered");
  assert.equal(store.state.deliveryStatus, "delivered");
  assert.equal(store.state.attemptCount, 2);
  assert.equal(adapter.deliveries, 2);
});

test("max attempts moves message to dead_letter and prevents further delivery", async () => {
  const store = new MemoryOutboxStore();
  const adapter = new SyntheticAdapter(10);

  assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "failed");
  assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "dead_letter");
  assert.equal(store.state.deliveryStatus, "dead_letter");
  assert.equal(store.state.attemptCount, 2);

  assert.equal((await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 2 })).status, "empty");
  assert.equal(adapter.deliveries, 2);
});

test("raw provider error text is never persisted", async () => {
  const store = new MemoryOutboxStore();
  const adapter = new SyntheticAdapter(1);

  await dispatchNextOutboxMessage({ store, adapter });
  assert.equal(store.state.lastError, "ADAPTER_DELIVERY_FAILED");
  assert.equal(store.state.lastError?.includes("SHOULD_NEVER_BE_PERSISTED"), false);
});

test("adapter receives an immutable detached payload view", async () => {
  const store = new MemoryOutboxStore();
  const adapter: OutboxDeliveryAdapter = {
    async deliver(message) {
      assert.equal(Object.isFrozen(message), true);
      assert.equal(Object.isFrozen(message.payload), true);
      assert.notEqual(message.payload, store.state.payload);
      assert.throws(() => {
        (message.payload as Record<string, unknown>).amount = "999.00";
      }, TypeError);
    }
  };

  await dispatchNextOutboxMessage({ store, adapter, now: fixedNow });
  assert.equal(store.state.payload.amount, "30.00");
});

test("invalid retry configuration fails before claiming an event", async () => {
  const store = new MemoryOutboxStore();
  const adapter = new SyntheticAdapter();

  await assert.rejects(
    dispatchNextOutboxMessage({ store, adapter, maxAttempts: 0 }),
    /OUTBOX_CONFIGURATION_INVALID/
  );
  assert.equal(store.state.attemptCount, 0);
  assert.equal(adapter.deliveries, 0);
});
