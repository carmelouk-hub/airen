import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AuthenticationAdapter } from "../../packages/identity/src/index.ts";
import type { ProductSubscriptionBindingProjection } from "../../packages/platform-core/src/product-access.ts";
import {
  RISTOAIREN_ATTACHMENT_ENTRYPOINT,
  RISTOAIREN_ATTACHMENT_PERMISSION,
} from "../../packages/platform-core/src/index.ts";
import {
  dispatchRistoairenProductAttachmentApiRequest,
  isRistoairenProductAttachmentApiRequest,
  type RistoairenProductAttachmentApiDependencies,
} from "../../apps/api/src/ristoairen-product-attachment-api.ts";

const ACTOR = "a0110000-0000-4000-8000-000000000001";
const ORG = "a0110000-0000-4000-8000-000000000002";
const TENANT = "a0110000-0000-4000-8000-000000000003";
const LOCATION = "a0110000-0000-4000-8000-000000000004";
const TENANT_MEMBERSHIP = "a0110000-0000-4000-8000-000000000005";
const LOCATION_MEMBERSHIP = "a0110000-0000-4000-8000-000000000006";
const ORG_MEMBERSHIP = "a0110000-0000-4000-8000-000000000007";
const SUBSCRIPTION = "a0110000-0000-4000-8000-000000000008";
const BINDING = "a0110000-0000-4000-8000-000000000009";

function binding(): ProductSubscriptionBindingProjection {
  return {
    bindingId: BINDING,
    organizationId: ORG,
    tenantId: TENANT,
    productCode: "ristoairen",
    entitlementKey: "vertical.ristoairen",
    subscriptionId: SUBSCRIPTION,
    subscriptionStatus: "active",
    startsAt: "2026-09-03T00:00:00.000Z",
    currentPeriodStart: "2026-09-03T00:00:00.000Z",
    currentPeriodEnd: "2026-10-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:00:00.000Z",
  };
}

function fixture(input: { permission?: boolean; entitlement?: boolean; authenticated?: boolean } = {}) {
  const permission = input.permission ?? true;
  const entitlement = input.entitlement ?? true;
  const authenticated = input.authenticated ?? true;
  let authenticationInput: unknown;
  let releases = 0;

  const authentication: AuthenticationAdapter = {
    async authenticate(request) {
      authenticationInput = request;
      return authenticated ? {
        identityId: ACTOR,
        providerKey: "airenos-test",
        providerSubject: "ra01-subject",
        platformRoles: [],
        sessionId: "must-not-be-projected",
        authenticatedAtIso: "2026-09-03T09:00:00.000Z",
        expiresAtIso: "2026-09-03T09:05:00.000Z",
      } : null;
    },
  };

  const memberships = {
    async findTenantMembership() {
      return { id: TENANT_MEMBERSHIP, tenantId: TENANT, identityId: ACTOR, roleKey: "ra01_operator", status: "active" as const };
    },
    async findLocationMembership() {
      return { id: LOCATION_MEMBERSHIP, tenantMembershipId: TENANT_MEMBERSHIP, tenantId: TENANT, locationId: LOCATION, roleKey: "ra01_location", status: "active" as const };
    },
  };

  const deps: RistoairenProductAttachmentApiDependencies = {
    authentication,
    roles: {
      async platformPermissions() { return []; },
      async tenantPermissions() { return permission ? [RISTOAIREN_ATTACHMENT_PERMISSION] : []; },
      async locationPermissions() { return []; },
    },
    appBaseDomain: "ristoairen.test",
    tenantContext: {
      tenants: {
        async findById() { return { id: TENANT, slug: "ra01-tenant", name: "RA01 Tenant", status: "active" as const }; },
        async findBySlug() { return { id: TENANT, slug: "ra01-tenant", name: "RA01 Tenant", status: "active" as const }; },
      },
      locations: {
        async findById() { return { id: LOCATION, tenantId: TENANT, slug: "main", name: "Main", status: "active" as const }; },
        async findPrimaryForTenant() { return { id: LOCATION, tenantId: TENANT, slug: "main", name: "Main", status: "active" as const }; },
      },
      domains: {
        async findActiveByHostname() { return null; },
      },
      memberships,
      entitlements: {
        async enabledForTenant() { return entitlement ? ["vertical.ristoairen"] : []; },
      },
    },
    organizations: {
      async findActiveOrganizationForTenant() { return { id: ORG, slug: "ra01-group", name: "RA01 Group", status: "active" as const }; },
      async findActiveMembership() { return { id: ORG_MEMBERSHIP, organizationId: ORG, identityId: ACTOR, roleKey: "organization_owner", status: "active" as const }; },
    },
    productSubscriptions: {
      async resolveCurrentProductSubscription() { return binding(); },
    },
    effectiveEntitlements: {
      async resolveCurrentTenantEntitlements() { return entitlement ? [{ entitlementKey: "vertical.ristoairen", config: {} }] : []; },
    },
    trustedRequestScopes: {
      async forTrustedRequestScope(scope) {
        assert.equal(scope.actorIdentityId, ACTOR);
        assert.equal(scope.tenantId, TENANT);
        assert.equal(scope.locationId, LOCATION);
        return {
          memberships,
          async release() { releases += 1; },
        };
      },
    },
  };

  return { deps, authenticationInput: () => authenticationInput, releases: () => releases };
}

