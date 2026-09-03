import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { PersistentAirenOSSessionIssuer, AirenOSSessionRevocationService } from "../../packages/identity/src/session-lifecycle.ts";
import { Ed25519AirenOSSessionIssuer } from "../../packages/integrations/src/airenos-session-ed25519.ts";
import { PostgresAirenOSSessionLifecycleStore } from "../../packages/persistence-postgres/src/airenos-session-lifecycle.ts";
import { createRa01AirenOSAuthentication } from "../../apps/api/src/ra01-staging-server.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const IDENTITY = "a0140000-0000-4000-8000-000000000001";
const RUNTIME_ROLE = "ra01_identity_runtime";
const ISSUER = "https://session.airenos.com";
const AUDIENCE = "airenos-foundation";
const KID = "ra01-airenos-session-k1";

function runtimeUrl(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  return url.toString();
}

test("RA-01 composes canonical AIRenOS F0/F1 bearer verification with persisted revocation state", async () => {
  const admin = new Pool({ connectionString: DATABASE_URL });
  const password = randomBytes(24).toString("hex");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const publicKeysJson = JSON.stringify({ [KID]: { key: publicJwk, enabled: true } });

  await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
  await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
  await admin.query(`GRANT airen_app TO ${RUNTIME_ROLE}`);
  await admin.query(`GRANT airen_auth TO ${RUNTIME_ROLE}`);
  await admin.query(`GRANT airen_control_plane TO ${RUNTIME_ROLE}`);

  await admin.query(
    `INSERT INTO identity.identities(id,display_name,primary_email,status)
     VALUES ($1,'RA01 Identity Runtime','ra01-identity-runtime@example.test','active')
     ON CONFLICT (id) DO UPDATE SET status='active'`,
    [IDENTITY],
  );

  const runtime = new Pool({
    connectionString: runtimeUrl(DATABASE_URL, RUNTIME_ROLE, password),
    max: 2,
    options: "-c role=airen_app",
  });

  try {
    const authentication = createRa01AirenOSAuthentication(runtime, {
      AUTH_ADAPTER: "airenos-session-ed25519",
      AIRENOS_SESSION_ISSUER: ISSUER,
      AUTH_SESSION_PUBLIC_KEYS_JSON: publicKeysJson,
    }, AUDIENCE);

    const sessions = new PostgresAirenOSSessionLifecycleStore(runtime);
    const issuer = new PersistentAirenOSSessionIssuer(
      new Ed25519AirenOSSessionIssuer({
        issuer: ISSUER,
        audience: AUDIENCE,
        keyId: KID,
        privateKey,
        ttlSeconds: 120,
      }),
      sessions,
    );

    const issued = await issuer.issue({
      identityId: IDENTITY,
      upstreamProviderKey: "keycloak-staging",
      upstreamProviderSubject: "provider-subject",
      authenticatedAtIso: new Date().toISOString(),
    });

    const principal = await authentication.authenticate({ authorization: `Bearer ${issued.accessToken}` });
    assert.ok(principal);
    assert.equal(principal.identityId, IDENTITY);
    assert.equal(principal.providerKey, ISSUER);
    assert.equal(principal.providerSubject, IDENTITY);

    const rawUnregistered = await new Ed25519AirenOSSessionIssuer({
      issuer: ISSUER,
      audience: AUDIENCE,
      keyId: KID,
      privateKey,
      ttlSeconds: 120,
    }).issue({
      identityId: IDENTITY,
      upstreamProviderKey: "keycloak-staging",
      upstreamProviderSubject: "provider-subject",
      authenticatedAtIso: new Date().toISOString(),
    });
    assert.equal(await authentication.authenticate({ authorization: `Bearer ${rawUnregistered.accessToken}` }), null);

    const revocation = new AirenOSSessionRevocationService(sessions);
    assert.equal(await revocation.revokeSession(issued.sessionId, IDENTITY, "ra01_staging_revocation_proof"), true);
    assert.equal(await authentication.authenticate({ authorization: `Bearer ${issued.accessToken}` }), null);

    const directAccess = await runtime.query(
      "SELECT has_table_privilege(current_user,'identity.airenos_sessions','SELECT') AS can_select"
    );
    assert.equal(directAccess.rows[0]?.can_select, false);
  } finally {
    await runtime.end();
    await admin.query("DELETE FROM identity.airenos_sessions WHERE identity_id=$1", [IDENTITY]);
    await admin.query("DELETE FROM authz.platform_role_assignments WHERE identity_id=$1", [IDENTITY]);
    await admin.query("DELETE FROM identity.provider_subject_links WHERE identity_id=$1", [IDENTITY]);
    await admin.query("DELETE FROM identity.identities WHERE id=$1", [IDENTITY]);
    await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
    await admin.end();
  }
});
