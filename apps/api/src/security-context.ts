import { requirePrincipal, type AuthenticatedPrincipal, type AuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import { buildSecurityContext, type MembershipRepository, type RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import type { EntitlementRepository } from "../../../packages/entitlements/src/index.ts";
import { resolveTenantRoute, type LocationRepository, type TenantDomainRepository, type TenantRepository } from "../../../packages/tenant/src/index.ts";

export async function resolveRequestSecurityContext(input: { hostname: string; principal: AuthenticatedPrincipal; trustedBaseDomain: string; correlationId?: string; tenants: TenantRepository; locations: LocationRepository; domains: TenantDomainRepository; memberships: MembershipRepository; roles: RolePermissionResolver; entitlements: EntitlementRepository }) {
  const route = await resolveTenantRoute(input);
  const enabledEntitlements = await input.entitlements.enabledForTenant(route.tenant.id);
  const context = await buildSecurityContext({ principal: input.principal, route, memberships: input.memberships, roles: input.roles, entitlements: enabledEntitlements, correlationId: input.correlationId });
  return { route, context };
}

export async function authenticateAndResolveRequestSecurityContext(input: {
  request: unknown;
  authentication: AuthenticationAdapter;
  hostname: string;
  trustedBaseDomain: string;
  correlationId?: string;
  tenants: TenantRepository;
  locations: LocationRepository;
  domains: TenantDomainRepository;
  memberships: MembershipRepository;
  roles: RolePermissionResolver;
  entitlements: EntitlementRepository;
}) {
  const principal = requirePrincipal(await input.authentication.authenticate(input.request));
  const resolved = await resolveRequestSecurityContext({
    hostname: input.hostname,
    principal,
    trustedBaseDomain: input.trustedBaseDomain,
    correlationId: input.correlationId,
    tenants: input.tenants,
    locations: input.locations,
    domains: input.domains,
    memberships: input.memberships,
    roles: input.roles,
    entitlements: input.entitlements
  });
  return { principal, ...resolved };
}
