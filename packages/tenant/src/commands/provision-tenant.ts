import { AppError, type PlatformSecurityContext, type UUID } from "../../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "../../../authorization/src/index.ts";
import type { Location, Tenant } from "../index.ts";

export type ProvisionTenantInput = Readonly<{
  idempotencyKey: string;
  slug: string;
  name: string;
  locale?: string;
  timezone: string;
  currency?: string;
  primaryLocation: Readonly<{
    slug: string;
    name: string;
    timezone?: string;
  }>;
}>;

export type TenantProvisioningResult = Readonly<{
  tenant: Tenant;
  primaryLocation: Location;
  tenantMembershipId: UUID;
  replayed: boolean;
}>;

export interface TenantProvisioningTransaction {
  provisionTenant(input: {
    idempotencyKey: string;
    tenantSlug: string;
    tenantName: string;
    locale: string;
    timezone: string;
    currency: string;
    locationSlug: string;
    locationName: string;
    locationTimezone: string;
  }): Promise<TenantProvisioningResult>;
}

export interface TenantProvisioningUnitOfWork {
  transaction<T>(fn: (tx: TenantProvisioningTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export async function provisionTenant(input: ProvisionTenantInput, deps: {
  context: PlatformSecurityContext;
  unitOfWork: TenantProvisioningUnitOfWork;
}): Promise<TenantProvisioningResult> {
  requirePlatformPermission(deps.context, "platform.tenants.provision");

  const idempotencyKey = input.idempotencyKey.trim();
  const tenantSlug = input.slug.trim().toLowerCase();
  const tenantName = input.name.trim();
  const locale = (input.locale ?? "it-IT").trim();
  const timezone = input.timezone.trim();
  const currency = (input.currency ?? "EUR").trim().toUpperCase();
  const locationSlug = input.primaryLocation.slug.trim().toLowerCase();
  const locationName = input.primaryLocation.name.trim();
  const locationTimezone = (input.primaryLocation.timezone ?? timezone).trim();

  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new AppError("VALIDATION_FAILED", "Invalid tenant provisioning idempotency key");
  if (!SLUG.test(tenantSlug)) throw new AppError("VALIDATION_FAILED", "Invalid tenant slug");
  if (!tenantName) throw new AppError("VALIDATION_FAILED", "Tenant name is required");
  if (!locale) throw new AppError("VALIDATION_FAILED", "Tenant locale is required");
  if (!timezone) throw new AppError("VALIDATION_FAILED", "Tenant timezone is required");
  if (!/^[A-Z]{3}$/.test(currency)) throw new AppError("VALIDATION_FAILED", "Tenant currency must be a three-letter uppercase code");
  if (!SLUG.test(locationSlug)) throw new AppError("VALIDATION_FAILED", "Invalid primary location slug");
  if (!locationName) throw new AppError("VALIDATION_FAILED", "Primary location name is required");
  if (!locationTimezone) throw new AppError("VALIDATION_FAILED", "Primary location timezone is required");

  return deps.unitOfWork.transaction(
    (tx) => tx.provisionTenant({ idempotencyKey, tenantSlug, tenantName, locale, timezone, currency, locationSlug, locationName, locationTimezone }),
    deps.context
  );
}
