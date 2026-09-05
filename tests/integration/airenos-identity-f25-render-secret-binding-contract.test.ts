import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BRANCH = "foundation/airenos-identity-f25e-effective-runtime-authority-20260905";
const IDENTITY_DB = "airenos-identity-f25-staging-db";

test("F2.5E blueprint requires an explicitly supplied unmanaged runtime secret", async () => {
  const blueprint = await readFile("render.identity.f25.yaml", "utf8");

  assert.match(blueprint, new RegExp(`branch: ${BRANCH.replaceAll("/", "\\/")}`));
  assert.match(blueprint, /name: airenos-session-authority-f25-staging/);
  assert.match(blueprint, /runtime: docker/);
  assert.match(blueprint, /plan: starter/);
  assert.match(blueprint, /region: frankfurt/);
  assert.match(blueprint, /autoDeployTrigger: off/);
  assert.match(blueprint, /dockerfilePath: \.\/deploy\/Dockerfile\.session-authority/);
  assert.match(blueprint, /healthCheckPath: \/health\/ready/);
  assert.match(blueprint, /SECRET_MANAGER_ADAPTER\s*\n\s+value: env/);
  assert.match(blueprint, /SESSION_AUTHORITY_DATABASE_URL_SECRET_REF\s*\n\s+value: secret:\/\/env\/SESSION_AUTHORITY_DATABASE_URL/);
  assert.match(blueprint, /SESSION_AUTHORITY_DATABASE_URL\s*\n\s+sync: false/);
  assert.doesNotMatch(blueprint, /fromDatabase:/);
  assert.doesNotMatch(blueprint, new RegExp(`name: ${IDENTITY_DB}\\s*\\n\\s+property: connectionString`));
  assert.doesNotMatch(blueprint, /^databases:/m);
  assert.doesNotMatch(blueprint, /ristoairen|airen_rbl01c2|dpg-da87bdad0e5s739slf20-a/i);
  assert.doesNotMatch(blueprint, /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i);
});

test("F2.5E preserves F2.5D bootstrap safety and adds effective-authority checks", async () => {
  const bootstrap = await readFile("db/identity/0001_identity_session_authority_boundary.sql", "utf8");
  const legacyBinding = await readFile("db/identity/0002_bind_runtime_principal.sql", "utf8");
  const effectiveBinding = await readFile("db/identity/0003_bind_effective_runtime_authority.sql", "utf8");

  assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS identity/);
  assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS authz/);
  assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS security/);
  assert.doesNotMatch(bootstrap, /CREATE SCHEMA IF NOT EXISTS platform/);
  assert.doesNotMatch(bootstrap, /CREATE SCHEMA IF NOT EXISTS billing/);
  assert.doesNotMatch(bootstrap, /CREATE SCHEMA IF NOT EXISTS audit/);
  assert.doesNotMatch(bootstrap, /CREATE SCHEMA IF NOT EXISTS events/);
  assert.doesNotMatch(bootstrap, /tenant_memberships|tenant_entitlements|tenant_domains|platform\.tenants|platform\.locations/);
  assert.match(bootstrap, /CREATE ROLE airen_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/);
  assert.doesNotMatch(bootstrap, /ALTER ROLE airen_auth/);
  assert.match(bootstrap, /VALUES \('F2\.5D-0001'\)/);

  assert.match(legacyBinding, /AND NOT rolsuper/);
  assert.match(legacyBinding, /AND NOT rolbypassrls/);
  assert.match(legacyBinding, /GRANT airen_auth TO %I/);
  assert.doesNotMatch(legacyBinding, /NOT rolinherit/);
  assert.doesNotMatch(legacyBinding, /pg_db_role_setting/);

  assert.match(effectiveBinding, /AND NOT rolinherit/);
  assert.match(effectiveBinding, /AND NOT rolreplication/);
  assert.match(effectiveBinding, /pg_auth_members/);
  assert.match(effectiveBinding, /granted_role\.rolname <> 'airen_auth'/);
  assert.match(effectiveBinding, /pg_db_role_setting/);
  assert.match(effectiveBinding, /config\.value LIKE 'role=%'/);
  assert.match(effectiveBinding, /NOT has_database_privilege/);
  assert.match(effectiveBinding, /NOT has_schema_privilege/);
  assert.match(effectiveBinding, /WITH ADMIN FALSE, INHERIT FALSE, SET TRUE/);
  assert.match(effectiveBinding, /NOT m\.admin_option/);
  assert.match(effectiveBinding, /NOT m\.inherit_option/);
  assert.match(effectiveBinding, /m\.set_option/);
  assert.match(effectiveBinding, /VALUES \('F2\.5E-0003'\)/);
  assert.doesNotMatch(effectiveBinding, /\bPASSWORD\s+['"]/i);
  assert.doesNotMatch(effectiveBinding, /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i);
});
