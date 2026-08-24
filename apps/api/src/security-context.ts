import { requirePrincipal, type AuthenticatedPrincipal, type AuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import { buildSecurityContext, correlationId as resolveCorrelationId, type MembershipRepository, type RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import type { EntitlementRepository } from "../../../packages/entitlements/src/index.ts";
import { resolveTenantRoute, type LocationRepository, type PublicRouteLookup, type TenantDomainRepository, type TenantRepository } from "../../../packages/tenant/src/index.ts";

function publicRoutesFromDomainRepository(domains: TenantDomainRepository): PublicRouteLookup | undefined {
  const candidate = domains as TenantDomainRepository & Partial<PublicRouteLookup>;
  if (typeof candidate.findTrustedSubdomainRoute !== "function" || typeof candidate.findCustomDomainRoute !== "function") return undefined;
  return candidate as TenantDomainRepository & PublicRouteLookup;
}

type TrustedRequestScopedAccess = Readonly<{
  memberships: MembershipRepository;
  entitlements: EntitlementRepository;
  release(): Promise<void>;
}>;

type TrustedRequestScopeFactory = Readonly<{
  forTrustedRequestScope(input: Readonly<{ actorIdentityId: string; tenantId: string; locationId: string; correlationId: string }>): Promise<TrustedRequestScopedAccess>;
}>;

function trustedRequestScopeFactory(memberships: MembershipRepository): TrustedRequestScopeFactory | undefined {
  const candidate = memberships as MembershipRepository & Partial<TrustedRequestScopeFactory>;
  if (typeof candidate.forTrustedRequestScope !== "function") return undefined;
  return candidate as MembershipRepository & TrustedRequestScopeFactory;
}

export async function resolveRequestSecurityContext(input: { hostname: string; principal: AuthenticatedPrincipal; trustedBaseDomain: string; correlationId?: string; tenants: TenantRepository; locations: LocationRepository; domains: TenantDomainRepository; memberships: MembershipRepository; roles: RolePermissionResolver; entitlements: EntitlementRepository }) {
  const route = await resolveTenantRoute({ ...input, publicRoutes: publicRoutesFromDomainRepository(input.domains) });
  const correlationId = resolveCorrelationId(input.correlationId);
  const factory = trustedRequestScopeFactory(input.memberships);
  if (!factory) {
    const enabledEntitlements = await input.entitlements.enabledForTenant(route.tenant.id);
    const context = await buildSecurityContext({ principal: input.principal, route, memberships: input.memberships, roles: input.roles, entitlements: enabledEntitlements, correlationId });
    return { route, context };
  }
  const scoped = await factory.forTrustedRequestScope({
    actorIdentityId: input.principal.identityId,
    tenantId: route.tenant.id,
    locationId: route.location.id,
    correlationId
  });
  try {
    const enabledEntitlements = await scoped.entitlements.enabledForTenant(route.tenant.id);
    const context = await buildSecurityContext({ principal: input.principal, route, memberships: scoped.memberships, roles: input.roles, entitlements: enabledEntitlements, correlationId });
    return { route, context };
  } finally {
    await scoped.release();
  }
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
