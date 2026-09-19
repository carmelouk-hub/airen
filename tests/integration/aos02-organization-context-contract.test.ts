import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type PlatformSecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  bindTenantToOrganization,
  provisionOrganization,
  resolveOrganizationTenantContext,
  type OrganizationContextRepository,
  type OrganizationControlPlaneUnitOfWork
} from "../../packages/platform-core/src/organization-control-plane.ts";

const ACTOR = "a0200000-0000-4000-8000-000000000001";
const TENANT = "a0200000-0000-4000-8000-000000000002";
const ORG = "a0200000-0000-4000-8000-000000000003";
const ORG_MEMBERSHIP = "a0200000-0000-4000-8000-000000000004";
const TENANT_MEMBERSHIP = "a0200000-0000-4000-8000-000000000005";

function platformContext(permissions: readonly string[]): PlatformSecurityContext {
  return { scopeKind: "platform", correlationId: "aos02-contract", actorIdentityId: ACTOR, platformRoles: ["aos02_admin"], platformPermissions: permissions };
}

function fakeUow(): OrganizationControlPlaneUnitOfWork {
  return {
    async transaction(fn) {
      return fn({
        async provisionOrganization(input) {
          return { organization: { id: ORG, slug: input.slug, name: input.name, legalName: input.legalName, status: "active" }, initialMembershipId: ORG_MEMBERSHIP, replayed: false };
        },
        async bindTenant(input) { return { organizationId: input.organizationId, tenantId: input.tenantId, replayed: false }; }
      });
    }
  };
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

test("AOS-02 keeps Organization distinct from Tenant and normalizes Organization provisioning input", async () => {
  const result = await provisionOrganization(
    { idempotencyKey: "aos02-org-001", slug: "Gruppo-Alfa", name: "  Gruppo Alfa  ", legalName: "  Gruppo Alfa Srl  " },
    { context: platformContext(["platform.organizations.provision"]), unitOfWork: fakeUow() }
  );
  assert.equal(result.organization.id, ORG);
  assert.equal(result.organization.slug, "gruppo-alfa");
  assert.equal(result.organization.name, "Gruppo Alfa");
  assert.equal(result.organization.legalName, "Gruppo Alfa Srl");
  assert.notEqual(result.organization.id, TENANT);
});

test("AOS-02 platform mutations require explicit Organization permissions", async () => {
  await assert.rejects(
    () => provisionOrganization({ idempotencyKey: "aos02-org-002", slug: "alpha", name: "Alpha" }, { context: platformContext([]), unitOfWork: fakeUow() }),
    expectCode("PERMISSION_DENIED")
  );
  await assert.rejects(
    () => bindTenantToOrganization({ idempotencyKey: "aos02-bind-001", organizationId: ORG, tenantId: TENANT }, { context: platformContext([]), unitOfWork: fakeUow() }),
    expectCode("PERMISSION_DENIED")
  );
});

test("AOS-02 context requires OrganizationMembership before TenantMembership", async () => {
  let organizationMembershipEnabled = false;
  let tenantMembershipEnabled = false;
  const organizations: OrganizationContextRepository = {
    async findActiveOrganizationForTenant() { return { id: ORG, slug: "gruppo-alfa", name: "Gruppo Alfa", status: "active" }; },
    async findActiveMembership() {
      return organizationMembershipEnabled ? { id: ORG_MEMBERSHIP, organizationId: ORG, identityId: ACTOR, roleKey: "organization_owner", status: "active" } : null;
    }
  };
  const memberships = {
    async findTenantMembership() {
      return tenantMembershipEnabled ? { id: TENANT_MEMBERSHIP, tenantId: TENANT, identityId: ACTOR, roleKey: "owner", status: "active" as const } : null;
    }
  };
  await assert.rejects(() => resolveOrganizationTenantContext({ identityId: ACTOR, tenantId: TENANT }, { organizations, memberships }), expectCode("MEMBERSHIP_REQUIRED"));
  organizationMembershipEnabled = true;
  await assert.rejects(() => resolveOrganizationTenantContext({ identityId: ACTOR, tenantId: TENANT }, { organizations, memberships }), expectCode("MEMBERSHIP_REQUIRED"));
  tenantMembershipEnabled = true;
  const context = await resolveOrganizationTenantContext({ identityId: ACTOR, tenantId: TENANT }, { organizations, memberships });
  assert.equal(context.organization.id, ORG);
  assert.equal(context.organizationMembership.id, ORG_MEMBERSHIP);
  assert.equal(context.tenantMembership.id, TENANT_MEMBERSHIP);
});

test("AOS-02 does not introduce ProductAccess or entitlement authority", async () => {
  const module = await import("../../packages/platform-core/src/organization-control-plane.ts");
  assert.equal("ProductAccess" in module, false);
  assert.equal("entitlement" in module, false);
});
