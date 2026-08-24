import test from "node:test";
import assert from "node:assert/strict";
import { authenticateAndResolvePlatformSecurityContext, resolvePlatformSecurityContext } from "../../apps/api/src/platform-security-context.ts";
import { requirePlatformPermission, type RolePermissionResolver } from "../../packages/authorization/src/index.ts";
import type { AuthenticationAdapter, AuthenticatedPrincipal } from "../../packages/identity/src/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const roles: RolePermissionResolver = {
  platformPermissions: async (platformRoles) => platformRoles.includes("platform_admin") ? ["platform.tenants.provision"] : [],
  tenantPermissions: async () => ["tenant.locations.manage"],
  locationPermissions: async () => []
};

const platformPrincipal: AuthenticatedPrincipal = {
  identityId: "aaaaaaaa-0000-4000-8000-000000000001",
  providerKey: "synthetic",
  providerSubject: "platform-admin",
  platformRoles: ["platform_admin"]
};

const authentication: AuthenticationAdapter = {
  authenticate: async () => platformPrincipal
};

test("authenticated platform principal builds platform authority without fake Tenant scope", async () => {
  const { principal, context } = await authenticateAndResolvePlatformSecurityContext({ request: {}, authentication, roles, correlationId: "r3a-platform-context" });
  assert.equal(principal.identityId, platformPrincipal.identityId);
  assert.equal(context.scopeKind, "platform");
  assert.equal(context.actorIdentityId, platformPrincipal.identityId);
  assert.equal(Object.prototype.hasOwnProperty.call(context, "tenantId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(context, "locationId"), false);
  requirePlatformPermission(context, "platform.tenants.provision");
});

test("tenant-style role names do not become platform authority", async () => {
  const { context } = await resolvePlatformSecurityContext({
    principal: { ...platformPrincipal, platformRoles: ["tenant_admin"] },
    roles,
    correlationId: "r3a-tenant-role-denied"
  });
  assert.throws(
    () => requirePlatformPermission(context, "platform.tenants.provision"),
    (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED"
  );
});