function request(method = "GET", authorization = "Bearer signed-airenos-session") {
  return {
    method,
    url: RISTOAIREN_ATTACHMENT_ENTRYPOINT,
    headers: {
      authorization,
      host: "ra01-tenant.ristoairen.test",
      "x-correlation-id": "ra01-http-contract-001",
      "x-claimed-tenant": "must-never-be-authority",
      "x-claimed-role": "platform_admin",
    },
  };
}

test("RA-01 HTTP recognises only the governed RISTOAIREN attachment route", () => {
  assert.equal(isRistoairenProductAttachmentApiRequest(RISTOAIREN_ATTACHMENT_ENTRYPOINT), true);
  assert.equal(isRistoairenProductAttachmentApiRequest(`${RISTOAIREN_ATTACHMENT_ENTRYPOINT}?view=bootstrap`), true);
  assert.equal(isRistoairenProductAttachmentApiRequest("/v1/bookings"), false);
  assert.equal(isRistoairenProductAttachmentApiRequest("/v1/products/airenpay/attachment"), false);
});

test("RA-01 HTTP returns only a safe AIRenOS-authorized projection and releases trusted scope", async () => {
  const f = fixture();
  const result = await dispatchRistoairenProductAttachmentApiRequest(request(), f.deps);
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.body.productAccess, "ALLOWED");
  assert.equal(result.body.productCode, "ristoairen");
  assert.equal(result.body.entitlementKey, "vertical.ristoairen");
  assert.equal(result.body.permissionKey, RISTOAIREN_ATTACHMENT_PERMISSION);
  assert.equal(result.body.productionEnabled, false);
  assert.equal((result.body.entrypoint as Record<string, unknown>).state, "wired_pending_runtime_proof");
  assert.equal((result.body.experience as Record<string, unknown>).attachmentState, "not_attached");
  assert.equal((result.body.experience as Record<string, unknown>).businessAuthority, false);
  assert.equal((result.body.session as Record<string, unknown>).authority, "AIRenOS");
  assert.equal(Object.hasOwn(result.body.session as object, "sessionId"), false);
  assert.equal(JSON.stringify(result.body).includes("signed-airenos-session"), false);
  assert.deepEqual(f.authenticationInput(), { authorization: "Bearer signed-airenos-session" });
  assert.equal(f.releases(), 1);
});

test("RA-01 HTTP fails closed without AIRenOS authentication, permission or effective entitlement", async () => {
  assert.equal((await dispatchRistoairenProductAttachmentApiRequest(request(), fixture({ authenticated: false }).deps)).status, 401);
  const deniedPermission = await dispatchRistoairenProductAttachmentApiRequest(request(), fixture({ permission: false }).deps);
  assert.equal(deniedPermission.status, 403);
  assert.equal(deniedPermission.body.error, "PERMISSION_DENIED");
  const deniedEntitlement = await dispatchRistoairenProductAttachmentApiRequest(request(), fixture({ entitlement: false }).deps);
  assert.equal(deniedEntitlement.status, 403);
  assert.equal(deniedEntitlement.body.error, "ENTITLEMENT_REQUIRED");
});

test("RA-01 HTTP rejects invalid method and unresolved host without falling into the server 500 path", async () => {
  const method = await dispatchRistoairenProductAttachmentApiRequest(request("POST"), fixture().deps);
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, "GET");

  const missingHost = request();
  const bad = await dispatchRistoairenProductAttachmentApiRequest({ ...missingHost, headers: { ...missingHost.headers, host: undefined } }, fixture().deps);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "VALIDATION_FAILED");
});

test("RA-01 HTTP is wired into the single Foundation server before legacy Booking dispatch", async () => {
  const module = await import("../../apps/api/src/server.ts");
  assert.equal(typeof module.startFoundationHttpServer, "function");
  const serverSource = await readFile("apps/api/src/server.ts", "utf8");
  const attachmentIndex = serverSource.indexOf("isRistoairenProductAttachmentApiRequest(request.url)");
  const bookingIndex = serverSource.indexOf("isRistoBookingApiRequest(request.url)");
  assert.ok(attachmentIndex > 0);
  assert.ok(bookingIndex > attachmentIndex);
  assert.match(serverSource, /ProviderNeutralAuthenticationAdapter/);
  assert.match(serverSource, /trustedRequestScopes:\s*foundationReads/);
  assert.doesNotMatch(serverSource, /base44\.auth\.me/);
});
