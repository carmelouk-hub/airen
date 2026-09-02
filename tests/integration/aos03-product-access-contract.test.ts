import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  AIRenProductCodes,
  bindProductSubscription,
  requireProductAccess,
  resolveProductAccess,
  type CurrentProductSubscriptionResolver,
  type ProductAccessControlPlaneUnitOfWork,
  type ProductSubscriptionBindingProjection,
} from "../../packages/platform-core/src/index.ts";
import type { OrganizationContextRepository } from "../../packages/platform-core/src/organization-control-plane.ts";
import type { CurrentTenantEffectiveEntitlementResolver } from "../../packages/entitlements/src/index.ts";

const ACTOR = "a0300000-0000-4000-8000-000000000001";
const ORG = "a0300000-0000-4000-8000-000000000002";
const TENANT = "a0300000-0000-4000-8000-000000000003";
const LOCATION = "a0300000-0000-4000-8000-000000000004";
const ORG_MEMBERSHIP = "a0300000-0000-4000-8000-000000000005";
const TENANT_MEMBERSHIP = "a0300000-0000-4000-8000-000000000006";
const SUBSCRIPTION = "a0300000-0000-4000-8000-000000000007";
const BINDING = "a0300000-0000-4000-8000-000000000008";

function securityContext(input: { permissions?: readonly string[]; clientEntitlements?: readonly string[] } = {}): SecurityContext {
  return {
    correlationId: "aos03-contract",
    actorIdentityId: ACTOR,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: TENANT_MEMBERSHIP,
    tenantRole: "manager",
    permissions: input.permissions ?? ["booking.read"],
    entitlements: input.clientEntitlements ?? [],
  };
}

function platformContext(permissions: readonly string[]): PlatformSecurityContext {
  return {
    scopeKind: "platform",
    correlationId: "aos03-bind",
    actorIdentityId: ACTOR,
    platformRoles: ["platform_admin"],
    platformPermissions: permissions,
  };
}

function organizations(organizationId = ORG): OrganizationContextRepository {
  return {
    async findActiveOrganizationForTenant() {
      return { id: organizationId, slug: "aos03-group", name: "AOS03 Group", status: "active" };
    },
    async findActiveMembership() {
      return { id: ORG_MEMBERSHIP, organizationId, identityId: ACTOR, roleKey: "organization_owner", status: "active" };
    },
  };
}

const memberships = {
  async findTenantMembership() {
    return { id: TENANT_MEMBERSHIP, tenantId: TENANT, identityId: ACTOR, roleKey: "manager", status: "active" as const };
  },
};

