import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BRANCH = "foundation/airenos-identity-f25d-render-managed-role-compatibility-20260905";
const IDENTITY_DB = "airenos-identity-f25-staging-db";

test("F2.5D Render blueprint binds the dedicated Identity DB without embedding credentials", async () => {
  const blueprint = await readFile("render.identity.f25.yaml", "utf8");

  assert.match(blueprint, new RegExp(`branch: ${BRANCH.replaceAll("/", "\\/")}`));
  assert.match(blueprint, /name: airenos-session-authority-f25-staging/);
  assert.match(blueprint, /runtime: docker/);
  assert.match(blueprint, /plan: starter/);
  assert.match(blueprint, /region: frankfurt/);
  assert.match(blueprint, /autoDeployTrigger: off/);
  assert.match(blueprint, /dockerfilePath: \.\/deploy\/Dockerfile\.session-authority/);
  assert.match(blueprint, /healthCheckPath: \/health\/ready/);
  assert.match(blueprint, new RegExp(`name: ${IDENTITY_DB}`));
  assert.match(blueprint, /fromDatabase:\s*\n\s+name: airenos-identity-f25-staging-db\s*\n\s+property: connectionString/);
  assert.doesNotMatch(blueprint, /SESSION_AUTHORITY_DATABASE_URL\s*\n\s+sync: false/);
  assert.doesNotMatch(blueprint, /^databases:/m);
  assert.doesNotMatch(blueprint, /ristoairen|airen_rbl01c2|dpg-da87bdad0e5s739slf20-a/i);
  assert.doesNotMatch(blueprint, /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i);
});

test("F2.5D dedicated Identity bootstrap is Render-managed-role compatible and fail-closed", async () => {
  const bootstrap = await readFile("db/identity/0001_identity_session_authority_boundary.sql", "utf8");
  const binding = await readFile("db/identity/0002_bind_runtime_principal.sql", "utf8");

  assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS identity/);
  assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS authz/);
  assert.match(bootstrap, /CREATE SCHEMA IF NOT EXISTS security/);
  assert.doesNotMatch(bootstrap, /CREATE SCHEMA IF NOT EXISTS platform/);
  assert.doesNotMatch(bootstrap, /CREATE SCHEMA IF NOT EXISTS billing/);
  assert.doesNotMatch(bootstrap, /CREATE SCHEMA IF NOT EXISTS audit/);
  assert.doesNotMatch(bootstrap, /CREATE SCHEMA IF NOT EXISTS events/);
  assert.doesNotMatch(bootstrap, /CREATE TABLE(?: IF NOT EXISTS)? platform\./);
  assert.doesNotMatch(bootstrap, /CREATE TABLE(?: IF NOT EXISTS)? billing\./);
  assert.doesNotMatch(bootstrap, /tenant_memberships|tenant_entitlements|tenant_domains|platform\.tenants|platform\.locations/);

  assert.match(bootstrap, /CREATE ROLE airen_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/);
  assert.doesNotMatch(bootstrap, /ALTER ROLE airen_auth/);
  assert.match(bootstrap, /rolcanlogin/);
  assert.match(bootstrap, /rolsuper/);
  assert.match(bootstrap, /rolbypassrls/);
  assert.match(bootstrap, /rolcreaterole/);
  assert.match(bootstrap, /rolcreatedb/);
  assert.match(bootstrap, /rolinherit/);
  assert.match(bootstrap, /rolreplication/);
  assert.match(bootstrap, /RAISE EXCEPTION 'airen_auth role attributes are unsafe'/);
  assert.match(bootstrap, /VALUES \('F2\.5D-0001'\)/);
  assert.match(bootstrap, /REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM airen_auth/);
  assert.match(bootstrap, /GRANT EXECUTE ON FUNCTION security\.resolve_authentication_identity/);
  assert.match(bootstrap, /GRANT EXECUTE ON FUNCTION security\.register_airenos_session/);

  assert.match(binding, /AND NOT rolsuper/);
  assert.match(binding, /AND NOT rolbypassrls/);
  assert.match(binding, /AND NOT rolcreaterole/);
  assert.match(binding, /AND NOT rolcreatedb/);
  assert.match(binding, /n\.nspname IN \('identity','authz','security'\)/);
  assert.match(binding, /GRANT airen_auth TO %I/);
  assert.doesNotMatch(binding, /\bPASSWORD\s+['"]/i);
  assert.doesNotMatch(binding, /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/i);
});
