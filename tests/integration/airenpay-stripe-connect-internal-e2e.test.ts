import assert from "node:assert/strict";
import test from "node:test";

import type { AirenPayTrustedProviderConnectionV1 } from "../../packages/airenpay/src/index.ts";
import type { VerifiedProviderWebhookEvent } from "../../packages/integrations/src/webhook-replay.ts";
import {
  AirenPayStripeConnectDirectChargeAdapter,
  type StripeConnectDirectChargeProviderCommand,
  type StripeConnectDirectChargeSnapshot,
  type StripeConnectDirectChargeTransport
} from "../../packages/integrations/src/airenpay-stripe-connect-direct-charge.ts";
import type { AirenPayStripeConnectTenantResolver } from "../../packages/integrations/src/airenpay-stripe-connect-webhook-reconciliation.ts";
import { executeAirenPayStripeConnectInternalE2EV1 } from "../../packages/integrations/src/airenpay-stripe-connect-internal-e2e.ts";

function trustedConnection(
  tenantId: string,
  connectionId: string,
  account: string,
  readinessState: AirenPayTrustedProviderConnectionV1["profile"]["readinessState"] = "READY"
): AirenPayTrustedProviderConnectionV1 {
  return Object.freeze({
    gateway: Object.freeze({
      id: connectionId,
      tenantId,
      providerType: "stripe",
      providerAccountReference: account,
      capabilities: Object.freeze(["DEPOSIT_PAYMENT", "WEBHOOK_VERIFICATION"]),
      mode: "TEST",
      credentialSecretRef: Object.freeze({ provider: "mock", key: "stripe-test-reference" }),
      status: "ACTIVE",
      createdAt: "2026-09-14T11:00:00.000Z",
      updatedAt: "2026-09-14T11:00:00.000Z",
      rowVersion: 1
    }),
    profile: Object.freeze({
      connectionId,
      tenantId,
      providerType: "stripe",
      providerApiProfile: "accounts-v2",
      environmentClass: "TEST",
      configurationRoles: Object.freeze(["MERCHANT"]),
      fundsFlowProfile: "DIRECT_CHARGES",
      dashboardProfile: "EXPRESS",
      feesResponsibility: "CONNECTED_MERCHANT",
      lossesResponsibility: "CONNECTED_MERCHANT",
      readinessState
    })
  });
}

class MockDirectChargeTransport implements StripeConnectDirectChargeTransport {
  readonly commands: StripeConnectDirectChargeProviderCommand[] = [];

  async createPaymentIntent(command: StripeConnectDirectChargeProviderCommand): Promise<StripeConnectDirectChargeSnapshot> {
    this.commands.push(command);
    const suffix = command.connectedAccountReference.endsWith("_a") ? "a" : "b";
    return Object.freeze({
      connectedAccountReference: command.connectedAccountReference,
      paymentIntentId: `pi_mock_${suffix}`,
      status: "succeeded",
      amountMinor: command.amountMinor,
      currency: command.currency,
      livemode: false
    });
  }

  async retrievePaymentIntent(
    connectedAccountReference: string,
    paymentIntentId: string
  ): Promise<StripeConnectDirectChargeSnapshot> {
    const command = this.commands.find((item) => item.connectedAccountReference === connectedAccountReference);
    if (!command) throw new Error("MOCK_COMMAND_NOT_FOUND");
    return Object.freeze({
      connectedAccountReference,
      paymentIntentId,
      status: "succeeded",
      amountMinor: command.amountMinor,
      currency: command.currency,
      livemode: false
    });
  }
}

class Resolver implements AirenPayStripeConnectTenantResolver {
  private readonly map: Readonly<Record<string, AirenPayTrustedProviderConnectionV1>>;

  constructor(map: Readonly<Record<string, AirenPayTrustedProviderConnectionV1>>) {
    this.map = map;
  }

  async resolveByProviderAccountReference(account: string): Promise<AirenPayTrustedProviderConnectionV1 | null> {
    return this.map[account] ?? null;
  }
}

function webhook(account: string, paymentIntentId: string, status = "succeeded"): VerifiedProviderWebhookEvent {
  return Object.freeze({
    providerEventId: `evt_${account}`,
    eventType: "payment_intent.succeeded",
    providerPayload: Object.freeze({
      account,
      livemode: false,
      tenant_id: "untrusted-provider-payload-value",
      data: Object.freeze({ object: Object.freeze({ id: paymentIntentId, status }) })
    })
  });
}