function binding(overrides: Partial<ProductSubscriptionBindingProjection> = {}): ProductSubscriptionBindingProjection {
  return {
    bindingId: BINDING,
    organizationId: ORG,
    tenantId: TENANT,
    productCode: AIRenProductCodes.BOOKING,
    entitlementKey: "airen.booking",
    subscriptionId: SUBSCRIPTION,
    subscriptionStatus: "active",
    startsAt: "2026-09-01T00:00:00.000Z",
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    createdAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

function subscriptions(value: ProductSubscriptionBindingProjection | null): CurrentProductSubscriptionResolver {
  return { async resolveCurrentProductSubscription() { return value; } };
}

function entitlements(keys: readonly string[]): CurrentTenantEffectiveEntitlementResolver {
  return {
    async resolveCurrentTenantEntitlements() {
      return keys.map((entitlementKey) => ({ entitlementKey, config: {} }));
    },
  };
}

function accessDeps(input: {
  context?: SecurityContext;
  binding?: ProductSubscriptionBindingProjection | null;
  entitlementKeys?: readonly string[];
  organizationId?: string;
} = {}) {
  return {
    context: input.context ?? securityContext(),
    organizations: organizations(input.organizationId),
    memberships,
    productSubscriptions: subscriptions(input.binding === undefined ? binding() : input.binding),
    entitlements: entitlements(input.entitlementKeys ?? ["airen.booking"]),
  };
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

test("AOS-03 derives ProductSubscription entitlement from the governed Product Registry", async () => {
  let captured: Record<string, unknown> | undefined;
  const unitOfWork: ProductAccessControlPlaneUnitOfWork = {
    async transaction(fn) {
      return fn({
        async bindProductSubscription(input) {
          captured = { ...input };
          return { binding: binding(), replayed: false };
        },
      });
    },
  };

  await bindProductSubscription(
    { idempotencyKey: "aos03-bind-001", organizationId: ORG, tenantId: TENANT, productCode: AIRenProductCodes.BOOKING, subscriptionId: SUBSCRIPTION },
    { context: platformContext(["platform.product_access.bind_subscription"]), unitOfWork },
  );
  assert.equal(captured?.productCode, AIRenProductCodes.BOOKING);
  assert.equal(captured?.entitlementKey, "airen.booking");

  await assert.rejects(
    () => bindProductSubscription(
      { idempotencyKey: "aos03-bind-002", organizationId: ORG, tenantId: TENANT, productCode: AIRenProductCodes.BOOKING, subscriptionId: SUBSCRIPTION },
      { context: platformContext([]), unitOfWork },
    ),
    expectCode("PERMISSION_DENIED"),
  );
});

test("AOS-03 ProductAccess allows only the intersection of membership, Subscription, effective Entitlement and permission", async () => {
  const access = await resolveProductAccess(
    { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
    accessDeps(),
  );
  assert.equal(access.allowed, true);
  assert.equal(access.membershipValidated, true);
  assert.equal(access.subscriptionServiceGranting, true);
  assert.equal(access.entitlementEffective, true);
  assert.equal(access.permissionGranted, true);
  assert.equal(access.productionEnabled, false);
  assert.deepEqual(access.denialReasons, []);
});

test("Client-supplied SecurityContext entitlement spoof cannot grant ProductAccess", async () => {
  const context = securityContext({ clientEntitlements: ["airen.booking"] });
  const access = await resolveProductAccess(
    { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
    accessDeps({ context, entitlementKeys: [] }),
  );
  assert.equal(access.allowed, false);
  assert.ok(access.denialReasons.includes("ENTITLEMENT_REQUIRED"));
  await assert.rejects(
    () => requireProductAccess(
      { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
      accessDeps({ context, entitlementKeys: [] }),
    ),
    expectCode("ENTITLEMENT_REQUIRED"),
  );
});

test("Effective Entitlement never bypasses RBAC permission or subscription lifecycle", async () => {
  const noPermission = await resolveProductAccess(
    { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.write", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
    accessDeps({ context: securityContext({ permissions: ["booking.read"] }) }),
  );
  assert.equal(noPermission.allowed, false);
  assert.ok(noPermission.denialReasons.includes("PERMISSION_REQUIRED"));

  const suspended = await resolveProductAccess(
    { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
    accessDeps({ binding: binding({ subscriptionStatus: "suspended" }) }),
  );
  assert.equal(suspended.allowed, false);
  assert.ok(suspended.denialReasons.includes("SUBSCRIPTION_NOT_SERVICE_GRANTING"));
});

test("ProductAccess fails closed on missing or inconsistent ProductSubscription binding", async () => {
  const missing = await resolveProductAccess(
    { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
    accessDeps({ binding: null }),
  );
  assert.equal(missing.allowed, false);
  assert.ok(missing.denialReasons.includes("PRODUCT_SUBSCRIPTION_REQUIRED"));

  const mismatchedEntitlement = await resolveProductAccess(
    { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
    accessDeps({ binding: binding({ entitlementKey: "airen.pay" }) }),
  );
  assert.equal(mismatchedEntitlement.allowed, false);
  assert.ok(mismatchedEntitlement.denialReasons.includes("PRODUCT_SUBSCRIPTION_ENTITLEMENT_MISMATCH"));

  const otherOrganization = "a0300000-0000-4000-8000-000000000099";
  const mismatchedOrganization = await resolveProductAccess(
    { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
    accessDeps({ binding: binding({ organizationId: otherOrganization }) }),
  );
  assert.equal(mismatchedOrganization.allowed, false);
  assert.ok(mismatchedOrganization.denialReasons.includes("PRODUCT_SUBSCRIPTION_ORGANIZATION_MISMATCH"));
});

test("ProductAccess preserves Tenant/Location scope and known-product authority", async () => {
  await assert.rejects(
    () => resolveProductAccess(
      { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: "a0300000-0000-4000-8000-000000000088", locationId: LOCATION } },
      accessDeps(),
    ),
    expectCode("TENANT_SCOPE_VIOLATION"),
  );
  await assert.rejects(
    () => resolveProductAccess(
      { productCode: "airen.unknown", permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
      accessDeps(),
    ),
    expectCode("NOT_FOUND"),
  );
});
