import type { UUID } from "../../shared-contracts/src/index.ts";
import type { TenantPaymentGatewayConnectionProjectionV1 } from "./contracts.ts";

export const AIRENPAY_PROVIDER_CONFIGURATION_ROLES = ["MERCHANT", "CUSTOMER", "RECIPIENT"] as const;
export type AirenPayProviderConfigurationRole = (typeof AIRENPAY_PROVIDER_CONFIGURATION_ROLES)[number];

export const AIRENPAY_FUNDS_FLOW_PROFILES = [
  "DIRECT_CHARGES",
  "DESTINATION_CHARGES",
  "SEPARATE_CHARGES_AND_TRANSFERS"
] as const;
export type AirenPayFundsFlowProfile = (typeof AIRENPAY_FUNDS_FLOW_PROFILES)[number];

export const AIRENPAY_DASHBOARD_PROFILES = ["NONE", "EXPRESS", "FULL"] as const;
export type AirenPayDashboardProfile = (typeof AIRENPAY_DASHBOARD_PROFILES)[number];

export const AIRENPAY_PROVIDER_READINESS_STATES = [
  "PENDING",
  "ACTION_REQUIRED",
  "READY",
  "DISABLED"
] as const;
export type AirenPayProviderReadinessState = (typeof AIRENPAY_PROVIDER_READINESS_STATES)[number];

export const AIRENPAY_RESPONSIBILITY_PARTIES = ["PROVIDER", "PLATFORM", "CONNECTED_MERCHANT"] as const;
export type AirenPayResponsibilityParty = (typeof AIRENPAY_RESPONSIBILITY_PARTIES)[number];

export type AirenPayProviderConnectionProfileV1 = Readonly<{
  connectionId: UUID;
  tenantId: UUID;
  locationId?: UUID;
  providerType: string;
  providerApiProfile: string;
  environmentClass: "TEST" | "LIVE";
  configurationRoles: readonly AirenPayProviderConfigurationRole[];
  fundsFlowProfile: AirenPayFundsFlowProfile;
  dashboardProfile: AirenPayDashboardProfile;
  feesResponsibility: AirenPayResponsibilityParty;
  lossesResponsibility: AirenPayResponsibilityParty;
  readinessState: AirenPayProviderReadinessState;
  secretReference?: string;
  webhookEndpointReference?: string;
  webhookSigningSecretReference?: string;
  lastReconciliationAt?: string;
}>;

export type AirenPayTrustedProviderConnectionV1 = Readonly<{
  gateway: TenantPaymentGatewayConnectionProjectionV1;
  profile: AirenPayProviderConnectionProfileV1;
}>;

export function assertTrustedProviderConnectionV1(connection: AirenPayTrustedProviderConnectionV1): void {
  if (connection.gateway.id !== connection.profile.connectionId) {
    throw new Error("AIRENPAY_PROVIDER_CONNECTION_ID_MISMATCH");
  }
  if (connection.gateway.tenantId !== connection.profile.tenantId) {
    throw new Error("AIRENPAY_PROVIDER_CONNECTION_TENANT_MISMATCH");
  }
  if ((connection.gateway.locationId ?? null) !== (connection.profile.locationId ?? null)) {
    throw new Error("AIRENPAY_PROVIDER_CONNECTION_LOCATION_MISMATCH");
  }
  if (connection.gateway.providerType !== connection.profile.providerType) {
    throw new Error("AIRENPAY_PROVIDER_CONNECTION_TYPE_MISMATCH");
  }
  if (connection.gateway.mode !== connection.profile.environmentClass) {
    throw new Error("AIRENPAY_PROVIDER_CONNECTION_ENVIRONMENT_MISMATCH");
  }
}
