import assert from "node:assert/strict";
import test from "node:test";

import type { AirenPayTrustedProviderConnectionV1 } from "../../packages/airenpay/src/index.ts";
import {
  AirenPayStripeConnectDirectChargeAdapter,
  type StripeConnectDirectChargeProviderCommand,
  type StripeConnectDirectChargeSnapshot,
  type StripeConnectDirectChargeTransport
} from "../../packages/integrations/src/airenpay-stripe-connect-direct-charge.ts";
import {
  drainConnectOutboxUntilTerminalV1,
  executeIdempotentStripeConnectDirectChargeV1,
  receiveOrRecoverStripeConnectWebhookV1,
  type AirenPayConnectIdempotencyReservation,
  type AirenPayConnectIdempotencyStore
} from "../../packages/integrations/src/airenpay-stripe-connect-resilience.ts";
import {
  receiveProviderWebhook,
  type ProviderWebhookRequest,
  type VerifiedProviderWebhookEvent,
  type WebhookReplayReservationStatus,
  type WebhookReplayStore
} from "../../packages/integrations/src/webhook-replay.ts";
import type {
  OutboxDeliveryMessage,
  OutboxDeliveryStore
} from "../../packages/integrations/src/outbox-delivery.ts";

function trustedConnection(): AirenPayTrustedProviderConnectionV1 {
  return Object.freeze({
    gateway: Object.freeze({
      id: "connection-tenant-a",
      tenantId: "tenant-a",
      providerType: "stripe",
      providerAccountReference: "acct_test_tenant_a",
      capabilities: Object.freeze(["DEPOSIT_PAYMENT", "WEBHOOK_VERIFICATION"]),
      mode: "TEST",
      credentialSecretRef: Object.freeze({ provider: "mock", key: "test-reference" }),
      status: "ACTIVE",
      createdAt: "2026-09-14T11:00:00.000Z",
      updatedAt: "2026-09-14T11:00:00.000Z",
      rowVersion: 1
    }),
    profile: Object.freeze({
      connectionId: "connection-tenant-a",
      tenantId: "tenant-a",
      providerType: "stripe",
      providerApiProfile: "accounts-v2",
      environmentClass: "TEST",
      configurationRoles: Object.freeze(["MERCHANT"]),
      fundsFlowProfile: "DIRECT_CHARGES",
      dashboardProfile: "EXPRESS",
      feesResponsibility: "CONNECTED_MERCHANT",
      lossesResponsibility: "CONNECTED_MERCHANT",
      readinessState: "READY"
    })
  });
}

class MockDirectChargeTransport implements StripeConnectDirectChargeTransport {
  createCount = 0;

  async createPaymentIntent(command: StripeConnectDirectChargeProviderCommand): Promise<StripeConnectDirectChargeSnapshot> {
    this.createCount += 1;
    return Object.freeze({
      connectedAccountReference: command.connectedAccountReference,
      paymentIntentId: "pi_resilience_047",
      status: "SUCCEEDED",
      amountMinor: command.amountMinor,
      currency: command.currency,
      livemode: false
    });
  }

  async retrievePaymentIntent(
    connectedAccountReference: string,
    paymentIntentId: string
  ): Promise<StripeConnectDirectChargeSnapshot> {
    return Object.freeze({
      connectedAccountReference,
      paymentIntentId,
      status: "SUCCEEDED",
      amountMinor: 2500,
      currency: "EUR",
      livemode: false
    });
  }
}

class MemoryIdempotencyStore implements AirenPayConnectIdempotencyStore {
  private readonly rows = new Map<string, AirenPayConnectIdempotencyReservation>();

  async reserve(input: Readonly<{ key: string; fingerprint: string }>): Promise<AirenPayConnectIdempotencyReservation> {
    const existing = this.rows.get(input.key);
    if (!existing) {
      const created = Object.freeze({ key: input.key, fingerprint: input.fingerprint, status: "NEW" as const });
      this.rows.set(input.key, Object.freeze({ ...created, status: "IN_FLIGHT" as const }));
      return created;
    }
    if (existing.fingerprint !== input.fingerprint) {
      return Object.freeze({ key: input.key, fingerprint: input.fingerprint, status: "CONFLICT" });
    }
    return existing;
  }

