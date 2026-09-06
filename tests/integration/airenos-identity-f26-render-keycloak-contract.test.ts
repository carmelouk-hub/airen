import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BRANCH = "foundation/airenos-identity-f26-keycloak-render-staging-20260906";

test("F2.6 Render Keycloak staging contract is production-mode and cost bounded", async () => {
  const blueprint = await readFile("render.identity.keycloak.f26.yaml", "utf8");
  const containerfile = await readFile("deploy/keycloak/Containerfile", "utf8");

  assert.match(blueprint, /name:\s+airenos-keycloak-f26-staging/);
  assert.match(blueprint, /runtime:\s+docker/);
  assert.match(blueprint, /plan:\s+standard/);
  assert.match(blueprint, /region:\s+frankfurt/);
  assert.match(blueprint, /repo:\s+https:\/\/github\.com\/carmelouk-hub\/airen/);
  assert.match(blueprint, new RegExp(`branch:\\s+${BRANCH.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`));
  assert.match(blueprint, /dockerfilePath:\s+\.\/deploy\/keycloak\/Containerfile/);
  assert.match(blueprint, /healthCheckPath:\s+\/health\/ready/);
  assert.match(blueprint, /autoDeployTrigger:\s+off/);
  assert.match(containerfile, /quay\.io\/keycloak\/keycloak:26\.7\.2/g);
  assert.match(containerfile, /CMD \["start", "--optimized"\]/);
  assert.doesNotMatch(containerfile, /start-dev/);
});

test("F2.6 secrets are external and Render health reaches the Keycloak main listener", async () => {
  const blueprint = await readFile("render.identity.keycloak.f26.yaml", "utf8");

  for (const key of [
    "KC_DB_URL",
    "KC_DB_USERNAME",
    "KC_DB_PASSWORD",
    "KC_BOOTSTRAP_ADMIN_USERNAME",
    "KC_BOOTSTRAP_ADMIN_PASSWORD",
  ]) {
    assert.match(blueprint, new RegExp(`- key: ${key}\\n\\s+sync: false`));
  }

  assert.match(blueprint, /- key: KC_HTTP_ENABLED\n\s+value: "true"/);
  assert.match(blueprint, /- key: KC_HTTP_PORT\n\s+value: "10000"/);
  assert.match(blueprint, /- key: KC_PROXY_HEADERS\n\s+value: xforwarded/);
  assert.match(blueprint, /- key: KC_HTTP_MANAGEMENT_HEALTH_ENABLED\n\s+value: "false"/);
  assert.match(blueprint, /- key: KC_SERVER_ASYNC_BOOTSTRAP\n\s+value: "false"/);
  assert.doesNotMatch(blueprint, /password:\/\//i);
  assert.doesNotMatch(blueprint, /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/i);
});

test("F2.6 keeps Keycloak outside AIRenOS business and session authority", async () => {
  const realm = JSON.parse(await readFile("deploy/keycloak/realm-contract.json", "utf8"));

  assert.equal(realm.authority_boundary.keycloak_authenticates_upstream_subject, true);
  assert.equal(realm.authority_boundary.keycloak_is_airenos_canonical_identity_authority, false);
  assert.equal(realm.authority_boundary.keycloak_roles_are_airenos_authority, false);
  assert.equal(realm.authority_boundary.keycloak_tenant_claims_are_airenos_authority, false);
  assert.equal(realm.authority_boundary.keycloak_entitlements_are_airenos_authority, false);
  assert.equal(realm.authority_boundary.upstream_access_token_is_airenos_bearer, false);
  assert.equal(realm.authority_boundary.airenos_session_authority_remains_canonical, true);
  assert.equal(realm.database_boundary.keycloak_database, "DEDICATED_POSTGRESQL");
  assert.equal(realm.database_boundary.airenos_database_shared, false);
});

test("F2.6 database provisioner is idempotent, secretless, least privilege and cleanup-safe", async () => {
  const sql = await readFile("deploy/keycloak/provision-render-logical-database.sql", "utf8");

  assert.match(sql, /airenos_keycloak_runtime_f26/);
  assert.match(sql, /airenos_keycloak_f26_staging/);
  assert.match(sql, /CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L/);
  assert.match(sql, /keycloak_runtime_role_unsafe/);
  assert.match(sql, /ALTER ROLE %I WITH LOGIN NOINHERIT PASSWORD %L/);
  assert.doesNotMatch(sql, /ALTER ROLE %I[^\n]+NOSUPERUSER/);
  assert.match(sql, /WHERE NOT EXISTS[\s\S]+pg_catalog\.pg_roles/);
  assert.match(sql, /GRANT %I TO %I WITH INHERIT FALSE, SET TRUE GRANTED BY %I/);
  assert.match(sql, /REVOKE %I FROM %I GRANTED BY %I/);
  assert.match(sql, /provider_admin_bootstrap_control_restored/);
  assert.match(sql, /CREATE DATABASE %I OWNER %I/);
  assert.match(sql, /WHERE NOT EXISTS[\s\S]+pg_catalog\.pg_database/);
  assert.match(sql, /RAISE EXCEPTION 'Keycloak logical database creation failed after temporary SET cleanup'/);
  assert.doesNotMatch(sql, /\\quit(?:\s+\d+)?/);
  assert.doesNotMatch(sql, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(sql, /PASSWORD\s+'[^']+'/i);
});

test("F2.6 live database verifier is read-only, secretless and fail-closed", async () => {
  const sql = await readFile("deploy/keycloak/verify-render-logical-database.sql", "utf8");

  assert.match(sql, /airenos_keycloak_runtime_f26/);
  assert.match(sql, /airenos_keycloak_f26_staging/);
  assert.match(sql, /rolcanlogin/);
  assert.match(sql, /NOT rolsuper/);
  assert.match(sql, /NOT rolinherit/);
  assert.match(sql, /NOT rolcreatedb/);
  assert.match(sql, /NOT rolcreaterole/);
  assert.match(sql, /NOT rolreplication/);
  assert.match(sql, /NOT rolbypassrls/);
  assert.match(sql, /pg_catalog\.pg_auth_members/);
  assert.match(sql, /pg_catalog\.pg_db_role_setting/);
  assert.match(sql, /c\.relowner = r\.oid/);
  assert.match(sql, /p\.proowner = r\.oid/);
  assert.match(sql, /n\.nspowner = r\.oid/);
  assert.match(sql, /pg_catalog\.pg_get_userbyid\(datdba\) = :'keycloak_runtime_role'/);
  assert.match(sql, /RAISE EXCEPTION 'F2\.6 FAIL:/);
  assert.doesNotMatch(sql, /\\quit(?:\s+\d+)?/);
  assert.match(sql, /F2\.6 PASS: runtime role and Keycloak logical database live read-back verified/);
  assert.doesNotMatch(sql, /^\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  assert.doesNotMatch(sql, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(sql, /PASSWORD\s+'[^']+'/i);
});

test("F2.6 CI runtime identity gate fails closed through PostgreSQL", async () => {
  const workflow = await readFile(".github/workflows/airenos-identity-f26-render-keycloak.yml", "utf8");

  assert.match(workflow, /runtime_identity_ok/);
  assert.match(workflow, /RAISE EXCEPTION 'F2\.6 FAIL: runtime effective identity mismatch'/);
  assert.doesNotMatch(workflow, /\\quit\s+10/);
});
