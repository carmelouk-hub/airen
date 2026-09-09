import {
  RISTOAIREN_DOMAIN_IDS,
  type RistoAirenBaselineContract,
} from "./contracts.ts";

export const RISTOAIREN_BASELINE = {
  schemaVersion: 1,
  product: "RISTOAIREN",
  platform: "AIRenOS",
  domainIds: RISTOAIREN_DOMAIN_IDS,
  securityAuthority: "AIRenOS_SECURITY_CONTEXT",
  applicationWriteAuthority: "RISTOAIREN_APPLICATION_SERVICES",
  aiCoreWriteAuthority: "DENIED",
} as const satisfies RistoAirenBaselineContract;

export const RISTOAIREN_BASELINE_SOURCES = {
  canonicalProductHost: {
    role: "CANONICAL_PRODUCT_HOST",
    provider: "Base44",
    appId: "6a9034a05aadd6259d2d88e3",
  },
  engineeringFoundation: {
    role: "ENGINEERING_FOUNDATION",
    repository: "carmelouk-hub/airen",
    ref: "rbl/ristoairen-real-baseline-01-20260827",
    sha: "d055fba86d938aa38cee648171425046c7d972a4",
  },
  recoveryDonor: {
    role: "RECOVERY_DONOR_ONLY",
    provider: "Base44",
    appId: "6a6f34a3a69b01d00ee22a07",
    label: "ex-corte",
  },
} as const;

export const FORBIDDEN_DONOR_IMPORTS = [
  "venue_identity",
  "real_customer_or_staff_data",
  "tenant_authority",
  "plan_or_subscription_authority",
  "domain_authority",
  "role_or_membership_authority",
  "provider_truth",
  "raw_secrets",
] as const;

export const MATERIALIZATION_ORDER = [
  "AIRenOS_ATTACHMENT_AND_SECURITY_BOUNDARY",
  "CANONICAL_DATA_POLICY_SERVICE_SCAFFOLD",
  "SELECTIVE_HIGH_VALUE_RECOVERY",
  "MISSING_DOMAIN_IMPLEMENTATION",
  "CONTINUOUS_GJ2_ACCEPTANCE",
] as const;