  async complete(input: Readonly<{ key: string; fingerprint: string; result: any }>): Promise<void> {
    const existing = this.rows.get(input.key);
    if (!existing || existing.fingerprint !== input.fingerprint) throw new Error("IDEMPOTENCY_COMPLETE_INVALID");
    this.rows.set(input.key, Object.freeze({
      key: input.key,
      fingerprint: input.fingerprint,
      status: "COMPLETED" as const,
      result: input.result
    }));
  }
}

class MemoryOutboxStore implements OutboxDeliveryStore {
  status: "pending" | "failed" | "delivered" | "dead_letter" = "pending";
  attemptCount = 0;
  readonly message: Omit<OutboxDeliveryMessage, "attemptCount"> = Object.freeze({
    id: "outbox-047",
    tenantId: "tenant-a",
    eventType: "airenpay.connect.payment",
    aggregateType: "payment",
    aggregateId: "payment-047",
    payloadVersion: 1,
    payload: Object.freeze({ providerConnectionId: "connection-tenant-a" }),
    correlationId: "corr-047-outbox"
  });

  async claimNext(): Promise<OutboxDeliveryMessage | null> {
    if (this.status === "delivered" || this.status === "dead_letter") return null;
    this.attemptCount += 1;
    return Object.freeze({ ...this.message, attemptCount: this.attemptCount });
  }

  async markDelivered(_messageId: string, _deliveredAtIso: string): Promise<void> {
    this.status = "delivered";
  }

  async markFailed(_messageId: string, outcome: Readonly<{ terminal: boolean; reasonCode: "ADAPTER_DELIVERY_FAILED" }>): Promise<void> {
    this.status = outcome.terminal ? "dead_letter" : "failed";
  }
}

class MemoryReplayStore implements WebhookReplayStore {
  private state: "none" | "in_flight" | "failed" | "processed" = "none";
  private digest = "";
  attemptCount = 0;

  async reserve(input: Readonly<{ providerKey: string; providerEventId: string; eventType: string; payloadDigest: string; receivedAt: string }>) {
    void input.providerKey; void input.providerEventId; void input.eventType; void input.receivedAt;
    if (this.state === "none") {
      this.state = "in_flight";
      this.digest = input.payloadDigest;
      this.attemptCount = 1;
      return Object.freeze({ receiptId: "receipt-047", status: "new" as WebhookReplayReservationStatus, attemptCount: 1 });
    }
    if (this.digest !== input.payloadDigest) {
      return Object.freeze({ receiptId: "receipt-047", status: "conflict" as WebhookReplayReservationStatus, attemptCount: this.attemptCount });
    }
    const status: WebhookReplayReservationStatus = this.state === "processed"
      ? "duplicate_processed"
      : this.state === "failed"
        ? "duplicate_failed"
        : "duplicate_in_flight";
    return Object.freeze({ receiptId: "receipt-047", status, attemptCount: this.attemptCount });
  }

  async markProcessed(_receiptId: string, _processedAt: string): Promise<boolean> {
    this.state = "processed";
    return true;
  }

  async markFailed(_receiptId: string): Promise<boolean> {
    this.state = "failed";
    return true;
  }

  async claimFailed(input: Readonly<{ providerKey: string; providerEventId: string; payloadDigest: string; attemptedAt: string }>) {
    void input.providerKey; void input.providerEventId; void input.attemptedAt;
    if (this.digest && this.digest !== input.payloadDigest) {
      return Object.freeze({ receiptId: "receipt-047", status: "conflict" as const, attemptCount: this.attemptCount });
    }
    if (this.state !== "failed") {
      return Object.freeze({ receiptId: "receipt-047", status: "duplicate_in_flight" as const, attemptCount: this.attemptCount });
    }
    this.state = "in_flight";
    this.attemptCount += 1;
    return Object.freeze({ receiptId: "receipt-047", status: "reconcile_claimed" as const, attemptCount: this.attemptCount });
  }
}

const webhookRequest: ProviderWebhookRequest = Object.freeze({
  rawBody: JSON.stringify({ id: "evt_047", account: "acct_test_tenant_a" }),
  headers: Object.freeze({ "stripe-signature": "mock-verified" })
});

const verifiedEvent: VerifiedProviderWebhookEvent = Object.freeze({
  providerEventId: "evt_047",
  eventType: "payment_intent.succeeded",
  providerPayload: Object.freeze({
    account: "acct_test_tenant_a",
    livemode: false,
    data: Object.freeze({ object: Object.freeze({ id: "pi_resilience_047", status: "SUCCEEDED" }) })
  })
});

