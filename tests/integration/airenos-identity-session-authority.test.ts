import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { AirenOSIdentitySessionAuthority, AirenOSSessionAuthenticationAdapter } from "../../packages/identity/src/session-authority.ts";
import { Ed25519AirenOSSessionIssuer, Ed25519AirenOSSessionVerifier } from "../../packages/integrations/src/airenos-session-ed25519.ts";

const nowMs = Date.UTC(2026, 7, 30, 12, 0, 0);
const issuerUrl = "https://identity.staging.airenos.example";
const audience = "airenos-kairos-staging";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const kid = "airenos-session-2026-08-a";

const identities = {
  async resolveProviderIdentity(providerKey: string, providerSubject: string) {
    if (providerKey === "https://upstream-idp.example" && providerSubject === "real-subject") return { identityId: "identity-1", status: "active", platformRoles: ["platform_support_readonly"] };
    if (providerSubject === "suspended") return { identityId: "identity-2", status: "suspended", platformRoles: [] };
    return null;
  },
  async resolveIdentity(identityId: string) {
    if (identityId === "identity-1") return { identityId, status: "active", platformRoles: ["platform_support_readonly"] };
    return null;
  }
};

function upstream(subject = "real-subject") {
  return {
    async verify(request: unknown) {
      if (!request || typeof request !== "object" || (request as { verified?: boolean }).verified !== true) return null;
      return { providerKey: "https://upstream-idp.example", providerSubject: subject, authenticatedAtIso: new Date(nowMs - 1_000).toISOString() };
    }
  };
}

function issuer() {
  return new Ed25519AirenOSSessionIssuer({ issuer: issuerUrl, audience, keyId: kid, privateKey, ttlSeconds: 120, now: () => nowMs, sessionId: () => "session-airenos-1" });
}
function verifier() {
  return new Ed25519AirenOSSessionVerifier({ issuer: issuerUrl, audience, publicKeysJson: JSON.stringify({ [kid]: { key: publicKey.export({ format: "jwk" }), enabled: true } }), now: () => nowMs, clockSkewSeconds: 0 });
}

test("session authority refuses to mint without a verified upstream identity", async () => {
  const authority = new AirenOSIdentitySessionAuthority(upstream(), identities, issuer());
  await assert.rejects(() => authority.establishSession({ verified: false }), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "AUTHENTICATION_REQUIRED"));
});

test("session authority maps upstream subject to AIRenOS Identity before minting", async () => {
  const authority = new AirenOSIdentitySessionAuthority(upstream(), identities, issuer());
  const session = await authority.establishSession({ verified: true, tenant_id: "attacker-tenant", role: "platform_super_admin" });
  const verified = await verifier().verify({ authorization: `Bearer ${session.accessToken}` });
  assert.ok(verified);
  assert.equal(verified.identityId, "identity-1");
  assert.equal(verified.issuer, issuerUrl);
  assert.equal(verified.audience, audience);
  assert.equal(verified.sessionId, "session-airenos-1");
  const [, payload] = session.accessToken.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.sub, "identity-1");
  assert.equal("tenant_id" in claims, false);
  assert.equal("role" in claims, false);
  assert.equal("platformRoles" in claims, false);
});

test("AIRenOS session principal loads roles server-side rather than trusting token claims", async () => {
  const authority = new AirenOSIdentitySessionAuthority(upstream(), identities, issuer());
  const session = await authority.establishSession({ verified: true });
  const adapter = new AirenOSSessionAuthenticationAdapter(verifier(), identities);
  const principal = await adapter.authenticate({ authorization: `Bearer ${session.accessToken}`, role: "platform_super_admin", tenant_id: "attacker-tenant" });
  assert.ok(principal);
  assert.equal(principal.identityId, "identity-1");
  assert.deepEqual(principal.platformRoles, ["platform_support_readonly"]);
});

test("wrong audience, disabled key and suspended upstream identity fail closed", async () => {
  const authority = new AirenOSIdentitySessionAuthority(upstream("suspended"), identities, issuer());
  await assert.rejects(() => authority.establishSession({ verified: true }));
  const validAuthority = new AirenOSIdentitySessionAuthority(upstream(), identities, issuer());
  const session = await validAuthority.establishSession({ verified: true });
  const wrongAudience = new Ed25519AirenOSSessionVerifier({ issuer: issuerUrl, audience: "another-service", publicKeysJson: JSON.stringify({ [kid]: { key: publicKey.export({ format: "jwk" }), enabled: true } }), now: () => nowMs, clockSkewSeconds: 0 });
  assert.equal(await wrongAudience.verify({ authorization: `Bearer ${session.accessToken}` }), null);
  const disabled = new Ed25519AirenOSSessionVerifier({ issuer: issuerUrl, audience, publicKeysJson: JSON.stringify({ [kid]: { key: publicKey.export({ format: "jwk" }), enabled: false } }), now: () => nowMs, clockSkewSeconds: 0 });
  assert.equal(await disabled.verify({ authorization: `Bearer ${session.accessToken}` }), null);
});

test("issuer configuration fails closed unless it is clean HTTPS", () => {
  assert.throws(() => new Ed25519AirenOSSessionIssuer({ issuer: "http://identity.airenos.test", audience, keyId: kid, privateKey }));
  assert.throws(() => new Ed25519AirenOSSessionIssuer({ issuer: "https://identity.airenos.test/?token=bad", audience, keyId: kid, privateKey }));
});
