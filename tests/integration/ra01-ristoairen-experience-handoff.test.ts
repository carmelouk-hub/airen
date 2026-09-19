import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import type { AuthenticationAdapter } from "../../packages/identity/src/index.ts";
import {
  RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT,
  RISTOAIREN_HANDOFF_EXCHANGE_PATH,
  RISTOAIREN_HANDOFF_ISSUE_PATH,
  type RistoairenExperienceHandoffStore,
} from "../../packages/platform-core/src/index.ts";
import {
  dispatchRistoairenProductAttachmentApiRequest,
  type RistoairenProductAttachmentApiDependencies,
} from "../../apps/api/src/ristoairen-product-attachment-api.ts";

const ACTOR = "a0130000-0000-4000-8000-000000000001";
const ORG = "a0130000-0000-4000-8000-000000000002";
const TENANT = "a0130000-0000-4000-8000-000000000003";
const LOCATION = "a0130000-0000-4000-8000-000000000004";
const TENANT_MEMBERSHIP = "a0130000-0000-4000-8000-000000000005";
const LOCATION_MEMBERSHIP = "a0130000-0000-4000-8000-000000000006";
const ORG_MEMBERSHIP = "a0130000-0000-4000-8000-000000000007";
const SUBSCRIPTION = "a0130000-0000-4000-8000-000000000008";
const BINDING = "a0130000-0000-4000-8000-000000000009";
const HANDOFF = "a0130000-0000-4000-8000-000000000010";
const CODE = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function fixture(input: { authenticated?: boolean; permission?: boolean; entitlement?: boolean; consumeError?: boolean } = {}) {
  const authenticated = input.authenticated ?? true;
  const permission = input.permission ?? true;
  const entitlement = input.entitlement ?? true;
  let authCalls = 0;
  let issueCalls = 0;
  let consumeCalls = 0;

  const authentication: AuthenticationAdapter = {
    async authenticate() {
      authCalls += 1;
      return authenticated ? {
        identityId: ACTOR,
        providerKey: "airenos-test",
        providerSubject: "ra01-handoff-subject",
        platformRoles: [],
        sessionId: "never-project-this-session",
        authenticatedAtIso: "2026-09-03T10:00:00.000Z",
        expiresAtIso: "2026-09-03T10:05:00.000Z",
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

  const handoffs: RistoairenExperienceHandoffStore = {
    async issue(request) {
      issueCalls += 1;
      assert.equal(request.context.actorIdentityId, ACTOR);
      assert.equal(request.organizationId, ORG);
      assert.equal(request.subscriptionId, SUBSCRIPTION);
      return { launchCode: CODE, expiresAtIso: "2026-09-03T10:01:00.000Z" };
    },
    async consume(code) {
      consumeCalls += 1;
      if (input.consumeError || code !== CODE) throw new AppError("AUTHENTICATION_REQUIRED", "RISTOAIREN Experience handoff is invalid or expired");
      return {
        handoffId: HANDOFF,
        actorIdentityId: ACTOR,
        organizationId: ORG,
        tenantId: TENANT,
        locationId: LOCATION,
        subscriptionId: SUBSCRIPTION,
        productCode: "ristoairen",
        entitlementKey: "vertical.ristoairen",
        permissionKey: "ristoairen.access",
        issuedAtIso: "2026-09-03T10:00:00.000Z",
        consumedAtIso: "2026-09-03T10:00:10.000Z",
        projectionExpiresAtIso: "2026-09-03T10:01:10.000Z",
        sourceCorrelationId: "ra01-handoff-source-001",
      };
    },
  };

  const deps: RistoairenProductAttachmentApiDependencies = {
    authentication,
    roles: {
      async platformPermissions() { return []; },
      async tenantPermissions() { return permission ? ["ristoairen.access"] : []; },
      async locationPermissions() { return []; },
    },
    appBaseDomain: "ristoairen.test",
    tenantContext: {
      tenants: {
        async findById() { return { id: TENANT, slug: "ra01-handoff", name: "RA01 Handoff", status: "active" as const }; },
        async findBySlug() { return { id: TENANT, slug: "ra01-handoff", name: "RA01 Handoff", status: "active" as const }; },
      },
      locations: {
        async findById() { return { id: LOCATION, tenantId: TENANT, slug: "main", name: "Main", status: "active" as const }; },
        async findPrimaryForTenant() { return { id: LOCATION, tenantId: TENANT, slug: "main", name: "Main", status: "active" as const }; },
      },
      domains: { async findActiveByHostname() { return null; } },
      memberships,
      entitlements: { async enabledForTenant() { return entitlement ? ["vertical.ristoairen"] : []; } },
    },
    organizations: {
      async findActiveOrganizationForTenant() { return { id: ORG, slug: "ra01-group", name: "RA01 Group", status: "active" as const }; },
      async findActiveMembership() { return { id: ORG_MEMBERSHIP, organizationId: ORG, identityId: ACTOR, roleKey: "organization_owner", status: "active" as const }; },
    },
    productSubscriptions: {
      async resolveCurrentProductSubscription() {
        return {
          bindingId: BINDING,
          organizationId: ORG,
          tenantId: TENANT,
          productCode: "ristoairen",
          entitlementKey: "vertical.ristoairen",
          subscriptionId: SUBSCRIPTION,
          subscriptionStatus: "active" as const,
          startsAt: "2026-09-03T00:00:00.000Z",
          currentPeriodStart: "2026-09-03T00:00:00.000Z",
          currentPeriodEnd: "2026-10-03T00:00:00.000Z",
          createdAt: "2026-09-03T00:00:00.000Z",
        };
      },
    },
    effectiveEntitlements: {
      async resolveCurrentTenantEntitlements() { return entitlement ? [{ entitlementKey: "vertical.ristoairen", config: {} }] : []; },
    },
    handoffs,
    trustedRequestScopes: {
      async forTrustedRequestScope() {
        return { memberships, async release() {} };
      },
    },
  };

  return { deps, authCalls: () => authCalls, issueCalls: () => issueCalls, consumeCalls: () => consumeCalls };
}

function request(path: string, body?: unknown, authorization = "Bearer real-airenos-session") {
  return {
    method: "POST",
    url: path,
    headers: {
      authorization,
      host: "ra01-handoff.ristoairen.test",
      "x-correlation-id": "ra01-handoff-http-001",
    },
    body,
  };
}

test("RA-01 Experience handoff contract is one-time, hash-only and non-authoritative", () => {
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.handoffState, "wired_runtime_proven");
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.launchCodeStorage, "sha256_only");
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.launchCodeSingleUse, true);
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.launchCodeTtlSeconds, 60);
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.browserTransport, "url_fragment_only");
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.issueRequiresAirenOSSession, true);
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.issueRequiresProductAccess, true);
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.exchangeRequiresBase44Authority, false);
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.projectionAuthoritativeForMutations, false);
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.experienceAttachmentState, "not_attached");
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.base44MayAuthorizeProduct, false);
  assert.equal(RISTOAIREN_EXPERIENCE_HANDOFF_CONTRACT.productionEnabled, false);
});

