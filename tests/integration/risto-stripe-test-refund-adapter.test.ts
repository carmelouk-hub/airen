import assert from "node:assert/strict";
import test from "node:test";
import { EnvironmentSecretProvider } from "../../packages/integrations/src/index.ts";
import { dispatchNextOutboxMessage, type OutboxDeliveryMessage, type OutboxDeliveryStore } from "../../packages/integrations/src/outbox-delivery.ts";
import { RistoStripeTestRefundAdapter } from "../../packages/integrations/src/risto-stripe-test-refund-adapter.ts";

const TEST_KEY_REF = Object.freeze({ provider: "env", key: "STRIPE_TEST_SECRET_KEY" });

function message(overrides: Partial<OutboxDeliveryMessage> = {}): OutboxDeliveryMessage {
  return Object.freeze({
    id: "00000000-0000-4000-8000-000000000025",
    tenantId: "10000000-0000-4000-8000-000000000001",
    locationId: "20000000-0000-4000-8000-000000000001",
    eventType: "RISTOAIREN_PROVIDER_REFUND_REQUESTED",
    aggregateType: "ProviderRefundSaga",
    aggregateId: "30000000-0000-4000-8000-000000000001",
    payloadVersion: 1,
    payload: Object.freeze({
      providerKey: "stripe",
      providerSourceReference: "pi_test_mat025_source",
      refundRequestId: "40000000-0000-4000-8000-000000000001",
      refundPaymentId: "50000000-0000-4000-8000-000000000001",
      amount: "12.34",
      currency: "EUR",
      idempotencyKey: "provider-refund:stripe:50000000-0000-4000-8000-000000000001"
    }),
    correlationId: "mat025-correlation",
    attemptCount: 1,
    ...overrides
  });
}

function testSecretProvider(value = "sk_test_mat025_only") {
  return new EnvironmentSecretProvider({ STRIPE_TEST_SECRET_KEY: value }, ["STRIPE_TEST_SECRET_KEY"]);
}

function stripeRefundResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "re_test_mat025",
    status: "succeeded",
    payment_intent: "pi_test_mat025_source",
    amount: 1234,
    currency: "eur",
    ...overrides
  };
}

test("MAT-025 Stripe TEST refund adapter contract", async t => {
  await t.test("builds one TEST refund request exclusively from canonical MAT-024 outbox material", async () => {
    let call: { url: string; init?: RequestInit } | undefined;
    const adapter = new RistoStripeTestRefundAdapter({
      secretProvider: testSecretProvider(),
      credentialSecretRef: TEST_KEY_REF,
      fetchImpl: async (input, init) => {
        call = { url: String(input), init };
        return new Response(JSON.stringify(stripeRefundResponse()), { status: 200 });
      }
    });

    await adapter.deliver(message());
    assert.ok(call);
    assert.equal(call.url, "https://api.stripe.com/v1/refunds");
    assert.equal(call.init?.method, "POST");
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers["Idempotency-Key"], "provider-refund:stripe:50000000-0000-4000-8000-000000000001");
    assert.equal(headers.Authorization, "Bearer sk_test_mat025_only");
    const body = new URLSearchParams(String(call.init?.body));
    assert.equal(body.get("payment_intent"), "pi_test_mat025_source");
    assert.equal(body.get("amount"), "1234");
    assert.equal(body.get("tenant_id"), null);
    assert.equal(body.get("location_id"), null);
    assert.equal(body.get("refund_request_id"), null);
  });

  await t.test("deterministic retry reuses exactly the same Stripe idempotency key and financial intent", async () => {
    const calls: Array<{ key: string | undefined; body: string }> = [];
    const adapter = new RistoStripeTestRefundAdapter({
      secretProvider: testSecretProvider(),
      credentialSecretRef: TEST_KEY_REF,
      fetchImpl: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        calls.push({ key: headers["Idempotency-Key"], body: String(init?.body) });
        return new Response(JSON.stringify(stripeRefundResponse()), { status: 200 });
      }
    });
    await adapter.deliver(message());
    await adapter.deliver(message({ attemptCount: 2 }));
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
  });

  await t.test("tampered idempotency fails closed before provider I/O", async () => {
    let called = false;
    const base = message();
    const adapter = new RistoStripeTestRefundAdapter({
      secretProvider: testSecretProvider(),
      credentialSecretRef: TEST_KEY_REF,
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }
    });
    const tampered = message({ payload: Object.freeze({ ...base.payload, idempotencyKey: "attacker-key" }) });
    await assert.rejects(() => adapter.deliver(tampered), /idempotency key does not match canonical saga identity/);
    assert.equal(called, false);
  });

  await t.test("LIVE credential is rejected before provider I/O", async () => {
    let called = false;
    const adapter = new RistoStripeTestRefundAdapter({
      secretProvider: testSecretProvider("sk_live_forbidden_mat025"),
      credentialSecretRef: TEST_KEY_REF,
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }
    });
    await assert.rejects(() => adapter.deliver(message()), /rejected non-TEST credential material/);
    assert.equal(called, false);
  });

  await t.test("explicit LIVE provider response is rejected", async () => {
    const adapter = new RistoStripeTestRefundAdapter({
      secretProvider: testSecretProvider(),
      credentialSecretRef: TEST_KEY_REF,
      fetchImpl: async () => new Response(JSON.stringify(stripeRefundResponse({ livemode: true })), { status: 200 })
    });
    await assert.rejects(() => adapter.deliver(message()), /LIVE refund response rejected/);
  });

  await t.test("provider response cannot change source, amount or currency", async () => {
    for (const changed of [
      { payment_intent: "pi_attacker" },
      { amount: 9999 },
      { currency: "usd" }
    ]) {
      const adapter = new RistoStripeTestRefundAdapter({
        secretProvider: testSecretProvider(),
        credentialSecretRef: TEST_KEY_REF,
        fetchImpl: async () => new Response(JSON.stringify(stripeRefundResponse(changed)), { status: 200 })
      });
      await assert.rejects(() => adapter.deliver(message()), /does not match canonical intent/);
    }
  });

  await t.test("raw provider error text is not surfaced and dispatcher persists only sanitized failure reason", async () => {
    const leaked = "secret-cardholder-message-MAT025";
    const adapter = new RistoStripeTestRefundAdapter({
      secretProvider: testSecretProvider(),
      credentialSecretRef: TEST_KEY_REF,
      fetchImpl: async () => new Response(JSON.stringify({ error: { type: "card_error", code: "card_declined", message: leaked } }), { status: 402 })
    });
    await assert.rejects(async () => {
      try { await adapter.deliver(message()); }
      catch (error) {
        assert.equal(String(error).includes(leaked), false);
        assert.equal(JSON.stringify(error).includes(leaked), false);
        throw error;
      }
    }, /Stripe TEST refund provider rejected the request/);

    let failure: { terminal: boolean; reasonCode: string } | undefined;
    const store: OutboxDeliveryStore = {
      async claimNext() { return message(); },
      async markDelivered() { throw new Error("unexpected delivered"); },
      async markFailed(_id, outcome) { failure = outcome; }
    };
    const result = await dispatchNextOutboxMessage({ store, adapter, maxAttempts: 3 });
    assert.deepEqual(result, { status: "failed", messageId: message().id, attemptCount: 1 });
    assert.deepEqual(failure, { terminal: false, reasonCode: "ADAPTER_DELIVERY_FAILED" });
    assert.equal(JSON.stringify(failure).includes(leaked), false);
  });
});
