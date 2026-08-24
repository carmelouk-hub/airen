import { AppError, assertResourceScope, hasPermission, type PlatformSecurityContext, type ResourceScope, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import type { AuthenticatedPrincipal } from "../../identity/src/index.ts";
import type { ResolvedTenantRoute } from "../../tenant/src/index.ts";
export type TenantMembership = Readonly<{ id: UUID; tenantId: UUID; identityId: UUID; roleKey: string; status: "invited" | "active" | "suspended" | "revoked" }>;
export type LocationMembership = Readonly<{ id: UUID; tenantMembershipId: UUID; tenantId: UUID; locationId: UUID; roleKey?: string; status: "active" | "suspended" | "revoked" }>;
export interface MembershipRepository { findTenantMembership(tenantId: UUID, identityId: UUID): Promise<TenantMembership | null>; findLocationMembership(tenantMembershipId: UUID, locationId: UUID): Promise<LocationMembership | null>; }
export interface RolePermissionResolver { platformPermissions(platformRoles: readonly string[]): Promise<readonly string[]>; tenantPermissions(roleKey: string): Promise<readonly string[]>; locationPermissions(roleKey: string): Promise<readonly string[]>; }
export function correlationId(input?: string): string { return input?.trim() || crypto.randomUUID(); }
export async function buildPlatformSecurityContext(input: { principal: AuthenticatedPrincipal; roles: RolePermissionResolver; correlationId?: string }): Promise<PlatformSecurityContext> {
  const platformPermissions = await input.roles.platformPermissions(input.principal.platformRoles);
  return {
    scopeKind: "platform",
    correlationId: correlationId(input.correlationId),
    actorIdentityId: input.principal.identityId,
    platformRoles: input.principal.platformRoles,
    platformPermissions
  };
}
export function requirePlatformPermission(context: PlatformSecurityContext, permissionKey: string): void {
  if (!context.platformPermissions.includes(permissionKey)) throw new AppError("PERMISSION_DENIED", `Missing platform permission: ${permissionKey}`);
}
export async function buildSecurityContext(input: { principal: AuthenticatedPrincipal; route: ResolvedTenantRoute; memberships: MembershipRepository; roles: RolePermissionResolver; entitlements: readonly string[]; correlationId?: string }): Promise<SecurityContext> {
  const platformPermissions = await input.roles.platformPermissions(input.principal.platformRoles);
  const tenantMembership = await input.memberships.findTenantMembership(input.route.tenant.id, input.principal.identityId);
  if (!tenantMembership || tenantMembership.status !== "active") {
    if (!platformPermissions.includes("platform.override_tenant_scope")) throw new AppError("MEMBERSHIP_REQUIRED", "Active tenant membership is required");
    return { correlationId: correlationId(input.correlationId), actorIdentityId: input.principal.identityId, platformRoles: input.principal.platformRoles, platformPermissions, tenantId: input.route.tenant.id, locationId: input.route.location.id, permissions: [], entitlements: input.entitlements };
  }
  const tenantPermissions = await input.roles.tenantPermissions(tenantMembership.roleKey);
  const locationMembership = await input.memberships.findLocationMembership(tenantMembership.id, input.route.location.id);
  let locationPermissions: readonly string[] = [];
  if (locationMembership?.status === "active" && locationMembership.roleKey) locationPermissions = await input.roles.locationPermissions(locationMembership.roleKey);
  if (!locationMembership || locationMembership.status !== "active") {
    if (!tenantPermissions.includes("tenant.location.all") && !platformPermissions.includes("platform.override_tenant_scope")) throw new AppError("LOCATION_MEMBERSHIP_REQUIRED", "Active location membership is required");
  } else if (locationMembership.tenantId !== tenantMembership.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "Location membership tenant mismatch");
  return { correlationId: correlationId(input.correlationId), actorIdentityId: input.principal.identityId, platformRoles: input.principal.platformRoles, platformPermissions, tenantId: input.route.tenant.id, locationId: input.route.location.id, tenantMembershipId: tenantMembership.id, locationMembershipId: locationMembership?.status === "active" ? locationMembership.id : undefined, tenantRole: tenantMembership.roleKey, locationRole: locationMembership?.status === "active" ? locationMembership.roleKey : undefined, permissions: [...new Set([...tenantPermissions, ...locationPermissions])], entitlements: input.entitlements };
}
export function requirePermission(context: SecurityContext, permissionKey: string, resource?: ResourceScope): void { if (resource) assertResourceScope(context, resource); if (!hasPermission(context, permissionKey)) throw new AppError("PERMISSION_DENIED", `Missing permission: ${permissionKey}`); }