test("RA-01 launch issuance requires AIRenOS ProductAccess and exposes no AIRenOS bearer", async () => {
  const f = fixture();
  const result = await dispatchRistoairenProductAttachmentApiRequest(request(RISTOAIREN_HANDOFF_ISSUE_PATH), f.deps);
  assert.equal(result.status, 201);
  assert.equal(result.body.productAccess, "ALLOWED");
  assert.equal(result.body.launchCode, CODE);
  assert.equal((result.body.transport as Record<string, unknown>).browser, "url_fragment_only");
  assert.equal((result.body.transport as Record<string, unknown>).bearerSessionExposedToExperience, false);
  assert.equal(JSON.stringify(result.body).includes("real-airenos-session"), false);
  assert.equal(JSON.stringify(result.body).includes("never-project-this-session"), false);
  assert.equal(f.authCalls(), 1);
  assert.equal(f.issueCalls(), 1);
});

test("RA-01 exchange consumes only the launch capability and returns a non-authoritative projection", async () => {
  const f = fixture();
  const result = await dispatchRistoairenProductAttachmentApiRequest(request(RISTOAIREN_HANDOFF_EXCHANGE_PATH, { launchCode: CODE }, "Bearer must-not-be-consulted"), f.deps);
  assert.equal(result.status, 200);
  assert.equal(result.body.authority, "AIRenOS");
  assert.equal(result.body.productAccess, "ALLOWED");
  assert.equal(result.body.tenantId, TENANT);
  assert.equal((result.body.handoff as Record<string, unknown>).singleUse, true);
  assert.equal((result.body.experience as Record<string, unknown>).attachmentState, "not_attached");
  assert.equal((result.body.experience as Record<string, unknown>).businessAuthority, false);
  assert.equal((result.body.experience as Record<string, unknown>).authoritativeForMutations, false);
  assert.equal(result.body.productionEnabled, false);
  assert.equal(f.authCalls(), 0);
  assert.equal(f.consumeCalls(), 1);
});

test("RA-01 handoff fails closed on missing session, permission, entitlement or invalid launch code", async () => {
  assert.equal((await dispatchRistoairenProductAttachmentApiRequest(request(RISTOAIREN_HANDOFF_ISSUE_PATH), fixture({ authenticated: false }).deps)).status, 401);
  assert.equal((await dispatchRistoairenProductAttachmentApiRequest(request(RISTOAIREN_HANDOFF_ISSUE_PATH), fixture({ permission: false }).deps)).status, 403);
  assert.equal((await dispatchRistoairenProductAttachmentApiRequest(request(RISTOAIREN_HANDOFF_ISSUE_PATH), fixture({ entitlement: false }).deps)).status, 403);
  const invalid = await dispatchRistoairenProductAttachmentApiRequest(request(RISTOAIREN_HANDOFF_EXCHANGE_PATH, { launchCode: CODE }), fixture({ consumeError: true }).deps);
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.error, "AUTHENTICATION_REQUIRED");
});
