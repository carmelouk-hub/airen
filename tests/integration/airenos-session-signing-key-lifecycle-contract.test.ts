import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  airenOSSessionPublicJwkThumbprint,
  bootstrapAirenOSSessionSigningKey,
} from "../../scripts/bootstrap-airenos-session-signing-key.ts";
import {
  Ed25519AirenOSSessionIssuer,
  Ed25519AirenOSSessionVerifier,
} from "../../packages/integrations/src/airenos-session-ed25519.ts";

const KID = "isa-f21-ephemeral-k1";
const ISSUER = "https://session.airenos.com";
const AUDIENCE = "airenos-foundation";
const IDENTITY_ID = "a0210000-0000-4000-8000-000000000001";

test("F2.1 bootstrap creates private-only signing material plus verifier-compatible public keyring", async () => {
  const directory = await mkdtemp(join(tmpdir(), "airenos-f21-key-"));
  const privateKeyPath = join(directory, "session-signing-private.pem");
  const publicKeyringPath = join(directory, "session-signing-public.json");

  try {
    const result = await bootstrapAirenOSSessionSigningKey({
      kid: KID,
      privateKeyPath,
      publicKeyringPath,
      forbiddenRoot: process.cwd(),
    });

    const privatePem = await readFile(privateKeyPath, "utf8");
    const publicKeyringText = await readFile(publicKeyringPath, "utf8");
    const publicKeyring = JSON.parse(publicKeyringText) as Record<string, { key: JsonWebKey; enabled: boolean }>;
    const publicJwk = publicKeyring[KID]?.key;

    assert.match(privatePem, /BEGIN PRIVATE KEY/);
    assert.ok(publicJwk);
    assert.equal(publicKeyring[KID]?.enabled, true);
    assert.equal(publicJwk.kty, "OKP");
    assert.equal(publicJwk.crv, "Ed25519");
    assert.equal(typeof publicJwk.x, "string");
    assert.equal(publicJwk.d, undefined);
    assert.doesNotMatch(publicKeyringText, /PRIVATE KEY|"d"\s*:/);
    assert.equal(result.publicJwkThumbprint, airenOSSessionPublicJwkThumbprint(publicJwk));
    assert.equal(JSON.stringify(result).includes(privatePem), false);
    assert.equal((await stat(privateKeyPath)).mode & 0o777, 0o600);
    assert.equal((await stat(publicKeyringPath)).mode & 0o777, 0o600);

    const issuer = new Ed25519AirenOSSessionIssuer({
      issuer: ISSUER,
      audience: AUDIENCE,
      keyId: KID,
      privateKey: privatePem,
      ttlSeconds: 120,
    });
    const verifier = new Ed25519AirenOSSessionVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      publicKeysJson: publicKeyringText,
    });
    const issued = await issuer.issue({
      identityId: IDENTITY_ID,
      upstreamProviderKey: "keycloak-staging",
      upstreamProviderSubject: "f21-ephemeral-provider-subject",
      authenticatedAtIso: new Date().toISOString(),
    });
    const verified = await verifier.verify({ authorization: `Bearer ${issued.accessToken}` });
    assert.ok(verified);
    assert.equal(verified.identityId, IDENTITY_ID);
    assert.equal(verified.issuer, ISSUER);
    assert.equal(verified.audience, AUDIENCE);

    await assert.rejects(
      bootstrapAirenOSSessionSigningKey({
        kid: "isa-f21-ephemeral-k2",
        privateKeyPath,
        publicKeyringPath,
        forbiddenRoot: process.cwd(),
      }),
      /exist|EEXIST/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("F2.1 bootstrap refuses repository/worktree output paths before generating governed material", async () => {
  const outside = await mkdtemp(join(tmpdir(), "airenos-f21-outside-"));
  try {
    await assert.rejects(
      bootstrapAirenOSSessionSigningKey({
        kid: KID,
        privateKeyPath: join(process.cwd(), ".airenos-f21-private.pem"),
        publicKeyringPath: join(outside, "public.json"),
        forbiddenRoot: process.cwd(),
      }),
      /must not be written inside the repository\/worktree/,
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("F2.1 lifecycle contract remains static, public-only toward Foundation and overlap-first", async () => {
  const contract = JSON.parse(await readFile("deploy/session-authority/session-signing-key-lifecycle-contract.json", "utf8"));
  const documentation = await readFile("docs/AIRENOS_IDENTITY_F21_SESSION_SIGNING_KEY_LIFECYCLE_CONTRACT_v0.1.md", "utf8");

  assert.equal(contract.status, "STATIC_CONTRACT_IMPLEMENTED_LIVE_KEY_MATERIAL_NOT_CREATED");
  assert.equal(contract.base_identity_checkpoint, "87cc356785e5527b571f9cc707b9b17a5382400e");
  assert.equal(contract.authority_boundary.session_signing_private_key_owner, "AIRENOS_SESSION_AUTHORITY");
  assert.equal(contract.authority_boundary.foundation_receives_private_key, false);
  assert.equal(contract.authority_boundary.keycloak_is_signing_authority, false);
  assert.equal(contract.authority_boundary.base44_is_signing_authority, false);
  assert.equal(contract.cryptographic_contract.public_key_thumbprint, "RFC7638_SHA256_BASE64URL");
  assert.equal(contract.bootstrap_contract.exclusive_create_no_overwrite, true);
  assert.equal(contract.bootstrap_contract.repository_path_write_forbidden_by_default, true);
  assert.equal(contract.bootstrap_contract.live_execution_authorized_by_this_checkpoint, false);
  assert.equal(contract.foundation_public_keyring_contract.environment_binding, "AUTH_SESSION_PUBLIC_KEYS_JSON");
  assert.equal(contract.foundation_public_keyring_contract.private_material_allowed, false);
  assert.equal(contract.rotation_contract.maximum_token_ttl_seconds, 300);
  assert.equal(contract.rotation_contract.verifier_clock_skew_seconds, 30);
  assert.equal(contract.rotation_contract.minimum_old_key_overlap_after_last_old_kid_issue_seconds, 330);
  assert.equal(contract.live_evidence.staging_private_key_created, false);
  assert.equal(contract.live_evidence.foundation_public_keyring_bound, false);
  assert.equal(contract.live_evidence.real_session_verified_by_ra01, false);
  assert.equal(contract.provider_dependency.real_provider_apply, "NOT_EXECUTED");
  assert.equal(contract.provider_dependency.billable_resource_creation_authorized, false);

  assert.match(documentation, /Session Authority is the sole owner of session-signing private material/);
  assert.match(documentation, /minimum overlap `330s`/);
  assert.match(documentation, /not evidence of:\n\n- a real staging private key/);
  assert.doesNotMatch(documentation, /staging_private_key_created[^\n]*true/i);
});
