import assert from "node:assert/strict";
import test from "node:test";

import {
  FORBIDDEN_DONOR_IMPORTS,
  MATERIALIZATION_ORDER,
  RISTOAIREN_BASELINE,
  RISTOAIREN_BASELINE_SOURCES,
  RISTOAIREN_DOMAIN_IDS,
} from "../../packages/ristoairen/src/baseline/index.ts";

test("IMP-001 materializes the 25 governed RISTOAIREN domains", () => {
  assert.equal(RISTOAIREN_DOMAIN_IDS.length, 25);
  assert.equal(new Set(RISTOAIREN_DOMAIN_IDS).size, 25);
  assert.deepEqual(RISTOAIREN_BASELINE.domainIds, RISTOAIREN_DOMAIN_IDS);
});

test("IMP-001 preserves AIRenOS security authority and denies AI Core write authority", () => {
  assert.equal(RISTOAIREN_BASELINE.platform, "AIRenOS");
  assert.equal(RISTOAIREN_BASELINE.securityAuthority, "AIRenOS_SECURITY_CONTEXT");
  assert.equal(RISTOAIREN_BASELINE.applicationWriteAuthority, "RISTOAIREN_APPLICATION_SERVICES");
  assert.equal(RISTOAIREN_BASELINE.aiCoreWriteAuthority, "DENIED");
});

test("IMP-001 fixes the canonical host, engineering foundation and donor-only source", () => {
  assert.equal(RISTOAIREN_BASELINE_SOURCES.canonicalProductHost.appId, "6a9034a05aadd6259d2d88e3");
  assert.equal(RISTOAIREN_BASELINE_SOURCES.engineeringFoundation.sha, "d055fba86d938aa38cee648171425046c7d972a4");
  assert.equal(RISTOAIREN_BASELINE_SOURCES.recoveryDonor.appId, "6a6f34a3a69b01d00ee22a07");
  assert.equal(RISTOAIREN_BASELINE_SOURCES.recoveryDonor.role, "RECOVERY_DONOR_ONLY");
});

test("IMP-001 prevents wholesale legacy authority/data import", () => {
  for (const required of [
    "venue_identity",
    "real_customer_or_staff_data",
    "tenant_authority",
    "role_or_membership_authority",
    "provider_truth",
    "raw_secrets",
  ]) {
    assert.ok(FORBIDDEN_DONOR_IMPORTS.includes(required as (typeof FORBIDDEN_DONOR_IMPORTS)[number]));
  }
});

test("IMP-001 materialization order ends in continuous Golden Journey acceptance", () => {
  assert.equal(MATERIALIZATION_ORDER[0], "AIRenOS_ATTACHMENT_AND_SECURITY_BOUNDARY");
  assert.equal(MATERIALIZATION_ORDER.at(-1), "CONTINUOUS_GJ2_ACCEPTANCE");
});
