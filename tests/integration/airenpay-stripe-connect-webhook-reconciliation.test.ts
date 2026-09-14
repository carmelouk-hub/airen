import assert from "node:assert/strict";
import test from "node:test";

import type {
  AirenPayReconciliationEvidenceV1,
  AirenPayTrustedProviderConnectionV1
} from "../../packages/airenpay/src/index.ts";
import type { VerifiedProviderWebhookEvent } from "../../packages/integrations/src/webhook-replay.ts";
import {
  reconcileStripeConnectThreeChannelEvidenceV1,
  routeVerifiedStripeConnectWebhookV1,
  type AirenPayStripeConnectTenantResolver
} from "../../packages/integrations/src/airenpay-stripe-connect-webhook-reconciliation.ts";

function connection(
  tenantId: string,
  account: string,
  overrides: Partial<AirenPayTrustedProviderConnectionV1["gateway"]> = {}
): AirenPayTrustedProviderConnectionV1 {
  const id = `${tenantId}-connection`;
  return Object.freeze({
    gateway: Object.freeze({
      id,
      tenantId,
      providerType: "stripe",
      providerAccountReference: account,
      capabilities: Object.freeze(["DEPOSIT_PAYMENT", "WEBHOOK_VERIFICATION"]),
      mode: "TEST",
      credentialSecretRef: Object.freeze({ provider: "mock", key: "stripe-test-reference" }),
      status: "ACTIVE",
      createdAt: "2026-09-14T11:00:00.000Z",
      updatedAt: "2026-09-14T11:00:00.000Z",
      rowVersion: 1,
      ...overrides
    }),
    profile: Object.freeze({
      connectionId: id,
      tenantId,
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

class Resolver implements AirenPayStripeConnectTenantResolver {
  private readonly map: Readonly<Record<string, AirenPayTrustedProviderConnectionV1>>;

  constructor(map: Readonly<Record<string, AirenPayTrustedProviderConnectionV1>>) {
    this.map = map;
  }

  async resolveByProviderAccountReference(account: string): Promise<AirenPayTrustedProviderConnectionV1 | null> {
    return this.map[account] ?? null;
  }
}

function event(account: string, status = "succeeded", extras: Record<string, unknown> = {}): VerifiedProviderWebhookEvent {
  return Object.freeze({
    providerEventId: "evt_mock_1",
    eventType: "payment_intent.succeeded",
    providerPayload: Object.freeze({
      account,
      livemode: false,
      tenant_id: "attacker-controlled-tenant",
      data: Object.freeze({ object: Object.freeze({ id: "pi_mock_1", status }) }),
      ...extras
    })
  });
}

function evidence(
  channel: AirenPayReconciliationEvidenceV1["channel"],
  status: string,
  providerReference = "pi_mock_1"
): AirenPayReconciliationEvidenceV1 {
  return Object.freeze({
    channel,
    providerReference,
    observedStatus: status,
    observedAt: "2026-09-14T11:40:00.000Z",
    correlationId: "corr-045"
  });
}

test("verified Connect webhook derives tenant only from trusted account mapping", async () => {
  const trusted = connection("tenant-a", "acct_test_tenant_a");
  const routed = await routeVerifiedStripeConnectWebhookV1({
    event: event("acct_test_tenant_a"),
    resolver: new Resolver({ acct_test_tenant_a: trusted }),
    observedAt: "2026-09-14T11:40:00.000Z",
    correlationId: "corr-045-a"
  });

  assert.equal(routed.tenantId, "tenant-a");
  assert.equal(routed.providerConnectionId, "tenant-a-connection");
  assert.equal(routed.providerAccountReference, "acct_test_tenant_a");
  assert.equal(routed.evidence.channel, "VERIFIED_WEBHOOK");
  assert.equal(routed.providerReference, "pi_mock_1");
});

test("webhook routing fails closed on unknown account, scope drift and LIVE payload", async () => {
  const resolver = new Resolver({
    acct_test_tenant_a: connection("tenant-a", "acct_test_other")
  });

  await assert.rejects(
    () => routeVerifiedStripeConnectWebhookV1({
      event: event("acct_unknown"),
      resolver,
      observedAt: "2026-09-14T11:40:00.000Z",
      correlationId: "corr-unknown"
    }),
    /AIRENPAY_CONNECT_WEBHOOK_PROVIDER_ACCOUNT_UNMAPPED/
  );

  await assert.rejects(
    () => routeVerifiedStripeConnectWebhookV1({
      event: event("acct_test_tenant_a"),
      resolver,
      observedAt: "2026-09-14T11:40:00.000Z",
      correlationId: "corr-drift"
    }),
    /AIRENPAY_CONNECT_WEBHOOK_ACCOUNT_SCOPE_MISMATCH/
  );

  const liveEvent = Object.freeze({
    ...event("acct_test_tenant_a"),
    providerPayload: Object.freeze({
      account: "acct_test_tenant_a",
      livemode: true,
      data: Object.freeze({ object: Object.freeze({ id: "pi_live_forbidden", status: "succeeded" }) })
    })
  });
  await assert.rejects(
    () => routeVerifiedStripeConnectWebhookV1({
      event: liveEvent,
      resolver: new Resolver({ acct_test_tenant_a: connection("tenant-a", "acct_test_tenant_a") }),
      observedAt: "2026-09-14T11:40:00.000Z",
      correlationId: "corr-live"
    }),
    /AIRENPAY_CONNECT_WEBHOOK_LIVE_FORBIDDEN/
  );
});

test("three-channel reconciliation reports IN_SYNC only when statuses agree", async () => {
  const routed = await routeVerifiedStripeConnectWebhookV1({
    event: event("acct_test_tenant_a", "succeeded"),
    resolver: new Resolver({ acct_test_tenant_a: connection("tenant-a", "acct_test_tenant_a") }),
    observedAt: "2026-09-14T11:40:00.000Z",
    correlationId: "corr-sync"
  });

  const result = reconcileStripeConnectThreeChannelEvidenceV1({
    routedWebhook: routed,
    synchronous: evidence("SYNCHRONOUS_API", "succeeded"),
    readBack: evidence("PROVIDER_READ_BACK", "succeeded")
  });
  assert.equal(result.evidence.length, 3);
  assert.equal(result.decision.status, "IN_SYNC");
});

test("three-channel reconciliation reports divergence and rejects provider-reference drift", async () => {
  const routed = await routeVerifiedStripeConnectWebhookV1({
    event: event("acct_test_tenant_a", "processing"),
    resolver: new Resolver({ acct_test_tenant_a: connection("tenant-a", "acct_test_tenant_a") }),
    observedAt: "2026-09-14T11:40:00.000Z",
    correlationId: "corr-diverged"
  });

  const diverged = reconcileStripeConnectThreeChannelEvidenceV1({
    routedWebhook: routed,
    synchronous: evidence("SYNCHRONOUS_API", "processing"),
    readBack: evidence("PROVIDER_READ_BACK", "succeeded")
  });
  assert.equal(diverged.decision.status, "DIVERGED");
  assert.equal(diverged.decision.reason, "EVIDENCE_STATUS_MISMATCH");

  assert.throws(
    () => reconcileStripeConnectThreeChannelEvidenceV1({
      routedWebhook: routed,
      synchronous: evidence("SYNCHRONOUS_API", "processing", "pi_other"),
      readBack: evidence("PROVIDER_READ_BACK", "processing")
    }),
    /AIRENPAY_CONNECT_RECON_PROVIDER_REFERENCE_MISMATCH/
  );
});
