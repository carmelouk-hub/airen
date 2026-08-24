import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

const read = (path) => readFile(path, "utf8");
const [api, server, ui, html, css, pkgText, ci] = await Promise.all([
  read("apps/api/src/admin-api.ts"),
  read("apps/api/src/server.ts"),
  read("apps/admin/admin.js"),
  read("apps/admin/index.html"),
  read("apps/admin/styles.css"),
  read("package.json"),
  read(".github/workflows/ci.yml")
]);
const pkg=JSON.parse(pkgText);

const families=[
  '"session"', '"tenants"', '"locations"', '"domains"', '"principals"', '"roles"',
  '"plans"', '"subscriptions"', '"entitlements"', '"capabilities"', '"feature-flags"', '"audit"'
];
for(const marker of families) assert.ok(api.includes(marker),`R3-I route family missing: ${marker}`);

assert.ok(api.includes('ADMIN_API_PREFIX = "/api/admin/v1"'),"canonical Admin API prefix missing");
assert.ok(api.includes("requirePrincipal"),"Admin API must require an authenticated Principal");
assert.ok(api.includes("resolvePlatformSecurityContext"),"PlatformSecurityContext must be server-derived");
assert.ok(api.includes("resolveRequestSecurityContext"),"effective resolution must build Tenant SecurityContext server-side");
assert.ok(api.includes("resolveCurrentCapabilities"),"R3-G effective capability resolver must be reused");
assert.ok(api.includes("queryPlatformAudit"),"R3-H Audit query authority must be reused");
assert.ok(api.includes("idempotency-key"),"Idempotency-Key transport contract missing");
assert.ok(api.includes("mapAdminApiError"),"frozen AppError HTTP mapping missing");
assert.ok(api.includes("Deliberately no POST /locations"),"Platform createLocation prohibition marker missing");

for(const forbidden of [
  "pool.query(", "client.query(", "SELECT ", "INSERT ", "UPDATE ", "DELETE FROM ",
  "platform.admin.access", "localStorage", "sessionStorage"
]) assert.equal(api.includes(forbidden),false,`Forbidden Admin API authority pattern: ${forbidden}`);

for(const forbidden of ["createLocation(", "create-location.ts"]) assert.equal(api.includes(forbidden),false,`Platform createLocation shortcut forbidden: ${forbidden}`);
for(const forbidden of ["base44", "corte delle stelle", "ristoairen"]) {
  assert.equal(api.toLowerCase().includes(forbidden),false,`Platform-specific hardcoding forbidden in Admin API: ${forbidden}`);
  assert.equal(ui.toLowerCase().includes(forbidden),false,`Platform-specific hardcoding forbidden in Admin UI: ${forbidden}`);
}

assert.ok(server.includes("ProviderNeutralAuthenticationAdapter"),"server must wire provider-neutral AuthenticationAdapter");
for(const store of [
  "PostgresTenantProvisioningUnitOfWork","PostgresTenantControlPlaneStore","PostgresLocationControlPlaneStore",
  "PostgresTenantDomainControlPlaneStore","PostgresPlatformRoleAdminStore","PostgresBillingControlPlaneStore",
  "PostgresEntitlementControlPlaneStore","PostgresCapabilityControlPlaneStore","PostgresPlatformAuditQueryStore"
]) assert.ok(server.includes(store),`certified PostgreSQL adapter not wired: ${store}`);
assert.ok(server.includes("dispatchAdminApiRequest"),"Admin API dispatcher not wired into HTTP runtime");
assert.ok(server.includes("content-security-policy"),"Admin UI CSP missing");
assert.ok(server.includes("64 * 1024"),"Admin body-size bound missing");

for(const forbidden of ["localStorage","sessionStorage","document.cookie","Authorization:"]) assert.equal(ui.includes(forbidden),false,`Admin UI must not persist/read auth authority: ${forbidden}`);
assert.ok(ui.includes('credentials:"same-origin"'),"Admin UI must use deployment-owned same-origin credential transport");
assert.ok(ui.includes("platformPermissions"),"UI may use server-returned permissions for UX guards");
assert.ok(ui.includes("idempotency-key"),"UI governed mutations must send Idempotency-Key");
assert.ok(ui.includes("No stale state is treated as authority"),"degraded fail-closed UX marker missing");
assert.ok(html.includes('data-view="overview"') && html.includes('data-view="system"'),"eight-surface Admin shell missing");
assert.ok(css.length>1000,"Admin UI stylesheet unexpectedly incomplete");

for(const dependency of ["react","react-dom","next","vite","@vitejs/plugin-react"]) {
  assert.equal(Boolean(pkg.dependencies?.[dependency]||pkg.devDependencies?.[dependency]),false,`unapproved frontend dependency: ${dependency}`);
}
assert.deepEqual(Object.keys(pkg.dependencies??{}).sort(),["pg"],"R3-I must not add runtime package dependencies");
assert.ok(pkg.scripts["check:r3i-admin-surface-contract"],"R3-I guardrail script missing");
assert.ok(pkg.scripts["test:r3i-admin-api-contract"],"R3-I API contract test script missing");
assert.ok(pkg.scripts["test:r3i-admin-ui-contract"],"R3-I UI contract test script missing");
assert.ok(ci.includes("check:r3i-admin-surface-contract")&&ci.includes("test:r3i-admin-api-contract")&&ci.includes("test:r3i-admin-ui-contract"),"R3-I application CI wiring missing");

const migrations=(await readdir("db/migrations")).filter(x=>/^\d{4}_/.test(x)).sort();
assert.equal(migrations.at(-1)?.startsWith("0029_"),true,`R3-I must introduce no migration; found tail ${migrations.at(-1)}`);

console.log("R3-I Admin surface guardrail PASS");
