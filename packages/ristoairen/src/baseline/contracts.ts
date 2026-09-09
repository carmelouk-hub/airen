export const RISTOAIREN_DOMAIN_IDS = [
  "C001","C002","C003","C004","C005","C006","C007","C008","C009","C010",
  "C011","C012","C013","C014","C015","C016","C017","C018","C019","C020",
  "C021","C022","C023","C024","C025",
] as const;

export type RistoAirenDomainId = (typeof RISTOAIREN_DOMAIN_IDS)[number];

export type RecoveryAction = "REUSE" | "REFACTOR" | "REBUILD" | "NEW";

export type BaselineSourceRole =
  | "CANONICAL_PRODUCT_HOST"
  | "ENGINEERING_FOUNDATION"
  | "RECOVERY_DONOR_ONLY";

export interface RecoveryCandidate {
  readonly source: "ex-corte";
  readonly module: string;
  readonly domains: readonly RistoAirenDomainId[];
  readonly action: RecoveryAction;
  readonly acceptanceTests: readonly string[];
}

export interface RistoAirenBaselineContract {
  readonly schemaVersion: 1;
  readonly product: "RISTOAIREN";
  readonly platform: "AIRenOS";
  readonly domainIds: readonly RistoAirenDomainId[];
  readonly securityAuthority: "AIRenOS_SECURITY_CONTEXT";
  readonly applicationWriteAuthority: "RISTOAIREN_APPLICATION_SERVICES";
  readonly aiCoreWriteAuthority: "DENIED";
}
