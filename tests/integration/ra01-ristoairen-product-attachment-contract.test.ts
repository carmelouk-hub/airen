import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  AIRenProductAttachmentRegistry,
  AIRenProductCodes,
  RISTOAIREN_ATTACHMENT_ENTRYPOINT,
  RISTOAIREN_ATTACHMENT_PERMISSION,
  RISTOAIREN_PRODUCT_ATTACHMENT_GATE,
  requireRistoairenProductAttachmentAccess,
  type ProductSubscriptionBindingProjection,
} from "../../packages/platform-core/src/index.ts";
import type { OrganizationContextRepository } from "../../packages/platform-core/src/organization-control-plane.ts";
import type { CurrentTenantEffectiveEntitlementResolver } from "../../packages/entitlements/src/index.ts";
import type { CurrentProductSubscriptionResolver } from "../../packages/platform-core/src/product-access.ts";

const ACTOR = "a0100000-0000-4000-8000-000000000001";
const ORG = "a0100000-0000-4000-8000-000000000002";
const TENANT = "a0100000-0000-4000-8000-000000000003";
const LOCATION = "a0100000-0000-4000-8000-000000000004";
const ORG_MEMBERSHIP = "a0100000-0000-4000-8000-000000000005";
const TENANT_MEMBERSHIP = "a0100000-0000-4000-8000-000000000006";
const SUBSCRIPTION = "a0100000-0000-4000-8000-000000000007";
const BINDING = "a0100000-0000-4000-8000-000000000008";

function context(permissions: readonly string[] = [RISTOAIREN_ATTACHMENT_PERMISSION]): SecurityContext {
  return {
    correlationId: "ra01-contract",
    actorIdentityId: ACTOR,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: TENANT_MEMBERSHIP,
    tenantRole: "ra01_operator",
    permissions,
    entitlements: [],
  };
}

const organizations: OrganizationContextRepository = {
  async findActiveOrganizationForTenant() {
    return { id: ORG, slug: "ra01-group", name: "RA01 Group", status: "active" };
  },
  async findActiveMembership() {
    return { id: ORG_MEMBERSHIP, organizationId: ORG, identityId: ACTOR, roleKey: "organization_owner", status: "active" };
  },
};

const memberships = {
  async findTenantMembership() {
    return { id: TENANT_MEMBERSHIP, tenantId: TENANT, identityId: ACTOR, roleKey: "ra01_operator", status: "active" as const };
  },
};

function binding(): ProductSubscriptionBindingProjection {
  return {
    bindingId: BINDING,
    organizationId: ORG,
    tenantId: TENANT,
    productCode: AIRenProductCodes.RISTOAIREN,
    entitlementKey: "vertical.ristoairen",
    subscriptionId: SUBSCRIPTION,
    subscriptionStatus: "active",
    startsAt: "2026-09-03T00:00:00.000Z",
    currentPeriodStart: "2026-09-03T00:00:00.000Z",
    currentPeriodEnd: "2026-10-03T00:00:00.000Z",
    createdAt: "2026-09-03T00:00:00.000Z",
  };
}

function productSubscriptions(value: ProductSubscriptionBindingProjection | null): CurrentProductSubscriptionResolver {
  return { async resolveCurrentProductSubscription() { return value; } };
}

function entitlements(keys: readonly string[]): CurrentTenantEffectiveEntitlementResolver {
  return {
    async resolveCurrentTenantEntitlements() {
      return keys.map((entitlementKey) => ({ entitlementKey, config: {} }));
    },
  };
}

function deps(input: {
  securityContext?: SecurityContext;
  binding?: ProductSubscriptionBindingProjection | null;
  entitlementKeys?: readonly string[];
} = {}) {
  return {
    context: input.securityContext ?? context(),
    organizations,
    memberships,
    productSubscriptions: productSubscriptions(input.binding === undefined ? binding() : input.binding),
    entitlements: entitlements(input.entitlementKeys ?? ["vertical.ristoairen"]),
  };
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

test("RA-01 opens a RISTOAIREN-specific gate without rewriting AOS-05 certified history", () => {
  const registered = AIRenProductAttachmentRegistry.find((item) => item.productCode === AIRenProductCodes.RISTOAIREN);
  assert.ok(registered);
  assert.equal(registered.runtimeAttachmentState, "not_attached");
  assert.equal(registered.entrypointState, "not_assigned");
  assert.equal(registered.productionEnabled, false);

  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.gateId, "RA-01");
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.gateState, "implementation_open");
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.productCode, AIRenProductCodes.RISTOAIREN);
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.entitlementKey, "vertical.ristoairen");
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.permissionKey, RISTOAIREN_ATTACHMENT_PERMISSION);
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.foundationEntrypointPath, RISTOAIREN_ATTACHMENT_ENTRYPOINT);
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.foundationEntrypointState, "wired_runtime_proven");
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.experienceAttachmentState, "not_attached");
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.experienceBusinessAuthority, false);
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.base44MayAuthorizeProduct, false);
  assert.equal(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.productionEnabled, false);
  assert.deepEqual(RISTOAIREN_PRODUCT_ATTACHMENT_GATE.dependencyProductCodes, []);
});

test("RA-01 ProductAccess allows only explicit permission plus effective entitlement, subscription and membership", async () => {
  const access = await requireRistoairenProductAttachmentAccess(deps());
  assert.equal(access.allowed, true);
  assert.equal(access.productCode, AIRenProductCodes.RISTOAIREN);
  assert.equal(access.entitlementKey, "vertical.ristoairen");
  assert.equal(access.permissionKey, RISTOAIREN_ATTACHMENT_PERMISSION);
  assert.equal(access.permissionGranted, true);
  assert.equal(access.entitlementEffective, true);
  assert.equal(access.subscriptionServiceGranting, true);
  assert.equal(access.membershipValidated, true);
  assert.equal(access.productionEnabled, false);
});

test("RA-01 fails closed on missing permission, effective entitlement or ProductSubscription", async () => {
  await assert.rejects(
    () => requireRistoairenProductAttachmentAccess(deps({ securityContext: context([]) })),
    expectCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    () => requireRistoairenProductAttachmentAccess(deps({ entitlementKeys: [] })),
    expectCode("ENTITLEMENT_REQUIRED"),
  );
  await assert.rejects(
    () => requireRistoairenProductAttachmentAccess(deps({ binding: null })),
    expectCode("PERMISSION_DENIED"),
  );
});

test("RA-01 permission migration registers authority but grants it to nobody", async () => {
  const sql = await readFile("db/migrations/0032_ra01_ristoairen_product_attachment.sql", "utf8");
  assert.match(sql, /permission_registry/i);
  assert.match(sql, /ristoairen\.access/i);
  assert.doesNotMatch(sql, /role_permission_grants/i);
  assert.doesNotMatch(sql, /membership_permission_grants/i);
  assert.doesNotMatch(sql, /productionEnabled\s*=\s*true/i);
});