test("two synthetic tenants complete isolated internal Connect E2E and reconcile IN_SYNC", async () => {
  const tenantA = trustedConnection("tenant-a", "conn-a", "acct_test_tenant_a");
  const tenantB = trustedConnection("tenant-b", "conn-b", "acct_test_tenant_b");
  const resolver = new Resolver({
    acct_test_tenant_a: tenantA,
    acct_test_tenant_b: tenantB
  });
  const transport = new MockDirectChargeTransport();
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(transport);

  const resultA = await executeAirenPayStripeConnectInternalE2EV1({
    expectedTenantId: "tenant-a",
    trustedConnection: tenantA,
    directChargeAdapter: adapter,
    resolver,
    verifiedWebhookEvent: webhook("acct_test_tenant_a", "pi_mock_a"),
    amountMinor: 12000,
    currency: "EUR",
    idempotencyKey: "tenant-a-order-1",
    correlationId: "corr-046-a",
    observedAt: "2026-09-14T12:00:00.000Z",
    applicationFee: { enabled: false }
  });

  const resultB = await executeAirenPayStripeConnectInternalE2EV1({
    expectedTenantId: "tenant-b",
    trustedConnection: tenantB,
    directChargeAdapter: adapter,
    resolver,
    verifiedWebhookEvent: webhook("acct_test_tenant_b", "pi_mock_b"),
    amountMinor: 9800,
    currency: "EUR",
    idempotencyKey: "tenant-b-order-1",
    correlationId: "corr-046-b",
    observedAt: "2026-09-14T12:01:00.000Z",
    applicationFee: { enabled: true, amountMinor: 490 }
  });

  assert.equal(resultA.tenantId, "tenant-a");
  assert.equal(resultA.providerAccountReference, "acct_test_tenant_a");
  assert.equal(resultA.reconciliation.decision.status, "IN_SYNC");
  assert.equal(resultB.tenantId, "tenant-b");
  assert.equal(resultB.providerAccountReference, "acct_test_tenant_b");
  assert.equal(resultB.reconciliation.decision.status, "IN_SYNC");
  assert.deepEqual(transport.commands.map((item) => item.connectedAccountReference), [
    "acct_test_tenant_a",
    "acct_test_tenant_b"
  ]);
});

test("internal E2E rejects trusted tenant mismatch before any mock provider command", async () => {
  const tenantA = trustedConnection("tenant-a", "conn-a", "acct_test_tenant_a");
  const transport = new MockDirectChargeTransport();
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(transport);

  await assert.rejects(
    () => executeAirenPayStripeConnectInternalE2EV1({
      expectedTenantId: "tenant-b",
      trustedConnection: tenantA,
      directChargeAdapter: adapter,
      resolver: new Resolver({ acct_test_tenant_a: tenantA }),
      verifiedWebhookEvent: webhook("acct_test_tenant_a", "pi_mock_a"),
      amountMinor: 1000,
      currency: "EUR",
      idempotencyKey: "cross-tenant",
      correlationId: "corr-cross-tenant",
      observedAt: "2026-09-14T12:02:00.000Z",
      applicationFee: { enabled: false }
    }),
    /AIRENPAY_CONNECT_INTERNAL_E2E_TRUSTED_TENANT_MISMATCH/
  );
  assert.equal(transport.commands.length, 0);
});

test("internal E2E rejects webhook account/tenant drift and unready connection", async () => {
  const tenantA = trustedConnection("tenant-a", "conn-a", "acct_test_tenant_a");
  const tenantB = trustedConnection("tenant-b", "conn-b", "acct_test_tenant_b");
  const resolver = new Resolver({
    acct_test_tenant_a: tenantA,
    acct_test_tenant_b: tenantB
  });
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(new MockDirectChargeTransport());

  await assert.rejects(
    () => executeAirenPayStripeConnectInternalE2EV1({
      expectedTenantId: "tenant-a",
      trustedConnection: tenantA,
      directChargeAdapter: adapter,
      resolver,
      verifiedWebhookEvent: webhook("acct_test_tenant_b", "pi_mock_b"),
      amountMinor: 1500,
      currency: "EUR",
      idempotencyKey: "drift",
      correlationId: "corr-drift",
      observedAt: "2026-09-14T12:03:00.000Z",
      applicationFee: { enabled: false }
    }),
    /AIRENPAY_CONNECT_INTERNAL_E2E_WEBHOOK_TENANT_MISMATCH/
  );

  const unready = trustedConnection("tenant-a", "conn-a-pending", "acct_test_pending_a", "ACTION_REQUIRED");
  await assert.rejects(
    () => executeAirenPayStripeConnectInternalE2EV1({
      expectedTenantId: "tenant-a",
      trustedConnection: unready,
      directChargeAdapter: adapter,
      resolver: new Resolver({ acct_test_pending_a: unready }),
      verifiedWebhookEvent: webhook("acct_test_pending_a", "pi_mock_a"),
      amountMinor: 2000,
      currency: "EUR",
      idempotencyKey: "unready",
      correlationId: "corr-unready",
      observedAt: "2026-09-14T12:04:00.000Z",
      applicationFee: { enabled: false }
    }),
    /AIRENPAY_DIRECT_CHARGE_PROVIDER_NOT_READY/
  );
});

test("internal E2E surfaces three-channel divergence", async () => {
  const tenantA = trustedConnection("tenant-a", "conn-a", "acct_test_tenant_a");
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(new MockDirectChargeTransport());
  const result = await executeAirenPayStripeConnectInternalE2EV1({
    expectedTenantId: "tenant-a",
    trustedConnection: tenantA,
    directChargeAdapter: adapter,
    resolver: new Resolver({ acct_test_tenant_a: tenantA }),
    verifiedWebhookEvent: webhook("acct_test_tenant_a", "pi_mock_a", "processing"),
    amountMinor: 3000,
    currency: "EUR",
    idempotencyKey: "diverged",
    correlationId: "corr-diverged",
    observedAt: "2026-09-14T12:05:00.000Z",
    applicationFee: { enabled: false }
  });

  assert.equal(result.reconciliation.decision.status, "DIVERGED");
  assert.equal(result.reconciliation.decision.reason, "EVIDENCE_STATUS_MISMATCH");
});
