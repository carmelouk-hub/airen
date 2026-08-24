import { randomUUID } from "node:crypto";
import { AppError, type AppErrorCode, type PlatformSecurityContext } from "../../../packages/shared-contracts/src/index.ts";
import { requirePrincipal, type AuthenticatedPrincipal, type AuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import type { MembershipRepository, RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import {
  assignPlatformRole, getPlatformPrincipalAdmin, listPlatformPrincipalsAdmin, listPlatformRolesAdmin,
  reactivatePlatformRole, revokePlatformRole, suspendPlatformRole,
  type PlatformPrincipalRoleQueryStore, type PlatformRoleLifecycleUnitOfWork
} from "../../../packages/authorization/src/platform-role-admin.ts";
import type { EntitlementRepository } from "../../../packages/entitlements/src/index.ts";
import {
  changeTenantEntitlementConfig, changeTenantEntitlementLimit, changeTenantEntitlementValidity,
  createEntitlementCatalogEntry, expireTenantEntitlement, getEntitlementCatalogEntryAdmin,
  getTenantEntitlementAdmin, grantTenantEntitlement, listEntitlementCatalogAdmin,
  listTenantEntitlementsAdmin, retireEntitlementCatalogEntry, revokeTenantEntitlement,
  updateEntitlementCatalogEntry,
  type EntitlementLifecycleUnitOfWork, type PlatformEntitlementQueryStore
} from "../../../packages/entitlements/src/index.ts";
import type { LocationRepository, TenantDomainRepository, TenantRepository } from "../../../packages/tenant/src/index.ts";
import { provisionTenant, type TenantProvisioningUnitOfWork } from "../../../packages/tenant/src/commands/provision-tenant.ts";
import {
  archiveTenant, getTenantAdmin, listTenantsAdmin, reactivateTenant, suspendTenant, updateTenant,
  type TenantAdminQueryStore, type TenantLifecycleUnitOfWork
} from "../../../packages/tenant/src/commands/manage-tenant.ts";
import {
  archiveLocation, getLocationAdmin, listLocationsAdmin, reactivateLocation, suspendLocation,
  transferPrimaryLocation, updateLocation, type LocationAdminQueryStore, type LocationLifecycleUnitOfWork
} from "../../../packages/tenant/src/commands/manage-location.ts";
import {
  activateTenantDomain, disableTenantDomain, getTenantDomainAdmin, listTenantDomainsAdmin,
  recordTenantDomainVerificationFailed, recordTenantDomainVerificationPassed, registerTenantDomain,
  retryTenantDomainVerification, setTenantDomainLocation, startTenantDomainVerification,
  type TenantDomainAdminQueryStore, type TenantDomainLifecycleUnitOfWork
} from "../../../packages/tenant/src/commands/manage-tenant-domain.ts";
import {
  activatePlan, activateSubscription, cancelSubscription, changeSubscriptionPlan, createPlan,
  createSubscription, expireSubscription, getPlanAdmin, getSubscriptionAdmin, listPlansAdmin,
  listSubscriptionsAdmin, reactivateSubscription, retirePlan, scheduleSubscriptionCancellation,
  suspendSubscription, unscheduleSubscriptionCancellation, updateDraftPlan,
  type BillingLifecycleUnitOfWork, type PlatformBillingQueryStore
} from "../../../packages/billing/src/index.ts";
import {
  activateCapability, createCapability, createFeatureFlag, getCapabilityAdmin, getFeatureFlagAdmin,
  listCapabilitiesAdmin, listFeatureFlagOverridesAdmin, listFeatureFlagsAdmin, removeFeatureFlagOverride,
  resolveCurrentCapabilities, retireCapability, retireFeatureFlag, setFeatureFlagDefault,
  setFeatureFlagOverride, updateDraftCapability, updateFeatureFlag,
  type CapabilityLifecycleUnitOfWork, type CurrentCapabilityAvailabilityResolver, type PlatformCapabilityQueryStore
} from "../../../packages/capabilities/src/index.ts";
import {
  queryPlatformAudit, type PlatformAuditQueryInput, type PlatformAuditQueryStore
} from "../../../packages/audit-events/src/index.ts";
import { resolvePlatformSecurityContext } from "./platform-security-context.ts";
import { resolveRequestSecurityContext } from "./security-context.ts";

export const ADMIN_API_PREFIX = "/api/admin/v1";

export type AdminApiRequest = Readonly<{
  method: string;
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
  body?: unknown;
}>;

export type AdminApiResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
}>;

export type AdminApiDependencies = Readonly<{
  authentication: AuthenticationAdapter;
  roles: RolePermissionResolver;
  appBaseDomain: string;
  tenantProvisioning: TenantProvisioningUnitOfWork;
  tenants: TenantLifecycleUnitOfWork & TenantAdminQueryStore;
  locations: LocationLifecycleUnitOfWork & LocationAdminQueryStore;
  domains: TenantDomainLifecycleUnitOfWork & TenantDomainAdminQueryStore;
  platformRoles: PlatformRoleLifecycleUnitOfWork & PlatformPrincipalRoleQueryStore;
  billing: BillingLifecycleUnitOfWork & PlatformBillingQueryStore;
  entitlements: EntitlementLifecycleUnitOfWork & PlatformEntitlementQueryStore;
  capabilities: CapabilityLifecycleUnitOfWork & PlatformCapabilityQueryStore & CurrentCapabilityAvailabilityResolver;
  audit: PlatformAuditQueryStore;
  tenantContext: Readonly<{
    tenants: TenantRepository;
    locations: LocationRepository;
    domains: TenantDomainRepository;
    memberships: MembershipRepository;
    entitlements: EntitlementRepository;
  }>;
}>;

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_URL_LENGTH = 4096;

function response(status: number, body: Readonly<Record<string, unknown>>, correlationId: string): AdminApiResponse {
  return {
    status,
    body,
    headers: Object.freeze({
      "cache-control": "no-store",
      "x-correlation-id": correlationId
    })
  };
}

function correlationId(value: string | undefined): string {
  const candidate = value?.trim();
  return candidate && CORRELATION_ID.test(candidate) ? candidate : randomUUID();
}

function authorizationRequest(request: AdminApiRequest): Readonly<Record<string, unknown>> {
  // Only the credential transport is forwarded. Caller-declared role/scope headers are never authority.
  return Object.freeze({ authorization: request.headers.authorization });
}

function bodyObject(body: unknown): Record<string, any> {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw new AppError("VALIDATION_FAILED", "JSON body must be an object");
  return body as Record<string, any>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AppError("VALIDATION_FAILED", `${field} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  return value === null ? null : optionalString(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AppError("VALIDATION_FAILED", "Numeric field is invalid");
  return value;
}

function queryNumber(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new AppError("VALIDATION_FAILED", `${name} must be an integer`);
  return value;
}

function queryString(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === "" ? undefined : value;
}

function idempotencyKey(request: AdminApiRequest): string {
  return requiredString(request.headers["idempotency-key"], "Idempotency-Key");
}

function requireFound<T>(value: T | null, label: string): T {
  if (value === null) throw new AppError("NOT_FOUND", `${label} not found`);
  return value;
}

function safeSession(principal: AuthenticatedPrincipal, context: PlatformSecurityContext): Readonly<Record<string, unknown>> {
  return Object.freeze({
    identityId: principal.identityId,
    platformRoles: [...context.platformRoles],
    platformPermissions: [...context.platformPermissions],
    authenticatedAtIso: principal.authenticatedAtIso,
    expiresAtIso: principal.expiresAtIso,
    correlationId: context.correlationId
  });
}

function appErrorStatus(code: AppErrorCode): number {
  switch (code) {
    case "AUTHENTICATION_REQUIRED": return 401;
    case "MEMBERSHIP_REQUIRED":
    case "LOCATION_MEMBERSHIP_REQUIRED":
    case "PERMISSION_DENIED":
    case "ENTITLEMENT_REQUIRED":
    case "TENANT_SCOPE_VIOLATION":
    case "LOCATION_SCOPE_VIOLATION":
      return 403;
    case "TENANT_RESOLUTION_FAILED":
    case "VALIDATION_FAILED":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "RUNTIME_CONFIGURATION_INVALID":
    case "SECRET_RESOLUTION_FAILED":
    case "INTERNAL_ERROR":
      return 500;
  }
}

export function mapAdminApiError(error: unknown, correlation: string): AdminApiResponse {
  if (error instanceof AppError) {
    const status = appErrorStatus(error.code);
    return response(status, {
      error: error.code,
      message: status >= 500 ? "Administrative request failed" : error.message,
      correlationId: correlation
    }, correlation);
  }
  return response(500, { error: "INTERNAL_ERROR", message: "Administrative request failed", correlationId: correlation }, correlation);
}

function ensureMethod(request: AdminApiRequest, expected: string): void {
  if (request.method.toUpperCase() !== expected) throw new AppError("NOT_FOUND", "Admin route not found");
}

async function platformContext(request: AdminApiRequest, deps: AdminApiDependencies, correlation: string) {
  const principal = requirePrincipal(await deps.authentication.authenticate(authorizationRequest(request)));
  const { context } = await resolvePlatformSecurityContext({ principal, roles: deps.roles, correlationId: correlation });
  return { principal, context };
}

async function tenantEffectiveContext(
  request: AdminApiRequest,
  deps: AdminApiDependencies,
  principal: AuthenticatedPrincipal,
  correlation: string,
  hostname: string
) {
  return resolveRequestSecurityContext({
    hostname,
    principal,
    trustedBaseDomain: deps.appBaseDomain,
    correlationId: correlation,
    tenants: deps.tenantContext.tenants,
    locations: deps.tenantContext.locations,
    domains: deps.tenantContext.domains,
    memberships: deps.tenantContext.memberships,
    roles: deps.roles,
    entitlements: deps.tenantContext.entitlements
  });
}

async function tenantsRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  if (segments.length === 1) {
    if (request.method === "GET") {
      return { items: await listTenantsAdmin({
        status: queryString(url, "status") as any,
        afterId: queryString(url, "afterId"),
        limit: queryNumber(url, "limit")
      }, { context, queries: deps.tenants }) };
    }
    if (request.method === "POST") {
      const b = bodyObject(request.body);
      return provisionTenant({
        idempotencyKey: idempotencyKey(request),
        slug: requiredString(b.slug, "slug"),
        name: requiredString(b.name, "name"),
        locale: optionalString(b.locale),
        timezone: requiredString(b.timezone, "timezone"),
        currency: optionalString(b.currency),
        primaryLocation: {
          slug: requiredString(b.primaryLocation?.slug, "primaryLocation.slug"),
          name: requiredString(b.primaryLocation?.name, "primaryLocation.name"),
          timezone: optionalString(b.primaryLocation?.timezone)
        }
      }, { context, unitOfWork: deps.tenantProvisioning });
    }
  }
  const tenantId = segments[1];
  if (!tenantId) throw new AppError("NOT_FOUND", "Admin route not found");
  if (segments.length === 2 && request.method === "GET") {
    return { tenant: requireFound(await getTenantAdmin(tenantId, { context, queries: deps.tenants }), "Tenant") };
  }
  if (segments.length === 2 && request.method === "PATCH") {
    const b = bodyObject(request.body);
    return updateTenant({
      idempotencyKey: idempotencyKey(request), tenantId,
      name: optionalString(b.name), locale: optionalString(b.locale),
      timezone: optionalString(b.timezone), currency: optionalString(b.currency)
    }, { context, unitOfWork: deps.tenants });
  }
  if (segments.length === 3 && request.method === "POST") {
    const b = bodyObject(request.body);
    const common = { idempotencyKey: idempotencyKey(request), tenantId, reasonCode: requiredString(b.reasonCode, "reasonCode") };
    if (segments[2] === "suspend") return suspendTenant(common, { context, unitOfWork: deps.tenants });
    if (segments[2] === "reactivate") return reactivateTenant(common, { context, unitOfWork: deps.tenants });
    if (segments[2] === "archive") return archiveTenant(common, { context, unitOfWork: deps.tenants });
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function locationsRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  // Deliberately no POST /locations: createLocation remains Tenant-scoped authority.
  if (segments.length === 1 && request.method === "GET") {
    return { items: await listLocationsAdmin({
      tenantId: requiredString(queryString(url, "tenantId"), "tenantId"),
      status: queryString(url, "status") as any,
      afterId: queryString(url, "afterId"),
      limit: queryNumber(url, "limit")
    }, { context, queries: deps.locations }) };
  }
  const locationId = segments[1];
  if (!locationId) throw new AppError("NOT_FOUND", "Admin route not found");
  if (segments.length === 2 && request.method === "GET") {
    return { location: requireFound(await getLocationAdmin(locationId, { context, queries: deps.locations }), "Location") };
  }
  if (segments.length === 2 && request.method === "PATCH") {
    const b = bodyObject(request.body);
    return updateLocation({
      idempotencyKey: idempotencyKey(request), locationId,
      name: optionalString(b.name), timezone: optionalString(b.timezone)
    }, { context, unitOfWork: deps.locations });
  }
  if (segments.length === 3 && request.method === "POST") {
    const b = bodyObject(request.body);
    if (segments[2] === "transfer-primary") {
      return transferPrimaryLocation({
        idempotencyKey: idempotencyKey(request),
        sourceLocationId: locationId,
        targetLocationId: requiredString(b.targetLocationId, "targetLocationId"),
        reasonCode: requiredString(b.reasonCode, "reasonCode")
      }, { context, unitOfWork: deps.locations });
    }
    const common = { idempotencyKey: idempotencyKey(request), locationId, reasonCode: requiredString(b.reasonCode, "reasonCode") };
    if (segments[2] === "suspend") return suspendLocation(common, { context, unitOfWork: deps.locations });
    if (segments[2] === "reactivate") return reactivateLocation(common, { context, unitOfWork: deps.locations });
    if (segments[2] === "archive") return archiveLocation(common, { context, unitOfWork: deps.locations });
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function domainsRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  if (segments.length === 1) {
    if (request.method === "GET") {
      return { items: await listTenantDomainsAdmin({
        tenantId: requiredString(queryString(url, "tenantId"), "tenantId"),
        status: queryString(url, "status") as any,
        afterId: queryString(url, "afterId"),
        limit: queryNumber(url, "limit")
      }, { context, queries: deps.domains }) };
    }
    if (request.method === "POST") {
      const b = bodyObject(request.body);
      return registerTenantDomain({
        idempotencyKey: idempotencyKey(request),
        tenantId: requiredString(b.tenantId, "tenantId"),
        hostname: requiredString(b.hostname, "hostname"),
        locationId: optionalString(b.locationId)
      }, { context, unitOfWork: deps.domains });
    }
  }
  const domainId = segments[1];
  if (!domainId) throw new AppError("NOT_FOUND", "Admin route not found");
  if (segments.length === 2 && request.method === "GET") {
    return { domain: requireFound(await getTenantDomainAdmin(domainId, { context, queries: deps.domains }), "TenantDomain") };
  }
  if (segments.length === 3 && request.method === "POST") {
    const action = segments[2];
    const b = bodyObject(request.body);
    const key = idempotencyKey(request);
    if (action === "start-verification") return startTenantDomainVerification({ idempotencyKey: key, domainId }, { context, unitOfWork: deps.domains });
    if (action === "verify") return recordTenantDomainVerificationPassed({ idempotencyKey: key, domainId, verificationEvidenceRef: requiredString(b.verificationEvidenceRef, "verificationEvidenceRef") }, { context, unitOfWork: deps.domains });
    if (action === "fail-verification") return recordTenantDomainVerificationFailed({ idempotencyKey: key, domainId, verificationEvidenceRef: requiredString(b.verificationEvidenceRef, "verificationEvidenceRef"), reasonCode: requiredString(b.reasonCode, "reasonCode") }, { context, unitOfWork: deps.domains });
    if (action === "retry-verification") return retryTenantDomainVerification({ idempotencyKey: key, domainId }, { context, unitOfWork: deps.domains });
    if (action === "activate") return activateTenantDomain({ idempotencyKey: key, domainId }, { context, unitOfWork: deps.domains });
    if (action === "disable") return disableTenantDomain({ idempotencyKey: key, domainId, reasonCode: requiredString(b.reasonCode, "reasonCode") }, { context, unitOfWork: deps.domains });
    if (action === "set-location") return setTenantDomainLocation({
      idempotencyKey: key, domainId,
      locationId: b.locationId === null ? null : optionalString(b.locationId),
      reasonCode: requiredString(b.reasonCode, "reasonCode")
    }, { context, unitOfWork: deps.domains });
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function principalsRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  ensureMethod(request, "GET");
  if (segments.length === 1) {
    return { items: await listPlatformPrincipalsAdmin({
      activeRoleKey: queryString(url, "activeRoleKey"),
      afterIdentityId: queryString(url, "afterIdentityId"),
      limit: queryNumber(url, "limit")
    }, { context, queries: deps.platformRoles }) };
  }
  if (segments.length === 2) {
    return { principal: requireFound(await getPlatformPrincipalAdmin(segments[1], { context, queries: deps.platformRoles }), "Platform principal") };
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function rolesRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  if (segments.length === 1 && request.method === "GET") {
    return { items: await listPlatformRolesAdmin({
      afterRoleKey: queryString(url, "afterRoleKey"),
      limit: queryNumber(url, "limit")
    }, { context, queries: deps.platformRoles }) };
  }
  if (segments.length === 5 && segments[2] === "assignments" && request.method === "POST") {
    const roleKey = segments[1];
    const targetIdentityId = segments[3];
    const action = segments[4];
    const b = bodyObject(request.body);
    const common = { idempotencyKey: idempotencyKey(request), targetIdentityId, roleKey };
    if (action === "assign") return assignPlatformRole({ ...common, reasonCode: optionalString(b.reasonCode) }, { context, unitOfWork: deps.platformRoles });
    if (action === "suspend") return suspendPlatformRole({ ...common, reasonCode: requiredString(b.reasonCode, "reasonCode") }, { context, unitOfWork: deps.platformRoles });
    if (action === "reactivate") return reactivatePlatformRole({ ...common, reasonCode: optionalString(b.reasonCode) }, { context, unitOfWork: deps.platformRoles });
    if (action === "revoke") return revokePlatformRole({ ...common, reasonCode: requiredString(b.reasonCode, "reasonCode") }, { context, unitOfWork: deps.platformRoles });
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function plansRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  if (segments.length === 1) {
    if (request.method === "GET") return { items: await listPlansAdmin({
      status: queryString(url, "status") as any,
      afterSlug: queryString(url, "afterSlug"),
      limit: queryNumber(url, "limit")
    }, { context, queries: deps.billing }) };
    if (request.method === "POST") {
      const b = bodyObject(request.body);
      return createPlan({
        idempotencyKey: idempotencyKey(request), slug: requiredString(b.slug, "slug"),
        name: requiredString(b.name, "name"), description: optionalNullableString(b.description),
        currency: requiredString(b.currency, "currency"), priceMinor: optionalNumber(b.priceMinor) ?? NaN,
        billingPeriod: requiredString(b.billingPeriod, "billingPeriod") as any,
        defaultTrialDays: optionalNumber(b.defaultTrialDays), reasonCode: optionalString(b.reasonCode)
      }, { context, unitOfWork: deps.billing });
    }
  }
  const planId = segments[1];
  if (!planId) throw new AppError("NOT_FOUND", "Admin route not found");
  if (segments.length === 2 && request.method === "GET") return { plan: requireFound(await getPlanAdmin(planId, { context, queries: deps.billing }), "Plan") };
  if (segments.length === 2 && request.method === "PATCH") {
    const b = bodyObject(request.body);
    return updateDraftPlan({
      idempotencyKey: idempotencyKey(request), planId,
      name: requiredString(b.name, "name"), description: optionalNullableString(b.description),
      currency: requiredString(b.currency, "currency"), priceMinor: optionalNumber(b.priceMinor) ?? NaN,
      billingPeriod: requiredString(b.billingPeriod, "billingPeriod") as any,
      defaultTrialDays: optionalNumber(b.defaultTrialDays) ?? NaN, reasonCode: optionalString(b.reasonCode)
    }, { context, unitOfWork: deps.billing });
  }
  if (segments.length === 3 && request.method === "POST") {
    const b = bodyObject(request.body);
    const common = { idempotencyKey: idempotencyKey(request), planId, reasonCode: optionalString(b.reasonCode) };
    if (segments[2] === "activate") return activatePlan(common, { context, unitOfWork: deps.billing });
    if (segments[2] === "retire") return retirePlan(common, { context, unitOfWork: deps.billing });
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function subscriptionsRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  if (segments.length === 1) {
    if (request.method === "GET") return { items: await listSubscriptionsAdmin({
      tenantId: queryString(url, "tenantId"), status: queryString(url, "status") as any,
      planId: queryString(url, "planId"), afterSubscriptionId: queryString(url, "afterSubscriptionId"),
      limit: queryNumber(url, "limit")
    }, { context, queries: deps.billing }) };
    if (request.method === "POST") {
      const b = bodyObject(request.body);
      return createSubscription({
        idempotencyKey: idempotencyKey(request), tenantId: requiredString(b.tenantId, "tenantId"),
        planId: requiredString(b.planId, "planId"), startsAt: requiredString(b.startsAt, "startsAt"),
        trialEndsAt: optionalString(b.trialEndsAt), currentPeriodEnd: requiredString(b.currentPeriodEnd, "currentPeriodEnd"),
        sourceKind: optionalString(b.sourceKind) as any, providerKey: optionalString(b.providerKey),
        providerSubscriptionRef: optionalString(b.providerSubscriptionRef), providerCustomerRef: optionalString(b.providerCustomerRef),
        reasonCode: optionalString(b.reasonCode)
      }, { context, unitOfWork: deps.billing });
    }
  }
  const subscriptionId = segments[1];
  if (!subscriptionId) throw new AppError("NOT_FOUND", "Admin route not found");
  if (segments.length === 2 && request.method === "GET") return { subscription: requireFound(await getSubscriptionAdmin(subscriptionId, { context, queries: deps.billing }), "Subscription") };
  if (segments.length === 3 && request.method === "POST") {
    const b = bodyObject(request.body);
    const common = { idempotencyKey: idempotencyKey(request), subscriptionId };
    switch (segments[2]) {
      case "activate": return activateSubscription({ ...common, reasonCode: optionalString(b.reasonCode) }, { context, unitOfWork: deps.billing });
      case "suspend": return suspendSubscription({ ...common, reasonCode: requiredString(b.reasonCode, "reasonCode") }, { context, unitOfWork: deps.billing });
      case "reactivate": return reactivateSubscription({ ...common, reasonCode: optionalString(b.reasonCode) }, { context, unitOfWork: deps.billing });
      case "schedule-cancel": return scheduleSubscriptionCancellation({ ...common, reasonCode: optionalString(b.reasonCode) }, { context, unitOfWork: deps.billing });
      case "unschedule-cancel": return unscheduleSubscriptionCancellation({ ...common, reasonCode: optionalString(b.reasonCode) }, { context, unitOfWork: deps.billing });
      case "cancel": return cancelSubscription({ ...common, mode: requiredString(b.mode, "mode") as any, reasonCode: requiredString(b.reasonCode, "reasonCode") }, { context, unitOfWork: deps.billing });
      case "expire": return expireSubscription({ ...common, reasonCode: requiredString(b.reasonCode, "reasonCode") }, { context, unitOfWork: deps.billing });
      case "change-plan": return changeSubscriptionPlan({ ...common, toPlanId: requiredString(b.toPlanId, "toPlanId"), reasonCode: optionalString(b.reasonCode) }, { context, unitOfWork: deps.billing });
    }
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function entitlementsRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  if (segments[1] === "catalog") {
    if (segments.length === 2) {
      if (request.method === "GET") return { items: await listEntitlementCatalogAdmin({
        status: queryString(url, "status") as any, afterKey: queryString(url, "afterKey"), limit: queryNumber(url, "limit")
      }, { context, queries: deps.entitlements }) };
      if (request.method === "POST") {
        const b = bodyObject(request.body);
        return createEntitlementCatalogEntry({
          idempotencyKey: idempotencyKey(request), entitlementKey: requiredString(b.entitlementKey, "entitlementKey"),
          description: optionalNullableString(b.description), reasonCode: optionalString(b.reasonCode)
        }, { context, unitOfWork: deps.entitlements });
      }
    }
    const key = segments[2];
    if (key && segments.length === 3 && request.method === "GET") {
      return { entitlement: requireFound(await getEntitlementCatalogEntryAdmin(key, { context, queries: deps.entitlements }), "Entitlement catalog entry") };
    }
    if (key && segments.length === 3 && request.method === "PATCH") {
      const b = bodyObject(request.body);
      return updateEntitlementCatalogEntry({
        idempotencyKey: idempotencyKey(request), entitlementKey: key,
        description: optionalNullableString(b.description), reasonCode: optionalString(b.reasonCode)
      }, { context, unitOfWork: deps.entitlements });
    }
    if (key && segments.length === 4 && segments[3] === "retire" && request.method === "POST") {
      const b = bodyObject(request.body);
      return retireEntitlementCatalogEntry({ idempotencyKey: idempotencyKey(request), entitlementKey: key, reasonCode: optionalString(b.reasonCode) }, { context, unitOfWork: deps.entitlements });
    }
  }
  if (segments[1] === "tenants") {
    if (segments.length === 2 && request.method === "GET") return { items: await listTenantEntitlementsAdmin({
      tenantId: queryString(url, "tenantId"), entitlementKey: queryString(url, "entitlementKey"),
      derivedState: queryString(url, "derivedState") as any, afterKey: queryString(url, "afterKey"),
      limit: queryNumber(url, "limit")
    }, { context, queries: deps.entitlements }) };
    const tenantId = segments[2], key = segments[3];
    if (tenantId && key && segments.length === 4 && request.method === "GET") {
      return { entitlement: requireFound(await getTenantEntitlementAdmin(tenantId, key, { context, queries: deps.entitlements }), "Tenant Entitlement") };
    }
    if (tenantId && key && segments.length === 5 && request.method === "POST") {
      const b = bodyObject(request.body);
      const input: any = {
        idempotencyKey: idempotencyKey(request), tenantId, entitlementKey: key,
        sourceKind: optionalString(b.sourceKind), sourceRef: optionalNullableString(b.sourceRef),
        limitValue: b.limitValue === null ? null : optionalNumber(b.limitValue),
        validFrom: b.validFrom === null ? null : optionalString(b.validFrom),
        validUntil: b.validUntil === null ? null : optionalString(b.validUntil),
        config: b.config, reasonCode: optionalString(b.reasonCode)
      };
      switch (segments[4]) {
        case "grant": return grantTenantEntitlement(input, { context, unitOfWork: deps.entitlements });
        case "revoke": return revokeTenantEntitlement(input, { context, unitOfWork: deps.entitlements });
        case "expire": return expireTenantEntitlement(input, { context, unitOfWork: deps.entitlements });
        case "change-limit": return changeTenantEntitlementLimit(input, { context, unitOfWork: deps.entitlements });
        case "change-config": return changeTenantEntitlementConfig(input, { context, unitOfWork: deps.entitlements });
        case "change-validity": return changeTenantEntitlementValidity(input, { context, unitOfWork: deps.entitlements });
      }
    }
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function capabilitiesRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  if (segments.length === 1) {
    if (request.method === "GET") return { items: await listCapabilitiesAdmin({
      status: queryString(url, "status") as any, scopeKind: queryString(url, "scopeKind") as any,
      afterKey: queryString(url, "afterKey"), limit: queryNumber(url, "limit")
    }, { context, queries: deps.capabilities }) };
    if (request.method === "POST") {
      const b = bodyObject(request.body);
      return createCapability({
        idempotencyKey: idempotencyKey(request), capabilityKey: requiredString(b.capabilityKey, "capabilityKey"),
        name: requiredString(b.name, "name"), description: optionalNullableString(b.description),
        scopeKind: requiredString(b.scopeKind, "scopeKind") as any,
        requiredEntitlements: Array.isArray(b.requiredEntitlements) ? b.requiredEntitlements.map(String) : undefined,
        requiredPermissions: Array.isArray(b.requiredPermissions) ? b.requiredPermissions.map(String) : undefined,
        featureFlagKey: b.featureFlagKey === null ? null : optionalString(b.featureFlagKey),
        auditLevel: optionalString(b.auditLevel) as any, aiAccessMode: optionalString(b.aiAccessMode) as any,
        reasonCode: optionalString(b.reasonCode)
      }, { context, unitOfWork: deps.capabilities });
    }
  }
  const key = segments[1];
  if (!key) throw new AppError("NOT_FOUND", "Admin route not found");
  if (segments.length === 2 && request.method === "GET") return { capability: requireFound(await getCapabilityAdmin(key, { context, queries: deps.capabilities }), "Capability") };
  if (segments.length === 2 && request.method === "PATCH") {
    const b = bodyObject(request.body);
    return updateDraftCapability({
      idempotencyKey: idempotencyKey(request), capabilityKey: key, name: requiredString(b.name, "name"),
      description: optionalNullableString(b.description), scopeKind: requiredString(b.scopeKind, "scopeKind") as any,
      requiredEntitlements: Array.isArray(b.requiredEntitlements) ? b.requiredEntitlements.map(String) : undefined,
      requiredPermissions: Array.isArray(b.requiredPermissions) ? b.requiredPermissions.map(String) : undefined,
      featureFlagKey: b.featureFlagKey === null ? null : optionalString(b.featureFlagKey),
      auditLevel: optionalString(b.auditLevel) as any, aiAccessMode: optionalString(b.aiAccessMode) as any,
      reasonCode: optionalString(b.reasonCode)
    }, { context, unitOfWork: deps.capabilities });
  }
  if (segments.length === 3 && request.method === "POST") {
    const b = bodyObject(request.body);
    const input = { idempotencyKey: idempotencyKey(request), capabilityKey: key, reasonCode: optionalString(b.reasonCode) };
    if (segments[2] === "activate") return activateCapability(input, { context, unitOfWork: deps.capabilities });
    if (segments[2] === "retire") return retireCapability(input, { context, unitOfWork: deps.capabilities });
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function featureFlagsRoute(
  request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext,
  deps: AdminApiDependencies, principal: AuthenticatedPrincipal, correlation: string
) {
  if (segments[1] === "effective-resolution") {
    ensureMethod(request, "GET");
    const hostname = requiredString(queryString(url, "hostname"), "hostname");
    const { context: tenantContext } = await tenantEffectiveContext(request, deps, principal, correlation, hostname);
    return { hostname, items: await resolveCurrentCapabilities({ context: tenantContext, resolver: deps.capabilities }) };
  }
  if (segments[1] === "overrides") {
    ensureMethod(request, "GET");
    return { items: await listFeatureFlagOverridesAdmin({
      featureFlagKey: queryString(url, "featureFlagKey"), tenantId: queryString(url, "tenantId"),
      subjectKind: queryString(url, "subjectKind") as any, status: queryString(url, "status") as any,
      limit: queryNumber(url, "limit")
    }, { context, queries: deps.capabilities }) };
  }
  if (segments.length === 1) {
    if (request.method === "GET") return { items: await listFeatureFlagsAdmin({
      status: queryString(url, "status") as any, afterKey: queryString(url, "afterKey"), limit: queryNumber(url, "limit")
    }, { context, queries: deps.capabilities }) };
    if (request.method === "POST") {
      const b = bodyObject(request.body);
      return createFeatureFlag({
        idempotencyKey: idempotencyKey(request), featureFlagKey: requiredString(b.featureFlagKey, "featureFlagKey"),
        description: optionalNullableString(b.description), enabledDefault: optionalBoolean(b.enabledDefault) ?? false,
        validFrom: b.validFrom === null ? null : optionalString(b.validFrom),
        validUntil: b.validUntil === null ? null : optionalString(b.validUntil),
        reasonCode: optionalString(b.reasonCode)
      }, { context, unitOfWork: deps.capabilities });
    }
  }
  const key = segments[1];
  if (!key) throw new AppError("NOT_FOUND", "Admin route not found");
  if (segments.length === 2 && request.method === "GET") return { featureFlag: requireFound(await getFeatureFlagAdmin(key, { context, queries: deps.capabilities }), "Feature Flag") };
  if (segments.length === 2 && request.method === "PATCH") {
    const b = bodyObject(request.body);
    return updateFeatureFlag({
      idempotencyKey: idempotencyKey(request), featureFlagKey: key,
      description: optionalNullableString(b.description),
      validFrom: b.validFrom === null ? null : optionalString(b.validFrom),
      validUntil: b.validUntil === null ? null : optionalString(b.validUntil),
      reasonCode: optionalString(b.reasonCode)
    }, { context, unitOfWork: deps.capabilities });
  }
  if (segments.length === 3 && request.method === "POST") {
    const b = bodyObject(request.body);
    if (segments[2] === "set-default") return setFeatureFlagDefault({
      idempotencyKey: idempotencyKey(request), featureFlagKey: key,
      enabledDefault: optionalBoolean(b.enabledDefault) ?? false, reasonCode: requiredString(b.reasonCode, "reasonCode")
    }, { context, unitOfWork: deps.capabilities });
    if (segments[2] === "retire") return retireFeatureFlag({
      idempotencyKey: idempotencyKey(request), featureFlagKey: key, reasonCode: requiredString(b.reasonCode, "reasonCode")
    }, { context, unitOfWork: deps.capabilities });
  }
  if (segments.length === 4 && segments[2] === "overrides" && request.method === "POST") {
    const b = bodyObject(request.body);
    const input: any = {
      idempotencyKey: idempotencyKey(request), featureFlagKey: key,
      subjectKind: requiredString(b.subjectKind, "subjectKind"), tenantId: requiredString(b.tenantId, "tenantId"),
      locationId: optionalString(b.locationId), enabled: optionalBoolean(b.enabled),
      validFrom: b.validFrom === null ? null : optionalString(b.validFrom),
      validUntil: b.validUntil === null ? null : optionalString(b.validUntil),
      reasonCode: requiredString(b.reasonCode, "reasonCode")
    };
    if (segments[3] === "set") return setFeatureFlagOverride(input, { context, unitOfWork: deps.capabilities });
    if (segments[3] === "remove") return removeFeatureFlagOverride(input, { context, unitOfWork: deps.capabilities });
  }
  throw new AppError("NOT_FOUND", "Admin route not found");
}

async function auditRoute(request: AdminApiRequest, url: URL, segments: string[], context: PlatformSecurityContext, deps: AdminApiDependencies) {
  if (segments.length !== 1) throw new AppError("NOT_FOUND", "Admin route not found");
  ensureMethod(request, "GET");
  const input: PlatformAuditQueryInput = {
    createdFrom: requiredString(queryString(url, "createdFrom"), "createdFrom"),
    createdUntil: requiredString(queryString(url, "createdUntil"), "createdUntil"),
    tenantId: queryString(url, "tenantId"), locationId: queryString(url, "locationId"),
    actorIdentityId: queryString(url, "actorIdentityId"), actorKind: queryString(url, "actorKind"),
    actionKey: queryString(url, "actionKey"), resourceType: queryString(url, "resourceType"),
    resourceId: queryString(url, "resourceId"), correlationId: queryString(url, "correlationId"),
    outcome: queryString(url, "outcome") as any, cursor: queryString(url, "cursor"), limit: queryNumber(url, "limit")
  };
  return queryPlatformAudit(input, { context, store: deps.audit });
}

async function route(
  request: AdminApiRequest, url: URL, context: PlatformSecurityContext,
  deps: AdminApiDependencies, principal: AuthenticatedPrincipal, correlation: string
): Promise<Readonly<Record<string, unknown>>> {
  const path = url.pathname.slice(ADMIN_API_PREFIX.length).replace(/^\/+|\/+$/g, "");
  const segments = path ? path.split("/").map(decodeURIComponent) : [];
  if (segments[0] === "session" && segments[1] === "me" && segments.length === 2) {
    ensureMethod(request, "GET");
    return { session: safeSession(principal, context) };
  }
  switch (segments[0]) {
    case "tenants": return tenantsRoute(request, url, segments, context, deps);
    case "locations": return locationsRoute(request, url, segments, context, deps);
    case "domains": return domainsRoute(request, url, segments, context, deps);
    case "principals": return principalsRoute(request, url, segments, context, deps);
    case "roles": return rolesRoute(request, url, segments, context, deps);
    case "plans": return plansRoute(request, url, segments, context, deps);
    case "subscriptions": return subscriptionsRoute(request, url, segments, context, deps);
    case "entitlements": return entitlementsRoute(request, url, segments, context, deps);
    case "capabilities": return capabilitiesRoute(request, url, segments, context, deps);
    case "feature-flags": return featureFlagsRoute(request, url, segments, context, deps, principal, correlation);
    case "audit": return auditRoute(request, url, segments, context, deps);
    default: throw new AppError("NOT_FOUND", "Admin route not found");
  }
}

export function isAdminApiRequest(url: string | undefined): boolean {
  if (!url || url.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(url, "http://airenos.local");
    return parsed.pathname === ADMIN_API_PREFIX || parsed.pathname.startsWith(`${ADMIN_API_PREFIX}/`);
  } catch {
    return false;
  }
}

export async function dispatchAdminApiRequest(request: AdminApiRequest, deps: AdminApiDependencies): Promise<AdminApiResponse> {
  const correlation = correlationId(request.headers["x-correlation-id"]);
  try {
    if (!isAdminApiRequest(request.url)) throw new AppError("NOT_FOUND", "Admin route not found");
    const url = new URL(request.url, "http://airenos.local");
    const { principal, context } = await platformContext(request, deps, correlation);
    const result = await route(request, url, context, deps, principal, correlation);
    return response(200, { ...result, correlationId: correlation }, correlation);
  } catch (error) {
    return mapAdminApiError(error, correlation);
  }
}
