import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";
import type { PublicTenantResolverPort, ResolvedPublicTenantV1 } from "../public-content/contracts.ts";

export const LOYALTY_VOUCHER_PERMISSIONS = Object.freeze({
  loyaltyMutate: "loyalty.value.mutate",
  voucherMutate: "voucher.value.mutate",
} as const);

export const PUBLIC_LOYALTY_VOUCHER_IDENTITY_ID = "00000000-0000-4000-8000-000000000003";

export type LoyaltyMutationInputV1 = Readonly<{
  customerPassId: UUID;
  points: number;
  reason: string;
}>;

export type VoucherIssueInputV1 = Readonly<{
  customerPassId: UUID;
  publicReference: string;
  label: string;
  currency: string;
  valueMinor: number;
  reason: string;
  expiresAt?: string;
}>;

export type VoucherRedeemInputV1 = Readonly<{
  publicReference: string;
  valueMinor: number;
  reason: string;
}>;

export type PublicVoucherProjectionV1 = Readonly<{
  reference: string;
  label: string;
  currency: string;
  issuedValueMinor: number;
  redeemedValueMinor: number;
  remainingValueMinor: number;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED" | "CANCELLED";
  expiresAt?: string;
}>;

export type PublicLoyaltyVoucherProjectionV1 = Readonly<{
  loyaltyPoints: number;
  vouchers: readonly PublicVoucherProjectionV1[];
}>;

export interface LoyaltyVoucherRepository {
  appendLoyalty(context: SecurityContext, input: LoyaltyMutationInputV1, kind: "EARN" | "REDEEM", idempotencyKey: string): Promise<{ replayed: boolean; loyaltyPoints: number }>;
  issueVoucher(context: SecurityContext, input: VoucherIssueInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
  redeemVoucher(context: SecurityContext, input: VoucherRedeemInputV1, idempotencyKey: string): Promise<{ replayed: boolean }>;
  readOwnedProjection(scope: ResolvedPublicTenantV1, credentialHash: string, correlationId: string): Promise<PublicLoyaltyVoucherProjectionV1 | null>;
}

export type LoyaltyVoucherDependencies = Readonly<{
  tenantResolver: PublicTenantResolverPort;
  repository: LoyaltyVoucherRepository;
}>;
