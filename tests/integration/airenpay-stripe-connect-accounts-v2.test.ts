import assert from "node:assert/strict";
import test from "node:test";

import {
  AirenPayStripeConnectAccountsV2Adapter,
  normalizeStripeConnectAccountsV2Readiness,
  type StripeConnectAccountsV2MerchantCreateInput,
  type StripeConnectAccountsV2Snapshot,
  type StripeConnectAccountsV2Transport
} from "../../packages/integrations/src/airenpay-stripe-connect-accounts-v2.ts";

function snapshot(overrides: Partial<StripeConnectAccountsV2Snapshot> = {}): StripeConnectAccountsV2Snapshot {
  return Object.freeze({
    accountId: "acct_test_tenant_a",
    livemode: false,
    configurationRoles: Object.freeze(["MERCHANT"]),
    chargesEnabled: false,
    payoutsEnabled: false,
    currentlyDue: Object.freeze([]),
    pastDue: Object.freeze([]),
    ...overrides
  });
}

class MockTransport implements StripeConnectAccountsV2Transport {
  readonly createdInputs: StripeConnectAccountsV2MerchantCreateInput[] = [];
  retrieveSnapshot: StripeConnectAccountsV2Snapshot = snapshot();

  async createMerchantAccount(input: StripeConnectAccountsV2MerchantCreateInput): Promise<StripeConnectAccountsV2Snapshot> {
    this.createdInputs.push(input);
    return this.retrieveSnapshot;
  }

  async retrieveAccount(_accountId: string): Promise<StripeConnectAccountsV2Snapshot> {
    return this.retrieveSnapshot;
  }

  async createOnboardingSession(accountId: string, _correlationId: string) {
    return Object.freeze({
      accountId,
      onboardingUrl: "https://example.invalid/mock-onboarding",
      expiresAt: "2026-09-14T12:00:00.000Z"
    });
  }
}

test("Accounts v2 readiness normalizes pending, action-required, ready and disabled states", () => {
  assert.equal(normalizeStripeConnectAccountsV2Readiness(snapshot()).readinessState, "PENDING");
  assert.equal(
    normalizeStripeConnectAccountsV2Readiness(snapshot({ currentlyDue: ["business_profile.url"] })).readinessState,
    "ACTION_REQUIRED"
  );
  assert.equal(
    normalizeStripeConnectAccountsV2Readiness(snapshot({ chargesEnabled: true, payoutsEnabled: true })).readinessState,
    "READY"
  );
  assert.equal(
    normalizeStripeConnectAccountsV2Readiness(snapshot({ disabledReason: "requirements.past_due" })).readinessState,
    "DISABLED"
  );
});

test("Accounts v2 adapter is TEST-only and freezes governed merchant responsibility input", async () => {
  const transport = new MockTransport();
  transport.retrieveSnapshot = snapshot({ currentlyDue: ["representative.first_name"] });
  const adapter = new AirenPayStripeConnectAccountsV2Adapter(transport);

  const result = await adapter.createSandboxMerchant({
    environmentClass: "TEST",
    displayName: "Synthetic Tenant A",
    country: "IT",
    dashboardProfile: "EXPRESS",
    feesResponsibility: "CONNECTED_MERCHANT",
    lossesResponsibility: "CONNECTED_MERCHANT",
    correlationId: "corr-043-a"
  });

  assert.equal(result.snapshot.livemode, false);
  assert.equal(result.readiness.readinessState, "ACTION_REQUIRED");
  assert.deepEqual(transport.createdInputs[0], {
    environmentClass: "TEST",
    displayName: "Synthetic Tenant A",
    country: "IT",
    dashboardProfile: "EXPRESS",
    feesResponsibility: "CONNECTED_MERCHANT",
    lossesResponsibility: "CONNECTED_MERCHANT",
    correlationId: "corr-043-a"
  });
});

test("Accounts v2 adapter fails closed on LIVE evidence or missing Merchant configuration", async () => {
  assert.throws(
    () => normalizeStripeConnectAccountsV2Readiness(snapshot({ livemode: true })),
    /AIRENPAY_STRIPE_CONNECT_LIVE_FORBIDDEN/
  );
  assert.throws(
    () => normalizeStripeConnectAccountsV2Readiness(snapshot({ configurationRoles: [] })),
    /AIRENPAY_STRIPE_CONNECT_MERCHANT_CONFIGURATION_REQUIRED/
  );
});

test("onboarding is allowed for action-required account and refused once ready", async () => {
  const transport = new MockTransport();
  const adapter = new AirenPayStripeConnectAccountsV2Adapter(transport);

  transport.retrieveSnapshot = snapshot({ currentlyDue: ["tos_acceptance.date"] });
  const session = await adapter.createSandboxOnboardingSession("acct_test_tenant_a", "corr-043-onboarding");
  assert.equal(session.accountId, "acct_test_tenant_a");

  transport.retrieveSnapshot = snapshot({ chargesEnabled: true, payoutsEnabled: true });
  await assert.rejects(
    () => adapter.createSandboxOnboardingSession("acct_test_tenant_a", "corr-043-ready"),
    /AIRENPAY_STRIPE_CONNECT_ONBOARDING_NOT_REQUIRED/
  );
});
