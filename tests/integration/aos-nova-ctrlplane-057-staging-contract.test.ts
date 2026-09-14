import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SessionAuthorityPrincipalAuthenticationAdapter } from "../../apps/api/src/session-authority-principal-authentication.ts";

const branchFiles = {
  sql: "db/migrations/0036_aos_nova_tenant_read_claim_bridge.sql",
  principal: "apps/api/src/session-authority-principal-http.ts",
  server: "apps/api/src/tenant-control-plane-staging-server.ts",
};

test("Gate 057 SQL bridge is read-only and permission-gated", async () => {
  const sql = await readFile(branchFiles.sql, "utf8");
  assert.match(sql, /platform_permissions_for_roles/);
  assert.match(sql, /platform_get_tenant_for_roles/);
  assert.match(sql, /platform_list_tenants_for_roles/);
  assert.match(sql, /platform\.tenants\.read/);
  assert.match(sql, /GRANT EXECUTE .* TO airen_control_plane/);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+platform\.tenants/i);
  assert.doesNotMatch(sql, /UPDATE\s+platform\.tenants/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+platform\.tenants/i);
});

test("Session Authority principal bridge rejects browser-origin authority", async () => {
  const source = await readFile(branchFiles.principal, "utf8");
  assert.match(source, /\/v1\/session\/principal/);
  assert.match(source, /if \(header\(request, "origin"\)\)/);
  assert.match(source, /PostgresAirenOSIdentityDirectory/);
  assert.doesNotMatch(source, /x-airenos-role|x-platform-role|x-tenant-role/i);
});

test("Tenant staging server forwards only bearer and correlation metadata", async () => {
  const source = await readFile(branchFiles.server, "utf8");
  assert.match(source, /authorization: header\(request, "authorization"\)/);
  assert.match(source, /"x-correlation-id": header\(request, "x-correlation-id"\)/);
  assert.doesNotMatch(source, /x-airenos-role|x-platform-role|x-tenant-role/i);
});

test("principal adapter fails closed and accepts roles only from canonical response", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const adapter = new SessionAuthorityPrincipalAuthenticationAdapter({
      AIRENOS_SESSION_AUTHORITY_INTERNAL_BASE_URL: "https://session.example.test",
      AIRENOS_SESSION_AUTHORITY_TIMEOUT_MS: "1000",
    });
    assert.equal(await adapter.authenticate({}), null);

    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, "Bearer proof");
      return new Response(JSON.stringify({
        identityId: "11111111-1111-4111-8111-111111111111",
        platformRoles: ["platform_admin"],
        sessionId: "22222222-2222-4222-8222-222222222222",
        issuedAtIso: "2026-09-14T15:00:00.000Z",
        expiresAtIso: "2026-09-14T15:05:00.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const principal = await adapter.authenticate({ authorization: "Bearer proof", platformRoles: ["forged"] });
    assert.ok(principal);
    assert.deepEqual(principal.platformRoles, ["platform_admin"]);
    assert.notDeepEqual(principal.platformRoles, ["forged"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
