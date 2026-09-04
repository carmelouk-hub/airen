import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BRANCH = "foundation/airenos-identity-session-authority-f23-render-staging-runtime-20260904";

test("F2.3 Render staging contract preserves provider-neutral authority and protected boundaries", async () => {
  const contract = JSON.parse(await readFile("deploy/session-authority/render-staging-contract.json", "utf8"));
  const blueprint = await readFile("render.identity.f23.yaml", "utf8");
  const documentation = await readFile("docs/AIRENOS_IDENTITY_F23_RENDER_STAGING_RUNTIME_CONTRACT_20260904.md", "utf8");

  assert.equal(contract.status, "STATIC_RENDER_STAGING_RUNTIME_IMPLEMENTED_LIVE_DEPLOY_NOT_EXECUTED");
  assert.equal(contract.parent_checkpoint, "d8346b151fb4cc3f6c5e91fee04c271e8d7eff76");
  assert.equal(contract.provider_authority.canonical_identity_infrastructure_target, "OVHCLOUD_PUBLIC_CLOUD_MILAN");
  assert.equal(contract.provider_authority.render_role, "TEMPORARY_NON_PRODUCTION_EXECUTION_PROOF_HOST");
  assert.equal(contract.provider_authority.provider_neutral_session_authority_preserved, true);
  assert.equal(contract.provider_authority.render_becomes_identity_authority, false);
  assert.equal(contract.provider_authority.render_replaces_ovh_canonical_target, false);
  assert.equal(contract.runtime_contract.creates_postgres_in_blueprint, false);
  assert.equal(contract.protected_boundaries.existing_render_booking_resources_mutated, false);
  assert.equal(contract.protected_boundaries.production_enabled, false);
  assert.equal(contract.live_evidence.render_service_created, false);
  assert.equal(contract.live_evidence.billable_resource_creation_executed, false);
  assert.equal(contract.live_evidence.staging_private_key_created, false);
  assert.equal(contract.live_evidence.real_airenos_session_issued, false);
  assert.equal(contract.live_evidence.real_session_verified_by_ra01, false);

  assert.match(blueprint, new RegExp(`branch: ${BRANCH.replaceAll("/", "\\/")}`));
  assert.match(blueprint, /name: airenos-session-authority-f23-staging/);
  assert.match(blueprint, /runtime: docker/);
  assert.match(blueprint, /plan: starter/);
  assert.match(blueprint, /region: frankfurt/);
  assert.match(blueprint, /healthCheckPath: \/health\/ready/);
  assert.match(blueprint, /mountPath: \/var\/data\/airenos-session/);
  assert.match(blueprint, /AIRENOS_SESSION_PRIVATE_KEY_PATH/);
  assert.match(blueprint, /AIRENOS_SESSION_PUBLIC_KEYRING_PATH/);
  assert.match(blueprint, /SESSION_AUTHORITY_DATABASE_URL\n\s+sync: false/);
  assert.doesNotMatch(blueprint, /^databases:/m);
  assert.doesNotMatch(blueprint, /ristoairen-booking-rbl01c2-20260827|ristoairen-postgres-rbl01c2|ristoairen-rbl01c2-db/);

  assert.match(documentation, /canonical F2\.2 infrastructure target remains OVHcloud Public Cloud Milan/);
  assert.match(documentation, /does \*\*not\*\* create a new PostgreSQL database/);
  assert.match(documentation, /not evidence that:/);
});

test("F2.3 runtime exposes bounded PKCE exchange without wildcard browser authority", async () => {
  const server = await readFile("apps/api/src/session-authority-staging-server.ts", "utf8");
  const entry = await readFile("deploy/session-authority-runtime-entry.ts", "utf8");
  const upstream = await readFile("packages/integrations/src/oidc-upstream-provider.ts", "utf8");
  const dockerfile = await readFile("deploy/Dockerfile.session-authority", "utf8");

  assert.match(server, /OidcAuthorizationCodeUpstreamVerifier/);
  assert.match(server, /AirenOSIdentitySessionAuthority/);
  assert.match(server, /PersistentAirenOSSessionIssuer/);
  assert.match(server, /Ed25519AirenOSSessionIssuer/);
  assert.match(server, /PostgresAuthenticationIdentityDirectory/);
  assert.match(server, /PostgresAirenOSSessionLifecycleStore/);
  assert.match(server, /request\.url === "\/v1\/session\/exchange"/);
  assert.match(server, /request\.url === "\/v1\/session\/public-keyring"/);
  assert.match(upstream, /codeVerifier/);
  assert.match(upstream, /expectedNonce/);
  assert.match(upstream, /code_challenge_methods_supported/);
  assert.match(upstream, /S256/);
  assert.match(server, /16 \* 1024/);
  assert.match(server, /access-control-allow-origin", allowedOrigin/);
  assert.doesNotMatch(server, /access-control-allow-origin"\s*,\s*"\*"/i);
  assert.match(server, /AIRENOS_SESSION_REQUIRE_FORWARDED_HTTPS/);
  assert.match(server, /x-forwarded-proto/);
  assert.match(server, /cache-control", "no-store"/);

  assert.match(entry, /bootstrapAirenOSSessionSigningKey/);
  assert.match(entry, /forbiddenRoot: process\.cwd\(\)/);
  assert.match(entry, /mode 0600/);
  assert.match(entry, /isSymbolicLink/);
  assert.match(entry, /createPublicKey\(privateKey\)/);
  assert.match(entry, /privateKeyMaterialEmitted: false/);
  assert.doesNotMatch(entry, /JSON\.stringify\([^\n]*privateKeyPem/);

  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /COPY scripts \.\/scripts/);
  assert.match(dockerfile, /\/var\/data\/airenos-session/);
  assert.match(dockerfile, /org\.opencontainers\.image\.version="f2\.3"/);
});
