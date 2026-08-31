import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contractPath = "deploy/keycloak/staging-security-promotion-contract.json";
const machineContextPath = "machine-context/airenos-identity-session-authority-f2-staging-security-promotion.json";
const keycloakTemplatePath = "deploy/keycloak/kubernetes/staging/keycloak.yaml.tmpl";
const realmContractPath = "deploy/keycloak/realm-contract.json";
const containerfilePath = "deploy/keycloak/Containerfile";

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("F2 staging security promotion contract preserves AIRenOS authority boundaries", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.scope, "STATIC_GOVERNED_CONTRACT_ONLY");
  assert.equal(contract.authority_boundary.keycloak_is_airenos_identity_authority, false);
  assert.equal(contract.authority_boundary.keycloak_roles_tenants_entitlements_are_airenos_authority, false);
  assert.equal(contract.authority_boundary.upstream_provider_token_is_airenos_bearer, false);
  assert.equal(contract.authority_boundary.base44_authentication_is_airenos_authority, false);
  assert.equal(contract.authority_boundary.airenos_identity_directory_is_canonical, true);
  assert.equal(contract.authority_boundary.airenos_session_authority_is_canonical, true);
  assert.equal(contract.authority_boundary.authorization_before_kairos_retrieval_required, true);
  assert.equal(contract.authority_boundary.browser_asserted_tenant_role_scope_authoritative, false);
});

test("Secret/KMS contract stays provider-neutral and contains no live binding claim", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.secret_kms_boundary.binding_status, "OPEN_NOT_EXECUTED");
  assert.equal(contract.secret_kms_boundary.live_region_capability_and_iam_proof_required, true);
  assert.equal(contract.secret_kms_boundary.workload_identity_mechanism, "TBD_AFTER_LIVE_MKS_IAM_READBACK");
  assert.equal(contract.secret_kms_boundary.kubernetes_secret_values_committed, false);
  assert.equal(contract.secret_kms_boundary.provider_binding_may_be_claimed_from_static_contract, false);
  assert.equal(contract.secret_kms_boundary.airenos_session_signing_key_owner, "AIRENOS_SESSION_AUTHORITY_NOT_KEYCLOAK");
  for (const forbidden of ["GIT", "GOOGLE_DRIVE", "BASE44", "OCI_IMAGE_LAYERS", "CI_LOGS", "CHAT"]) {
    assert.ok(contract.secret_kms_boundary.raw_secret_values_prohibited_in.includes(forbidden));
  }
});

test("Keycloak promotion requires pushed immutable digest and registry read-back", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.immutable_image_promotion.status, "OPEN_NOT_EXECUTED");
  assert.equal(contract.immutable_image_promotion.tag_only_deployment_forbidden, true);
  assert.equal(contract.immutable_image_promotion.required_deployment_reference_form, "registry/repository@sha256:<64-lowercase-hex>");
  assert.equal(contract.immutable_image_promotion.local_docker_image_id_is_promotion_proof, false);
  assert.equal(contract.immutable_image_promotion.upstream_base_image_digest_is_promoted_airenos_digest, false);
  assert.equal(contract.immutable_image_promotion.registry_vulnerability_scan_required, true);
  assert.equal(contract.immutable_image_promotion.unresolved_critical_findings_allowed_by_default, false);
  assert.equal(contract.immutable_image_promotion.registry_push_executed, false);
  assert.equal(contract.immutable_image_promotion.registry_digest_readback_executed, false);

  const template = await readFile(keycloakTemplatePath, "utf8");
  assert.match(template, /registry\.invalid\/airenos\/keycloak@sha256:REQUIRED_GOVERNED_DIGEST/);
  assert.doesNotMatch(template, /image:\s+[^\n]+:latest\b/);

  const containerfile = await readFile(containerfilePath, "utf8");
  assert.match(containerfile, /FROM quay\.io\/keycloak\/keycloak:26\.7\.2/);
  assert.doesNotMatch(containerfile, /:latest\b/);
});

test("DNS/TLS targets remain exact and unproven", async () => {
  const contract = await readJson(contractPath);
  const realm = await readJson(realmContractPath);
  assert.equal(contract.dns_tls_boundary.status, "OPEN_NOT_PROVEN");
  assert.equal(contract.dns_tls_boundary.public_login_hostname, "login.airenos.com");
  assert.equal(contract.dns_tls_boundary.restricted_admin_hostname, "identity-admin.airenos.com");
  assert.equal(contract.dns_tls_boundary.session_callback_hostname, "session.airenos.com");
  assert.equal(contract.dns_tls_boundary.session_callback_uri, "https://session.airenos.com/oidc/callback");
  assert.equal(contract.dns_tls_boundary.exact_dns_provider_readback_required, true);
  assert.equal(contract.dns_tls_boundary.certificate_san_readback_required, true);
  assert.equal(contract.dns_tls_boundary.admin_public_exposure_authorized, false);
  assert.equal(contract.dns_tls_boundary.dns_changes_executed, false);
  assert.equal(contract.dns_tls_boundary.certificate_issuance_executed, false);
  assert.equal(realm.keycloak.public_hostname_target, "https://login.airenos.com");
  assert.equal(realm.keycloak.admin_hostname_target, "https://identity-admin.airenos.com");
  assert.equal(realm.oidc_client.redirect_uri_target, "https://session.airenos.com/oidc/callback");
});

test("Session handoff cannot close from simulated or upstream authority", async () => {
  const contract = await readJson(contractPath);
  assert.equal(contract.session_handoff.status, "OPEN_RUNTIME_PROOF_REQUIRED");
  assert.equal(contract.session_handoff.browser_to_keycloak, "OIDC_AUTHORIZATION_CODE_WITH_PKCE_S256");
  assert.equal(contract.session_handoff.provider_verification, "AIRENOS_F2_OIDC_ADAPTER");
  assert.equal(contract.session_handoff.session_issuance, "AIRENOS_ED25519_SESSION_AUTHORITY");
  assert.equal(contract.session_handoff.kairos_authorization, "AIRENOS_AUTHORIZATION_BEFORE_RETRIEVAL");
  assert.equal(contract.session_handoff.keycloak_access_token_forwarded_as_airenos_bearer, false);
  assert.equal(contract.session_handoff.keycloak_role_or_tenant_claims_imported_as_authority, false);
  assert.equal(contract.session_handoff.base44_preview_localstorage_authority, false);
  assert.equal(contract.session_handoff.base44_exact_origin_handoff_boundary_preserved, true);
  assert.equal(contract.session_handoff.simulated_evidence_can_close_gate, false);
  for (const value of Object.values(contract.live_evidence)) assert.equal(value, false);
});

test("Machine context freezes provider pause and protected boundaries", async () => {
  const context = await readJson(machineContextPath);
  assert.equal(context.provider_dependency.ovh_account_onboarding, "PAUSED_EXTERNAL_FISCAL_DATA_PENDING");
  assert.equal(context.provider_dependency.provider_apply, "NOT_EXECUTED");
  assert.equal(context.provider_dependency.billable_resource_creation, "NOT_AUTHORIZED");
  assert.equal(context.protected_boundaries.k4_branch_mutation, false);
  assert.equal(context.protected_boundaries.rbl_branch_mutation, false);
  assert.equal(context.protected_boundaries.r3_branch_mutation, false);
  assert.equal(context.protected_boundaries.main_mutation, false);
  assert.equal(context.protected_boundaries.production_mutation, false);
  assert.equal(context.protected_boundaries.pr4_merge_authorized, false);
  assert.equal(context.protected_boundaries.k5_authorized, false);
});
