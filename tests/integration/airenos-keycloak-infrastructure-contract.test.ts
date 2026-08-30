import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const containerfile = readFileSync("deploy/keycloak/Containerfile", "utf8");
const readme = readFileSync("deploy/keycloak/README.md", "utf8");
const architecture = readFileSync("docs/airenos-identity-keycloak-self-hosted-infrastructure.md", "utf8");
const realm = JSON.parse(readFileSync("deploy/keycloak/realm-contract.json", "utf8"));
const machine = JSON.parse(readFileSync("machine-context/airenos-identity-session-authority-f2-keycloak-infra.json", "utf8"));

test("Keycloak image is immutable-by-version and production optimized", () => {
  const pinnedRefs = containerfile.match(/quay\.io\/keycloak\/keycloak:26\.7\.2/g) ?? [];
  assert.equal(pinnedRefs.length, 2, "builder and runtime stages must use the exact governed Keycloak version");
  assert.doesNotMatch(containerfile, /keycloak:latest/i);
  assert.match(containerfile, /KC_DB=postgres/);
  assert.match(containerfile, /KC_HEALTH_ENABLED=true/);
  assert.match(containerfile, /KC_METRICS_ENABLED=true/);
  assert.match(containerfile, /kc\.sh build/);
  assert.match(containerfile, /CMD \["start", "--optimized"\]/);
  assert.doesNotMatch(containerfile, /start-dev/);
  assert.doesNotMatch(containerfile, /(KC_DB_PASSWORD|KEYCLOAK_ADMIN_PASSWORD|KC_BOOTSTRAP_ADMIN_PASSWORD)\s*=/);
});

test("realm/client contract requires exact AIRenOS OIDC boundaries", () => {
  assert.equal(realm.keycloak.version, "26.7.2");
  assert.equal(realm.keycloak.realm, "airenos");
  assert.equal(realm.keycloak.public_hostname_target, "https://login.airenos.com");
  assert.equal(realm.keycloak.admin_hostname_target, "https://identity-admin.airenos.com");
  assert.notEqual(realm.keycloak.public_hostname_target, realm.keycloak.admin_hostname_target);
  assert.equal(realm.keycloak.issuer_target, "https://login.airenos.com/realms/airenos");

  assert.equal(realm.oidc_client.client_id, "airenos-browser-session");
  assert.equal(realm.oidc_client.client_type, "public");
  assert.equal(realm.oidc_client.standard_authorization_code_flow, true);
  assert.equal(realm.oidc_client.pkce_method, "S256");
  assert.equal(realm.oidc_client.implicit_flow, false);
  assert.equal(realm.oidc_client.direct_access_grants, false);
  assert.equal(realm.oidc_client.service_accounts, false);
  assert.equal(realm.oidc_client.redirect_uri_target, "https://session.airenos.com/oidc/callback");
  assert.equal(realm.oidc_client.wildcard_redirect_uris, false);
  assert.equal(realm.oidc_client.wildcard_web_origins, false);
});

test("Keycloak remains a replaceable authentication engine rather than AIRenOS authority", () => {
  const authority = realm.authority_boundary;
  assert.equal(authority.keycloak_authenticates_upstream_subject, true);
  assert.equal(authority.keycloak_is_airenos_canonical_identity_authority, false);
  assert.equal(authority.keycloak_roles_are_airenos_authority, false);
  assert.equal(authority.keycloak_tenant_claims_are_airenos_authority, false);
  assert.equal(authority.keycloak_entitlements_are_airenos_authority, false);
  assert.equal(authority.upstream_access_token_is_airenos_bearer, false);
  assert.equal(authority.base44_auth_is_airenos_authority, false);
  assert.equal(authority.airenos_identity_directory_remains_canonical, true);
  assert.equal(authority.airenos_session_authority_remains_canonical, true);

  assert.equal(realm.database_boundary.keycloak_database, "DEDICATED_POSTGRESQL");
  assert.equal(realm.database_boundary.airenos_database_shared, false);
  assert.equal(realm.database_boundary.credentials_managed_outside_source_control, true);
  assert.equal(realm.topology.production_minimum_keycloak_replicas, 2);
  assert.equal(realm.topology.public_and_admin_hostname_separation_required, true);
  assert.equal(realm.topology.admin_surface_network_restriction_required, true);
  assert.equal(realm.topology.preview_multicluster_features_required, false);
});

test("infrastructure contract cannot be mistaken for live provider proof", () => {
  for (const [key, value] of Object.entries(realm.live_evidence)) {
    assert.equal(value, false, `realm live evidence ${key} must remain false in source-controlled deployability contract`);
  }
  assert.equal(machine.status, "IMPLEMENTED_CONTRACT_LIVE_BINDING_PENDING");
  assert.equal(machine.live_evidence.dns, "NOT_PROVEN");
  assert.equal(machine.live_evidence.tls, "NOT_PROVEN");
  assert.equal(machine.live_evidence.deployment, "NOT_EXECUTED");
  assert.equal(machine.live_evidence.realm_provider_readback, "NOT_EXECUTED");
  assert.equal(machine.live_evidence.client_provider_readback, "NOT_EXECUTED");
  assert.equal(machine.live_evidence.real_authorization_code_exchange, "NOT_EXECUTED");
  assert.equal(machine.live_evidence.real_browser_login, "NOT_CERTIFIED");
  assert.equal(machine.live_evidence.base44_airenos_kairos_e2e, "NOT_EXECUTED");
  assert.equal(machine.production_side_effects, "FORBIDDEN");
});

test("human architecture records preserve the no-simulation and no-provider-authority boundary", () => {
  assert.match(readme, /must not be simulated/i);
  assert.match(readme, /Keycloak-issued access tokens MUST NOT be forwarded as AIRenOS bearers/);
  assert.match(architecture, /Keycloak is therefore infrastructure, not business authority/);
  assert.match(architecture, /does not assert that Keycloak has been deployed/);
});
