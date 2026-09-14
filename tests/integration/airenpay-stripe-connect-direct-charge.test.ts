import assert from "node:assert/strict";
import test from "node:test";

import type { AirenPayTrustedProviderConnectionV1 } from "../../packages/airenpay/src/index.ts";
import {
  AirenPayStripeConnectDirectChargeAdapter,
  type StripeConnectDirectChargeProviderCommand,
  type StripeConnectDirectChargeSnapshot,
  type StripeConnectDirectChargeTransport
} from "../../packages/integrations/src/airenpay-stripe-connect-direct-charge.ts";

function trustedConnection(
  tenantId: string,
  connectedAccountReference: string,
  overrides: Partial<AirenPayTrustedProviderConnectionV1["profile"]> = {}
): AirenPayTrustedProviderConnectionV1 {
  const connectionId = `${tenantId}-connection`;
  return Object.freeze({
    gateway: Object.freeze({
      id: connectionId,
      tenantId,
      providerType: "stripe",
      providerAccountReference: connectedAccountReference,
      capabilities: Object.freeze(["DEPOSIT_PAYMENT", "REFUND_PAYMENT"]),
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
      readinessState: "READY",
      ...overrides
    })
  });
}

class MockDirectChargeTransport implements StripeConnectDirectChargeTransport {
  readonly commands: StripeConnectDirectChargeProviderCommand[] = [];
  overrideReadBack?: Partial<StripeConnectDirectChargeSnapshot>;

  async createPaymentIntent(command: StripeConnectDirectChargeProviderCommand): Promise<StripeConnectDirectChargeSnapshot> {
    this.commands.push(command);
    return Object.freeze({
      connectedAccountReference: command.connectedAccountReference,
      paymentIntentId: `pi_mock_${this.commands.length}`,
      status: "SUCCEEDED",
      amountMinor: command.amountMinor,
      currency: command.currency,
      ...(command.applicationFeeMinor == null ? {} : { applicationFeeMinor: command.applicationFeeMinor }),
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
      status: "SUCCEEDED",
      amountMinor: command.amountMinor,
      currency: command.currency,
      ...(command.applicationFeeMinor == null ? {} : { applicationFeeMinor: command.applicationFeeMinor }),
      livemode: false,
      ...this.overrideReadBack
    });
  }
}

test("Direct Charge derives connected account only from trusted tenant connection", async () => {
  const transport = new MockDirectChargeTransport();
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(transport);

  const evidenceA = await adapter.createSandboxDirectCharge({
    trustedConnection: trustedConnection("tenant-a", "acct_test_tenant_a"),
    amountMinor: 12500,
    currency: "EUR",
    idempotencyKey: "tenant-a-payment-1",
    correlationId: "corr-a",
    applicationFee: { enabled: false }
  });
  const evidenceB = await adapter.createSandboxDirectCharge({
    trustedConnection: trustedConnection("tenant-b", "acct_test_tenant_b"),
    amountMinor: 8700,
    currency: "EUR",
    idempotencyKey: "tenant-b-payment-1",
    correlationId: "corr-b",
    applicationFee: { enabled: false }
  });

  assert.equal(transport.commands[0]?.connectedAccountReference, "acct_test_tenant_a");
  assert.equal(transport.commands[1]?.connectedAccountReference, "acct_test_tenant_b");
  assert.equal(evidenceA.readBack.connectedAccountReference, "acct_test_tenant_a");
  assert.equal(evidenceB.readBack.connectedAccountReference, "acct_test_tenant_b");
  assert.equal("connectedAccountReference" in ({ trustedConnection: trustedConnection("tenant-a", "acct_test_tenant_a") } as object), false);
});

test("Direct Charge application fee is governed, optional and bounded", async () => {
  const transport = new MockDirectChargeTransport();
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(transport);
  const connection = trustedConnection("tenant-a", "acct_test_tenant_a");

  await adapter.createSandboxDirectCharge({
    trustedConnection: connection,
    amountMinor: 10000,
    currency: "EUR",
    idempotencyKey: "fee-enabled",
    correlationId: "corr-fee",
    applicationFee: { enabled: true, amountMinor: 500 }
  });
  assert.equal(transport.commands[0]?.applicationFeeMinor, 500);

  await assert.rejects(
    () => adapter.createSandboxDirectCharge({
      trustedConnection: connection,
      amountMinor: 10000,
      currency: "EUR",
      idempotencyKey: "fee-disabled-invalid",
      correlationId: "corr-fee-invalid",
      applicationFee: { enabled: false, amountMinor: 500 }
    }),
    /AIRENPAY_DIRECT_CHARGE_FEE_DISABLED/
  );
});

test("Direct Charge fails closed on LIVE, wrong funds flow or unready connection", async () => {
  const transport = new MockDirectChargeTransport();
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(transport);
  const baseInput = {
    amountMinor: 1000,
    currency: "EUR",
    idempotencyKey: "fail-closed",
    correlationId: "corr-fail",
    applicationFee: { enabled: false }
  } as const;

  const live = trustedConnection("tenant-a", "acct_live_forbidden");
  const liveConnection = Object.freeze({
    gateway: Object.freeze({ ...live.gateway, mode: "LIVE" as const }),
    profile: Object.freeze({ ...live.profile, environmentClass: "LIVE" as const })
  });
  await assert.rejects(
    () => adapter.createSandboxDirectCharge({ ...baseInput, trustedConnection: liveConnection }),
    /AIRENPAY_DIRECT_CHARGE_TEST_ONLY/
  );

  await assert.rejects(
    () => adapter.createSandboxDirectCharge({
      ...baseInput,
      trustedConnection: trustedConnection("tenant-a", "acct_test_a", { fundsFlowProfile: "DESTINATION_CHARGES" })
    }),
    /AIRENPAY_DIRECT_CHARGE_FUNDS_FLOW_REQUIRED/
  );

  await assert.rejects(
    () => adapter.createSandboxDirectCharge({
      ...baseInput,
      trustedConnection: trustedConnection("tenant-a", "acct_test_a", { readinessState: "ACTION_REQUIRED" })
    }),
    /AIRENPAY_DIRECT_CHARGE_PROVIDER_NOT_READY/
  );
});

test("Direct Charge read-back rejects connected-account scope drift", async () => {
  const transport = new MockDirectChargeTransport();
  transport.overrideReadBack = { connectedAccountReference: "acct_test_tenant_b" };
  const adapter = new AirenPayStripeConnectDirectChargeAdapter(transport);

  await assert.rejects(
    () => adapter.createSandboxDirectCharge({
      trustedConnection: trustedConnection("tenant-a", "acct_test_tenant_a"),
      amountMinor: 2500,
      currency: "EUR",
      idempotencyKey: "scope-drift",
      correlationId: "corr-scope",
      applicationFee: { enabled: false }
    }),
    /AIRENPAY_DIRECT_CHARGE_ACCOUNT_SCOPE_MISMATCH/
  );
});
