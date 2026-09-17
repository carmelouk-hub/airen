import { AppError, type SecurityContext } from "../../../packages/shared-contracts/src/index.ts";
import type { MembershipRepository, RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import type { LocationRepository, TenantRepository } from "../../../packages/tenant/src/index.ts";
import type { AirenOsVerticalTrustedContext } from "./risto-vertical-trusted-context.ts";

function domainFailure(code: "TENANT_RESOLUTION_FAILED" | "TENANT_SCOPE_VIOLATION" | "LOCATION_SCOPE_VIOLATION" | "MEMBERSHIP_REQUIRED" | "LOCATION_MEMBERSHIP_REQUIRED", message: string): never {
  throw new AppError(code, message);
}

function platformOnlyPermissions(values: readonly string[]): readonly string[] {
  return Object.freeze(values.filter((permission) => permission.startsWith("platform.")));
}

export async function buildRistoVerticalSecurityContext(input: Readonly<{
  trusted: AirenOsVerticalTrustedContext;
  tenants: TenantRepository;
  locations: LocationRepository;
  memberships: MembershipRepository;
  roles: RolePermissionResolver;
}>): Promise<SecurityContext> {
  const tenant = await input.tenants.findById(input.trusted.tenantId);
  if (!tenant || tenant.status !== "active") domainFailure("TENANT_RESOLUTION_FAILED", "Trusted AIRenOS Tenant is unavailable");

  const location = await input.locations.findById(input.trusted.locationId);
  if (!location || location.status !== "active") domainFailure("LOCATION_SCOPE_VIOLATION", "Trusted AIRenOS Location is unavailable");
  if (location.tenantId !== tenant.id) domainFailure("TENANT_SCOPE_VIOLATION", "Trusted AIRenOS Location does not belong to Tenant");

  const tenantMembership = await input.memberships.findTenantMembership(tenant.id, input.trusted.actorId);
  if (!tenantMembership || tenantMembership.status !== "active") domainFailure("MEMBERSHIP_REQUIRED", "Active RISTOAIREN Tenant membership is required");

  const tenantPermissions = await input.roles.tenantPermissions(tenantMembership.roleKey);
  const locationMembership = await input.memberships.findLocationMembership(tenantMembership.id, location.id);
  if ((!locationMembership || locationMembership.status !== "active") && !tenantPermissions.includes("tenant.location.all")) {
    domainFailure("LOCATION_MEMBERSHIP_REQUIRED", "Active RISTOAIREN Location membership is required");
  }
  if (locationMembership && locationMembership.tenantId !== tenant.id) domainFailure("TENANT_SCOPE_VIOLATION", "RISTOAIREN Location membership Tenant mismatch");

  const locationPermissions = locationMembership?.status === "active" && locationMembership.roleKey
    ? await input.roles.locationPermissions(locationMembership.roleKey)
    : [];

  return Object.freeze({
    correlationId: input.trusted.correlationId,
    actorIdentityId: input.trusted.actorId,
    platformRoles: input.trusted.platformRoles,
    platformPermissions: platformOnlyPermissions(input.trusted.platformPermissions),
    tenantId: tenant.id,
    locationId: location.id,
    tenantMembershipId: tenantMembership.id,
    locationMembershipId: locationMembership?.status === "active" ? locationMembership.id : undefined,
    tenantRole: tenantMembership.roleKey,
    locationRole: locationMembership?.status === "active" ? locationMembership.roleKey : undefined,
    permissions: Object.freeze([...new Set([...tenantPermissions, ...locationPermissions])]),
    entitlements: input.trusted.entitlements
  });
}
