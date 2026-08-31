import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const seed = JSON.parse(readFileSync("deploy/keycloak/realm/airenos-realm.json", "utf8"));
const descriptive = JSON.parse(readFileSync("deploy/keycloak/realm-contract.json", "utf8"));
const machine = JSON.parse(readFileSync("machine-context/airenos-identity-session-authority-f2-keycloak-realm-bootstrap.json", "utf8"));
const docs = readFileSync("docs/airenos-identity-keycloak-realm-bootstrap-contract.md", "utf8");
const runtimeScript = readFileSync("scripts/keycloak-realm-bootstrap-runtime-ci.sh", "utf8");
const workflow = readFileSync(".github/workflows/airenos-identity-session-authority.yml", "utf8");
const kubernetesTemplate = readFileSync("deploy/keycloak/kubernetes/staging/keycloak.yaml.tmpl", "utf8");

test("realm seed preserves the exact AIRenOS public PKCE client contract", () => {
  assert.equal(seed.realm, "airenos");
  assert.equal(seed.enabled, true);
  assert.equal(seed.clients.length, 1);

  const client = seed.clients[0];
  assert.equal(client.clientId, "airenos-browser-session");
  assert.equal(client.protocol, "openid-connect");
  assert.equal(client.publicClient, true);
  assert.equal(client.bearerOnly, false);
  assert.equal(client.standardFlowEnabled, true);
  assert.equal(client.implicitFlowEnabled, false);
  assert.equal(client.directAccessGrantsEnabled, false);
  assert.equal(client.serviceAccountsEnabled, false);
  assert.equal(client.fullScopeAllowed, false);
  assert.deepEqual(client.redirectUris, ["https://session.airenos.com/oidc/callback"]);
  assert.deepEqual(client.webOrigins, []);
  assert.equal(client.attributes["pkce.code.challenge.method"], "S256");
  assert.deepEqual(client.protocolMappers, []);

  assert.equal(descriptive.keycloak.realm, seed.realm);
  assert.equal(descriptive.oidc_client.client_id, client.clientId);
  assert.equal(descriptive.oidc_client.pkce_method, client.attributes["pkce.code.challenge.method"]);
  assert.equal(descriptive.oidc_client.redirect_uri_target, client.redirectUris[0]);
});

test("realm seed carries no user, business authority or secret material", () => {
  assert.equal(Object.hasOwn(seed, "users"), false);
  assert.equal(Object.hasOwn(seed, "groups"), false);
  assert.equal(Object.hasOwn(seed, "roles"), false);
  assert.equal(Object.hasOwn(seed, "identityProviders"), false);

  const serialized = JSON.stringify(seed);
  assert.doesNotMatch(serialized, /clientSecret/i);
  assert.doesNotMatch(serialized, /password/i);
  assert.doesNotMatch(serialized, /credential/i);
  assert.doesNotMatch(serialized, /tenant[_-]?id/i);
  assert.doesNotMatch(serialized, /super_admin|platform_admin|tenant_admin/i);
  assert.doesNotMatch(serialized, /https?:\/\/[^\"]*\*/i);
});

test("bootstrap strategy is first-create only and cannot silently overwrite a live realm", () => {
  assert.match(runtimeScript, /import --optimized --file .* --override false/);
  assert.doesNotMatch(kubernetesTemplate, /--import-realm/);
  assert.match(kubernetesTemplate, /- start\n\s+- --optimized/);
  assert.match(docs, /not an ongoing configuration-sync mechanism/i);
  assert.match(docs, /later realm\/client changes require a separate governed migration or Admin API procedure/i);

  assert.equal(machine.keycloak.bootstrap_mode, "CLI_IMPORT_BEFORE_FIRST_LIVE_NODE");
  assert.equal(machine.keycloak.override_existing_realm, false);
  assert.equal(machine.keycloak.continuous_startup_import, false);
});

test("dedicated CI must exercise real Keycloak 26.7.2 import and runtime read-back on PostgreSQL 17", () => {
  assert.match(workflow, /isa-f2-keycloak-realm-bootstrap-runtime:/);
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /keycloak-realm-bootstrap-runtime-ci\.sh/);
  assert.match(runtimeScript, /airenos-keycloak-realm-contract/);
  assert.match(runtimeScript, /\/realms\/airenos\/\.well-known\/openid-configuration/);
  assert.match(runtimeScript, /\/admin\/realms\/airenos\/clients\?clientId=airenos-browser-session/);
  assert.match(runtimeScript, /\/admin\/realms\/airenos\/users\?max=1/);
});

test("runtime compatibility evidence remains explicitly non-live", () => {
  assert.equal(machine.ci_evidence.classification, "DETERMINISTIC_RUNTIME_COMPATIBILITY_ONLY");
  for (const value of Object.values(machine.live_evidence)) {
    assert.match(String(value), /NOT_|NOT PROVEN|NOT_CERTIFIED/);
  }
  assert.equal(machine.production_side_effects, "FORBIDDEN");
  assert.match(docs, /must not be simulated/i);
  assert.match(docs, /does \*\*not\*\* prove/);
});
