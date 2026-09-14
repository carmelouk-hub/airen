import type {
  AirenPayDashboardProfile,
  AirenPayProviderReadinessState,
  AirenPayResponsibilityParty
} from "../../airenpay/src/index.ts";

export type StripeConnectAccountsV2MerchantCreateInput = Readonly<{
  environmentClass: "TEST";
  displayName: string;
  country: string;
  dashboardProfile: AirenPayDashboardProfile;
  feesResponsibility: AirenPayResponsibilityParty;
  lossesResponsibility: AirenPayResponsibilityParty;
  correlationId: string;
}>;

export type StripeConnectAccountsV2Snapshot = Readonly<{
  accountId: string;
  livemode: boolean;
  configurationRoles: readonly string[];
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  currentlyDue: readonly string[];
  pastDue: readonly string[];
  disabledReason?: string;
}>;

export type StripeConnectAccountsV2OnboardingSession = Readonly<{
  accountId: string;
  onboardingUrl: string;
  expiresAt: string;
}>;

export interface StripeConnectAccountsV2Transport {
  createMerchantAccount(input: StripeConnectAccountsV2MerchantCreateInput): Promise<StripeConnectAccountsV2Snapshot>;
  retrieveAccount(accountId: string): Promise<StripeConnectAccountsV2Snapshot>;
  createOnboardingSession(accountId: string, correlationId: string): Promise<StripeConnectAccountsV2OnboardingSession>;
}

export type StripeConnectAccountsV2Readiness = Readonly<{
  accountId: string;
  readinessState: AirenPayProviderReadinessState;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirements: readonly string[];
  disabledReason?: string;
}>;

export function normalizeStripeConnectAccountsV2Readiness(
  snapshot: StripeConnectAccountsV2Snapshot
): StripeConnectAccountsV2Readiness {
  if (snapshot.livemode) throw new Error("AIRENPAY_STRIPE_CONNECT_LIVE_FORBIDDEN");
  if (!snapshot.configurationRoles.includes("MERCHANT")) {
    throw new Error("AIRENPAY_STRIPE_CONNECT_MERCHANT_CONFIGURATION_REQUIRED");
  }

  const requirements = Object.freeze([...new Set([...snapshot.currentlyDue, ...snapshot.pastDue])]);
  let readinessState: AirenPayProviderReadinessState;

  if (snapshot.disabledReason) readinessState = "DISABLED";
  else if (requirements.length > 0) readinessState = "ACTION_REQUIRED";
  else if (snapshot.chargesEnabled && snapshot.payoutsEnabled) readinessState = "READY";
  else readinessState = "PENDING";

  return Object.freeze({
    accountId: snapshot.accountId,
    readinessState,
    chargesEnabled: snapshot.chargesEnabled,
    payoutsEnabled: snapshot.payoutsEnabled,
    requirements,
    ...(snapshot.disabledReason ? { disabledReason: snapshot.disabledReason } : {})
  });
}

export class AirenPayStripeConnectAccountsV2Adapter {
  private readonly transport: StripeConnectAccountsV2Transport;

  constructor(transport: StripeConnectAccountsV2Transport) {
    this.transport = transport;
  }

  async createSandboxMerchant(
    input: StripeConnectAccountsV2MerchantCreateInput
  ): Promise<Readonly<{ snapshot: StripeConnectAccountsV2Snapshot; readiness: StripeConnectAccountsV2Readiness }>> {
    if (input.environmentClass !== "TEST") throw new Error("AIRENPAY_STRIPE_CONNECT_TEST_ONLY");
    const snapshot = await this.transport.createMerchantAccount(input);
    return Object.freeze({ snapshot, readiness: normalizeStripeConnectAccountsV2Readiness(snapshot) });
  }

  async refreshReadiness(accountId: string): Promise<StripeConnectAccountsV2Readiness> {
    if (!accountId.trim()) throw new Error("AIRENPAY_STRIPE_CONNECT_ACCOUNT_ID_REQUIRED");
    return normalizeStripeConnectAccountsV2Readiness(await this.transport.retrieveAccount(accountId));
  }

  async createSandboxOnboardingSession(
    accountId: string,
    correlationId: string
  ): Promise<StripeConnectAccountsV2OnboardingSession> {
    const readiness = await this.refreshReadiness(accountId);
    if (readiness.readinessState === "READY") {
      throw new Error("AIRENPAY_STRIPE_CONNECT_ONBOARDING_NOT_REQUIRED");
    }
    const session = await this.transport.createOnboardingSession(accountId, correlationId);
    if (session.accountId !== accountId) throw new Error("AIRENPAY_STRIPE_CONNECT_ONBOARDING_ACCOUNT_MISMATCH");
    return session;
  }
}
