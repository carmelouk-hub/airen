import { randomUUID } from "node:crypto";
import { AppError, type AppErrorCode } from "../../../packages/shared-contracts/src/index.ts";
import { requirePrincipal, type AuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import type { MembershipRepository, RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import type { CurrentTenantEffectiveEntitlementResolver, EntitlementRepository } from "../../../packages/entitlements/src/index.ts";
import type { LocationRepository, TenantDomainRepository, TenantRepository } from "../../../packages/tenant/src/index.ts";
import {
  RISTOAIREN_ATTACHMENT_ENTRYPOINT,
  RISTOAIREN_ATTACHMENT_PERMISSION,
  RISTOAIREN_PRODUCT_ATTACHMENT_GATE,
  requireRistoairenProductAttachmentAccess,
  type CurrentProductSubscriptionResolver,
  type OrganizationContextRepository,
} from "../../../packages/platform-core/src/index.ts";
import { resolveRequestSecurityContext } from "./security-context.ts";

export type RistoairenProductAttachmentApiRequest = Readonly<{
  method: string;
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
}>;

export type RistoairenProductAttachmentApiResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
}>;

type TrustedProductAccessScope = Readonly<{
  memberships: Pick<MembershipRepository, "findTenantMembership">;
  release(): Promise<void>;
}>;

export type RistoairenProductAttachmentApiDependencies = Readonly<{
  authentication: AuthenticationAdapter;
  roles: RolePermissionResolver;
  appBaseDomain: string;
  tenantContext: Readonly<{
    tenants: TenantRepository;
    locations: LocationRepository;
    domains: TenantDomainRepository;
    memberships: MembershipRepository;
    entitlements: EntitlementRepository;
  }>;
  organizations: OrganizationContextRepository;
  productSubscriptions: CurrentProductSubscriptionResolver;
  effectiveEntitlements: CurrentTenantEffectiveEntitlementResolver;
  trustedRequestScopes: Readonly<{
    forTrustedRequestScope(input: Readonly<{
      actorIdentityId: string;
      tenantId: string;
      locationId: string;
      correlationId: string;
    }>): Promise<TrustedProductAccessScope>;
  }>;
}>;

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function correlationId(value: string | undefined): string {
  const candidate = value?.trim();
  return candidate && CORRELATION_ID.test(candidate) ? candidate : randomUUID();
}

function response(status: number, body: Readonly<Record<string, unknown>>, correlation: string, extra?: Readonly<Record<string, string>>): RistoairenProductAttachmentApiResponse {
  return Object.freeze({
    status,
    body: Object.freeze(body),
    headers: Object.freeze({
      "cache-control": "no-store",
      "x-correlation-id": correlation,
      "x-content-type-options": "nosniff",
      ...extra,
    }),
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
    case "NOT_FOUND": return 404;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "RUNTIME_CONFIGURATION_INVALID":
    case "SECRET_RESOLUTION_FAILED":
    case "INTERNAL_ERROR":
      return 500;
  }
}

function mapError(error: unknown, correlation: string): RistoairenProductAttachmentApiResponse {
  if (error instanceof AppError) {
    const status = appErrorStatus(error.code);
    return response(status, {
      error: error.code,
      message: status >= 500 ? "RISTOAIREN attachment request failed" : error.message,
      correlationId: correlation,
    }, correlation);
  }
  return response(500, { error: "INTERNAL_ERROR", message: "RISTOAIREN attachment request failed", correlationId: correlation }, correlation);
}

function pathname(url: string): string | null {
  try { return new URL(url, "http://airenos.local").pathname; }
  catch { return null; }
}

function hostname(headers: Readonly<Record<string, string | undefined>>): string {
  const host = headers.host?.trim();
  if (!host) throw new AppError("VALIDATION_FAILED", "Host header is required for RISTOAIREN Product Attachment routing");
  return host;
}

function authorizationRequest(request: RistoairenProductAttachmentApiRequest): Readonly<Record<string, unknown>> {
  // Only credential transport crosses into AIRenOS Identity. Caller-declared role/tenant headers are never authority.
  return Object.freeze({ authorization: request.headers.authorization });
}

export function isRistoairenProductAttachmentApiRequest(url: string | undefined): boolean {
  return typeof url === "string" && pathname(url) === RISTOAIREN_ATTACHMENT_ENTRYPOINT;
}

export async function dispatchRistoairenProductAttachmentApiRequest(
  request: RistoairenProductAttachmentApiRequest,
  deps: RistoairenProductAttachmentApiDependencies,
): Promise<RistoairenProductAttachmentApiResponse> {
  const correlation = correlationId(request.headers["x-correlation-id"]);
  if (!isRistoairenProductAttachmentApiRequest(request.url)) {
    return response(404, { error: "NOT_FOUND", correlationId: correlation }, correlation);
  }
  if (request.method.toUpperCase() !== "GET") {
    return response(405, { error: "METHOD_NOT_ALLOWED", correlationId: correlation }, correlation, { allow: "GET" });
  }

  try {
    const principal = requirePrincipal(await deps.authentication.authenticate(authorizationRequest(request)));
    const resolved = await resolveRequestSecurityContext({
      hostname: hostname(request.headers),
      principal,
      trustedBaseDomain: deps.appBaseDomain,
      correlationId: correlation,
      tenants: deps.tenantContext.tenants,
      locations: deps.tenantContext.locations,
      domains: deps.tenantContext.domains,
      memberships: deps.tenantContext.memberships,
      roles: deps.roles,
      entitlements: deps.tenantContext.entitlements,
    });

    const scoped = await deps.trustedRequestScopes.forTrustedRequestScope({
      actorIdentityId: resolved.context.actorIdentityId,
      tenantId: resolved.context.tenantId,
      locationId: resolved.context.locationId,
      correlationId: resolved.context.correlationId,
    });
    try {
      const access = await requireRistoairenProductAttachmentAccess({
        context: resolved.context,
        organizations: deps.organizations,
        memberships: scoped.memberships,
        productSubscriptions: deps.productSubscriptions,
        entitlements: deps.effectiveEntitlements,
      });

      return response(200, {
        gateId: RISTOAIREN_PRODUCT_ATTACHMENT_GATE.gateId,
        gateState: RISTOAIREN_PRODUCT_ATTACHMENT_GATE.gateState,
        productCode: access.productCode,
        entitlementKey: access.entitlementKey,
        permissionKey: access.permissionKey,
        session: Object.freeze({
          authority: "AIRenOS",
          authenticated: true,
          identityId: principal.identityId,
          expiresAtIso: principal.expiresAtIso,
        }),
        organizationId: access.organizationId,
        tenantId: access.tenantId,
        locationId: access.locationId,
        subscription: Object.freeze({ id: access.subscriptionId, status: access.subscriptionStatus }),
        productAccess: "ALLOWED",
        entrypoint: Object.freeze({
          method: RISTOAIREN_PRODUCT_ATTACHMENT_GATE.foundationEntrypointMethod,
          path: RISTOAIREN_PRODUCT_ATTACHMENT_GATE.foundationEntrypointPath,
          state: RISTOAIREN_PRODUCT_ATTACHMENT_GATE.foundationEntrypointState,
        }),
        experience: Object.freeze({
          target: RISTOAIREN_PRODUCT_ATTACHMENT_GATE.experienceTarget,
          attachmentState: RISTOAIREN_PRODUCT_ATTACHMENT_GATE.experienceAttachmentState,
          businessAuthority: false,
        }),
        productionEnabled: false,
        correlationId: resolved.context.correlationId,
      }, resolved.context.correlationId);
    } finally {
      await scoped.release();
    }
  } catch (error) {
    return mapError(error, correlation);
  }
}
