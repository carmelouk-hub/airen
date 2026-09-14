import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRENPAY_FUNDS_FLOW_PROFILES,
  AIRENPAY_PROVIDER_CONFIGURATION_ROLES,
  AIRENPAY_RECONCILIATION_EVIDENCE_CHANNELS,
  AIRENPAY_RECONCILIATION_STATUSES,
  assertTrustedProviderConnectionV1,
  decideAirenPayReconciliationV1
} from "../../packages/airenpay/src/index.ts";

test("AIRenPay Connect contracts preserve approved provider-neutral profiles", () => {
  assert.deepEqual(AIRENPAY_PROVIDER_CONFIGURATION_ROLES, ["MERCHANT", "CUSTOMER", "RECIPIENT"]);
  assert.equal(AIRENPAY_FUNDS_FLOW_PROFILES[0], "DIRECT_CHARGES");
  assert.deepEqual(AIRENPAY_RECONCILIATION_EVIDENCE_CHANNELS, [
    "SYNCHRONOUS_API",
    "VERIFIED_WEBHOOK",
    "PROVIDER_READ_BACK"
  ]);
  assert.ok(AIRENPAY_RECONCILIATION_STATUSES.includes("MANUAL_REVIEW_REQUIRED"));
});

test("trusted provider connection fails closed on tenant or environment mismatch", () => {
  const base = {
    gateway: {
      id: "connection-a",
      tenantId: "tenant-a",
      providerType: "stripe",
      providerAccountReference: "acct_sandbox_a",
      capabilities: [],
      mode: "TEST",
      credentialSecretRef: "secret-ref",
      status: "ACTIVE",
      createdAt: "2026-09-14T00:00:00Z",
      updatedAt: "2026-09-14T00:00:00Z",
      rowVersion: 1
    },
    profile: {
      connectionId: "connection-a",
      tenantId: "tenant-a",
      providerType: "stripe",
      providerApiProfile: "accounts-v2",
      environmentClass: "TEST",
      configurationRoles: ["MERCHANT"],
      fundsFlowProfile: "DIRECT_CHARGES",
      dashboardProfile: "EXPRESS",
      feesResponsibility: "CONNECTED_MERCHANT",
      lossesResponsibility: "CONNECTED_MERCHANT",
      readinessState: "PENDING"
    }
  } as any;

  assert.doesNotThrow(() => assertTrustedProviderConnectionV1(base));
  assert.throws(
    () => assertTrustedProviderConnectionV1({ ...base, profile: { ...base.profile, tenantId: "tenant-b" } }),
    /AIRENPAY_PROVIDER_CONNECTION_TENANT_MISMATCH/
  );
  assert.throws(
    () => assertTrustedProviderConnectionV1({ ...base, profile: { ...base.profile, environmentClass: "LIVE" } }),
    /AIRENPAY_PROVIDER_CONNECTION_ENVIRONMENT_MISMATCH/
  );
});

test("reconciliation requires provider read-back and detects divergence", () => {
  const api = {
    channel: "SYNCHRONOUS_API",
    providerReference: "pi_test_1",
    observedStatus: "SUCCEEDED",
    observedAt: "2026-09-14T00:00:00Z",
    correlationId: "corr-1"
  } as const;
  const webhook = { ...api, channel: "VERIFIED_WEBHOOK" as const };
  const readBack = { ...api, channel: "PROVIDER_READ_BACK" as const };

  assert.deepEqual(decideAirenPayReconciliationV1([api, webhook]), {
    status: "PENDING",
    reason: "PROVIDER_READ_BACK_REQUIRED"
  });
  assert.deepEqual(decideAirenPayReconciliationV1([api, webhook, readBack]), { status: "IN_SYNC" });
  assert.deepEqual(
    decideAirenPayReconciliationV1([api, webhook, { ...readBack, observedStatus: "REFUNDED" }]),
    { status: "DIVERGED", reason: "EVIDENCE_STATUS_MISMATCH" }
  );
});
