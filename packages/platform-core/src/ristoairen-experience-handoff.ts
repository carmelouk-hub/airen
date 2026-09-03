import type { SecurityContext, UUID } from "../../shared-contracts/src/index.ts";

export const RISTOAIREN_HANDOFF_ISSUE_PATH = "/v1/products/ristoairen/attachment/handoff" as const;
export const RISTOAIREN_HANDOFF_EXCHANGE_PATH = "/v1/products/ristoairen/attachment/handoff/exchange" as const;
export const RISTOAIREN_HANDOFF_TTL_SECONDS = 60 as const;
export const RISTOAIREN_EXPERIENCE_PROJECTION_TTL_SECONDS = 60 as const;

export const RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT = Object.freeze({
  gateId: "RA-01" as const,
  authority: "AIRenOS" as const,
  transport: "one_time_launch_code" as const,
  handoffState: "wired_pending_runtime_proof" as const,
  launchCodeStorage: "sha256_only" as const,
  launchCodeSingleUse: true as const,
  launchCodeTtlSeconds: RISTOAIREN_HANDOFF_TTL_SECONDS,
  browserTransport: "url_fragment_only" as const,
  issueRequiresAirenOSSession: true as const,
  issueRequiresProductAccess: true as const,
  exchangeRequiresBase44Authority: false as const,
  projectionAuthoritativeForMutations: false as const,
  experienceAttachmentState: "not_attached" as const,
  experienceBusinessAuthority: false as const,
  base44MayAuthorizeProduct: false as const,
  productionEnabled: false as const,
});

export type RistoairenExperienceHandoffIssue = Readonly<{
  launchCode: string;
  expiresAtIso: string;
}>;

export type RistoairenExperienceHandoffProjection = Readonly<{
  handoffId: UUID;
  actorIdentityId: UUID;
  organizationId: UUID;
  tenantId: UUID;
  locationId: UUID;
  subscriptionId: UUID;
  productCode: "ristoairen";
  entitlementKey: "vertical.ristoairen";
  permissionKey: "ristoairen.access";
  issuedAtIso: string;
  consumedAtIso: string;
  projectionExpiresAtIso: string;
  sourceCorrelationId: string;
}>;

export interface RistoairenExperienceHandoffStore {
  issue(input: Readonly<{
    context: SecurityContext;
    organizationId: UUID;
    subscriptionId: UUID;
  }>): Promise<RistoairenExperienceHandoffIssue>;
  consume(launchCode: string): Promise<RistoairenExperienceHandoffProjection>;
}
