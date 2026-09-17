import { createHash } from "node:crypto";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import { requirePermission } from "../../../authorization/src/index.ts";
import type {
  LoyaltyMutationInputV1,
  LoyaltyVoucherDependencies,
  PublicLoyaltyVoucherProjectionV1,
  VoucherIssueInputV1,
  VoucherRedeemInputV1,
} from "./contracts.ts";
import { LOYALTY_VOUCHER_PERMISSIONS } from "./contracts.ts";

const CLIENT_SCOPE_KEYS = new Set(["tenantId", "tenant_id", "locationId", "location_id"]);
function rejectClientScope(input: object): void {
  for (const key of Object.keys(input)) if (CLIENT_SCOPE_KEYS.has(key)) throw new AppError("TENANT_SCOPE_VIOLATION", "Client Tenant/Location scope is not authoritative");
}
function idempotencyKey(value: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError("VALIDATION_FAILED", "Idempotency key is required");
  if (normalized.length > 200) throw new AppError("VALIDATION_FAILED", "Idempotency key is too long");
  return normalized;
}
function reason(value: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 240) throw new AppError("VALIDATION_FAILED", "Reason is required and must be <= 240 chars");
  return normalized;
}
function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AppError("VALIDATION_FAILED", `${field} must be a positive integer`);
  return value;
}
function currency(value: string): string {
  const normalized = value?.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new AppError("VALIDATION_FAILED", "currency must be ISO-style three uppercase letters");
  return normalized;
}
function credentialHash(credential: string): string {
  const normalized = credential?.trim();
  if (!normalized) throw new AppError("AUTHENTICATION_REQUIRED", "Self-service credential is required");
  let bytes: Buffer;
  try { bytes = Buffer.from(normalized, "base64url"); } catch { throw new AppError("AUTHENTICATION_REQUIRED", "Invalid self-service credential"); }
  if (bytes.length < 24) throw new AppError("AUTHENTICATION_REQUIRED", "Invalid self-service credential");
  return createHash("sha256").update(bytes).digest("hex");
}

export class LoyaltyVoucherApplicationService {
  constructor(private readonly deps: LoyaltyVoucherDependencies) {}

  async earn(context: SecurityContext, input: LoyaltyMutationInputV1, key: string) {
    requirePermission(context, LOYALTY_VOUCHER_PERMISSIONS.loyaltyMutate);
    rejectClientScope(input);
    return this.deps.repository.appendLoyalty(context, Object.freeze({ ...input, points: positiveInteger(input.points, "points"), reason: reason(input.reason) }), "EARN", idempotencyKey(key));
  }

  async redeem(context: SecurityContext, input: LoyaltyMutationInputV1, key: string) {
    requirePermission(context, LOYALTY_VOUCHER_PERMISSIONS.loyaltyMutate);
    rejectClientScope(input);
    return this.deps.repository.appendLoyalty(context, Object.freeze({ ...input, points: positiveInteger(input.points, "points"), reason: reason(input.reason) }), "REDEEM", idempotencyKey(key));
  }

  async issueVoucher(context: SecurityContext, input: VoucherIssueInputV1, key: string) {
    requirePermission(context, LOYALTY_VOUCHER_PERMISSIONS.voucherMutate);
    rejectClientScope(input);
    const publicReference = input.publicReference?.trim();
    const label = input.label?.trim();
    if (!publicReference || publicReference.length < 6 || publicReference.length > 80) throw new AppError("VALIDATION_FAILED", "publicReference must be 6-80 chars");
    if (!label || label.length > 160) throw new AppError("VALIDATION_FAILED", "label is required and must be <= 160 chars");
    return this.deps.repository.issueVoucher(context, Object.freeze({ ...input, publicReference, label, currency: currency(input.currency), valueMinor: positiveInteger(input.valueMinor, "valueMinor"), reason: reason(input.reason) }), idempotencyKey(key));
  }

  async redeemVoucher(context: SecurityContext, input: VoucherRedeemInputV1, key: string) {
    requirePermission(context, LOYALTY_VOUCHER_PERMISSIONS.voucherMutate);
    rejectClientScope(input);
    const publicReference = input.publicReference?.trim();
    if (!publicReference) throw new AppError("VALIDATION_FAILED", "publicReference is required");
    return this.deps.repository.redeemVoucher(context, Object.freeze({ ...input, publicReference, valueMinor: positiveInteger(input.valueMinor, "valueMinor"), reason: reason(input.reason) }), idempotencyKey(key));
  }

  async readOwn(input: Readonly<{ hostname: string; credential: string; correlationId: string }>): Promise<PublicLoyaltyVoucherProjectionV1> {
    const scope = await this.deps.tenantResolver.resolveFromHostname(input.hostname);
    if (!scope) throw new AppError("NOT_FOUND", "Resource not found");
    const projection = await this.deps.repository.readOwnedProjection(scope, credentialHash(input.credential), input.correlationId);
    if (!projection) throw new AppError("NOT_FOUND", "Resource not found");
    return projection;
  }
}
