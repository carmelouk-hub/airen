import { AppError, type UUID } from "../../shared-contracts/src/index.ts";
export type Tenant = Readonly<{ id: UUID; slug: string; name: string; status: "active" | "suspended" | "archived" }>;
export type Location = Readonly<{ id: UUID; tenantId: UUID; slug: string; name: string; status: "active" | "inactive" | "suspended" | "archived" }>;
export type TenantDomain = Readonly<{ id: UUID; tenantId: UUID; locationId?: UUID; hostname: string; status: "pending" | "verified" | "active" | "disabled" | "error" }>;
export type ResolvedTenantRoute = Readonly<{ tenant: Tenant; location: Location; source: "custom-domain" | "trusted-platform-subdomain"; hostname: string }>;
export interface TenantRepository { findById(id: UUID): Promise<Tenant | null>; findBySlug(slug: string): Promise<Tenant | null>; }
export interface LocationRepository { findById(id: UUID): Promise<Location | null>; findPrimaryForTenant(tenantId: UUID): Promise<Location | null>; }
export interface TenantDomainRepository { findActiveByHostname(hostname: string): Promise<TenantDomain | null>; }
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function normalizeHostname(rawHostname: string): string {
  let hostname = rawHostname.trim().toLowerCase();
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (hostname.startsWith("[") || hostname.includes("/")) throw new AppError("TENANT_RESOLUTION_FAILED", "Unsupported hostname form");
  const colonCount = [...hostname].filter((char) => char === ":").length;
  if (colonCount === 1) hostname = hostname.split(":", 1)[0] ?? hostname;
  if (!hostname || hostname.length > 253) throw new AppError("TENANT_RESOLUTION_FAILED", "Invalid hostname length");
  if (hostname.split(".").some((label) => !HOST_LABEL.test(label))) throw new AppError("TENANT_RESOLUTION_FAILED", "Invalid hostname syntax");
  return hostname;
}
export async function resolveTenantRoute(input: { hostname: string; trustedBaseDomain: string; tenants: TenantRepository; locations: LocationRepository; domains: TenantDomainRepository }): Promise<ResolvedTenantRoute> {
  const hostname = normalizeHostname(input.hostname);
  const trustedBaseDomain = normalizeHostname(input.trustedBaseDomain);
  const suffix = `.${trustedBaseDomain}`;
  if (hostname.endsWith(suffix)) {
    const prefix = hostname.slice(0, -suffix.length);
    if (!prefix || prefix.includes(".")) throw new AppError("TENANT_RESOLUTION_FAILED", "Platform hostname must contain exactly one tenant slug label");
    const tenant = await input.tenants.findBySlug(prefix);
    if (!tenant || tenant.status !== "active") throw new AppError("TENANT_RESOLUTION_FAILED", "Unknown tenant slug");
    const location = await input.locations.findPrimaryForTenant(tenant.id);
    if (!location || location.status !== "active") throw new AppError("TENANT_RESOLUTION_FAILED", "Tenant has no active primary location");
    return { tenant, location, source: "trusted-platform-subdomain", hostname };
  }
  const customDomain = await input.domains.findActiveByHostname(hostname);
  if (customDomain) {
    const tenant = await input.tenants.findById(customDomain.tenantId);
    if (!tenant || tenant.status !== "active") throw new AppError("TENANT_RESOLUTION_FAILED", "Custom domain points to an unavailable tenant");
    const location = customDomain.locationId ? await input.locations.findById(customDomain.locationId) : await input.locations.findPrimaryForTenant(tenant.id);
    if (!location || location.tenantId !== tenant.id || location.status !== "active") throw new AppError("TENANT_RESOLUTION_FAILED", "Custom domain has no active location in resolved tenant");
    return { tenant, location, source: "custom-domain", hostname };
  }
  throw new AppError("TENANT_RESOLUTION_FAILED", "Hostname is not registered for any tenant");
}
