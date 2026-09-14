import test from "node:test";
import assert from "node:assert/strict";
import { handleTenantReadOnlyApi } from "../../apps/api/src/tenant-readonly-api.ts";

const tenant = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "tenant-one",
  name: "Tenant One",
  status: "active" as const,
  locale: "it-IT",
  timezone: "Europe/Rome",
  currency: "EUR",
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z"
};

function deps(permission = true) {
  let authRequest: unknown;
  const authentication = {
    async authenticate(request: unknown) {
      authRequest = request;
      return {
        identityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        providerKey: "https://identity.staging.airenos.example",
        providerSubject: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        platformRoles: ["platform_support_readonly"],
        sessionId: "session-1",
        authenticatedAtIso: "2026-09-14T12:00:00.000Z",
        expiresAtIso: "2026-09-14T12:05:00.000Z"
      };
    }
  };
  const roles = {
    async platformPermissions() { return permission ? ["platform.tenants.read"] : []; },
    async tenantPermissions() { return []; },
    async locationPermissions() { return []; }
  };
  const tenants = {
    async listTenants() { return [tenant]; },
    async getTenant(id: string) { return id === tenant.id ? tenant : null; }
  };
  return { authentication, roles, tenants, authRequest: () => authRequest };
}

test("GET /v1/tenants authenticates only from Authorization and returns governed Tenant projection", async () => {
  const d = deps();
  const result = await handleTenantReadOnlyApi({
    method: "GET",
    url: "/v1/tenants?limit=50",
    headers: {
      authorization: "Bearer opaque-session-token",
      "x-platform-role": "platform_admin",
      "x-tenant-id": "attacker-tenant",
      "x-correlation-id": "corr-tenant-054"
    }
  }, d);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items, [tenant]);
  assert.deepEqual(d.authRequest(), { authorization: "Bearer opaque-session-token" });
  assert.equal(result.headers["cache-control"], "no-store");
});

test("GET /v1/tenants/:id returns one Tenant and missing Tenant is 404", async () => {
  const d = deps();
  const ok = await handleTenantReadOnlyApi({ method: "GET", url: `/v1/tenants/${tenant.id}`, headers: { authorization: "Bearer token" } }, d);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.tenant, tenant);

  const missing = await handleTenantReadOnlyApi({ method: "GET", url: "/v1/tenants/22222222-2222-4222-8222-222222222222", headers: { authorization: "Bearer token" } }, d);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "NOT_FOUND");
});

test("Tenant read-only API fails closed without platform.tenants.read", async () => {
  const result = await handleTenantReadOnlyApi({ method: "GET", url: "/v1/tenants", headers: { authorization: "Bearer token" } }, deps(false));
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "PERMISSION_DENIED");
});

test("Tenant read-only API rejects all mutation methods before invoking Tenant authority", async () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const result = await handleTenantReadOnlyApi({ method, url: "/v1/tenants", headers: { authorization: "Bearer token" } }, deps());
    assert.equal(result.status, 405);
    assert.equal(result.body.error, "METHOD_NOT_ALLOWED");
  }
});

test("Tenant read-only API validates pagination and unknown routes fail closed", async () => {
  const invalid = await handleTenantReadOnlyApi({ method: "GET", url: "/v1/tenants?limit=not-a-number", headers: { authorization: "Bearer token" } }, deps());
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "VALIDATION_FAILED");

  const unknown = await handleTenantReadOnlyApi({ method: "GET", url: "/v1/tenants/one/extra", headers: { authorization: "Bearer token" } }, deps());
  assert.equal(unknown.status, 404);
});