test("idempotency replays completed Direct Charge without a second provider command and rejects fingerprint conflict", async () => {
  const transport = new MockDirectChargeTransport();
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(transport);
  const store = new MemoryIdempotencyStore();
  const base = {
    trustedConnection: trustedConnection(),
    directChargeAdapter: adapter,
    idempotencyStore: store,
    amountMinor: 2500,
    currency: "EUR",
    idempotencyKey: "tenant-a:payment-047",
    correlationId: "corr-047-charge",
    applicationFee: { enabled: false }
  } as const;

  const first = await executeIdempotentStripeConnectDirectChargeV1(base);
  const second = await executeIdempotentStripeConnectDirectChargeV1(base);
  assert.equal(first.status, "EXECUTED");
  assert.equal(second.status, "REPLAYED");
  assert.equal(transport.createCount, 1);
  assert.equal(second.evidence.synchronous.paymentIntentId, "pi_resilience_047");

  await assert.rejects(
    () => executeIdempotentStripeConnectDirectChargeV1({ ...base, amountMinor: 2600 }),
    /AIRENPAY_CONNECT_IDEMPOTENCY_CONFLICT/
  );
  assert.equal(transport.createCount, 1);
});

test("outbox retries transient failures, then delivers, and dead-letters after configured exhaustion", async () => {
  const recoverableStore = new MemoryOutboxStore();
  let calls = 0;
  const recovered = await drainConnectOutboxUntilTerminalV1({
    dependencies: {
      store: recoverableStore,
      maxAttempts: 3,
      now: () => "2026-09-14T12:00:00.000Z",
      adapter: {
        async deliver() {
          calls += 1;
          if (calls < 3) throw new Error("sanitized mock provider failure");
        }
      }
    },
    maxDispatches: 3
  });
  assert.deepEqual(recovered.map((item) => item.status), ["failed", "failed", "delivered"]);
  assert.equal(recoverableStore.status, "delivered");

  const deadLetterStore = new MemoryOutboxStore();
  const deadLettered = await drainConnectOutboxUntilTerminalV1({
    dependencies: {
      store: deadLetterStore,
      maxAttempts: 3,
      adapter: { async deliver() { throw new Error("sanitized mock provider failure"); } }
    },
    maxDispatches: 5
  });
  assert.deepEqual(deadLettered.map((item) => item.status), ["failed", "failed", "dead_letter"]);
  assert.equal(deadLetterStore.status, "dead_letter");
});

test("failed verified webhook can be reclaimed once, then duplicate replay is acknowledged without reprocessing", async () => {
  const replayStore = new MemoryReplayStore();
  let handlerCalls = 0;
  const dependencies = {
    providerKey: "stripe-connect-test",
    verifier: { async verify() { return verifiedEvent; } },
    replayStore,
    async handler() {
      handlerCalls += 1;
      if (handlerCalls === 1) throw new Error("mock handler failure");
    },
    now: () => "2026-09-14T12:00:00.000Z"
  };

  const recovered = await receiveOrRecoverStripeConnectWebhookV1({
    dependencies,
    request: webhookRequest,
    recoveryRequest: webhookRequest
  });
  assert.equal(recovered.failureCode, "WEBHOOK_PROCESSING_FAILED");
  assert.equal(recovered.recovered?.status, "processed");
  assert.equal(replayStore.attemptCount, 2);
  assert.equal(handlerCalls, 2);

  const duplicate = await receiveProviderWebhook(dependencies, webhookRequest);
  assert.equal(duplicate.status, "duplicate_acknowledged");
  assert.equal(handlerCalls, 2);
});

test("webhook replay digest conflict fails closed", async () => {
  const replayStore = new MemoryReplayStore();
  const dependencies = {
    providerKey: "stripe-connect-test",
    verifier: { async verify() { return verifiedEvent; } },
    replayStore,
    async handler() {},
    now: () => "2026-09-14T12:00:00.000Z"
  };

  await receiveProviderWebhook(dependencies, webhookRequest);
  await assert.rejects(
    () => receiveProviderWebhook(dependencies, Object.freeze({ ...webhookRequest, rawBody: "different-body" })),
    /WEBHOOK_REPLAY_DIGEST_CONFLICT/
  );
});
