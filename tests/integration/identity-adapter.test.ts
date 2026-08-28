import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomBytes, sign as signData } from "node:crypto";
import { ProviderNeutralAuthenticationAdapter } from "../../packages/identity/src/index.ts";
import { HmacSignedSessionVerifier } from "../../packages/integrations/src/index.ts";
import { Ed25519SignedSessionVerifier } from "../../packages/integrations/src/ed25519-signed-session.ts";

function issueToken(key: Uint8Array, claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function issueEd25519Token(privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], kid: string, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = signData(null, Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function mutateSignatureByte(token: string): string {
  const parts = token.split(".");
  const signature = parts.at(-1)!;
  const replacement = signature[0] === "A" ? "B" : "A";
  parts[parts.length - 1] = `${replacement}${signature.slice(1)}`;
  return parts.join(".");
}

function makeNonCanonicalEquivalentSignature(token: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const [payload, signature] = token.split(".");
  const canonicalLast = alphabet.indexOf(signature.at(-1)!);
  if (canonicalLast < 0 || (canonicalLast & 0b11) !== 0) throw new Error("Expected canonical SHA-256 Base64URL signature");
  const alternateLast = alphabet[canonicalLast | 0b01];
  const alternateSignature = `${signature.slice(0, -1)}${alternateLast}`;
  assert.deepEqual(Buffer.from(alternateSignature, "base64url"), Buffer.from(signature, "base64url"));
  return `${payload}.${alternateSignature}`;
}

const providerKey = "synthetic-auth";
const audience = "airenos-foundation";
const nowMs = Date.UTC(2026, 7, 21, 16, 0, 0);
const key = randomBytes(32);
const identities = {
  async resolveProviderIdentity(provider: string, subject: string) {
    if (provider === providerKey && subject === "alice-subject") return { identityId: "alice-id", status: "active", platformRoles: ["platform_support_readonly"] };
    if (provider === providerKey && subject === "suspended-subject") return { identityId: "suspended-id", status: "suspended", platformRoles: [] };
    return null;
  }
};
const verifier = new HmacSignedSessionVerifier({ providerKey, audience, verificationKey: key, now: () => nowMs, clockSkewSeconds: 0 });
const adapter = new ProviderNeutralAuthenticationAdapter(verifier, identities);

function validClaims(subject = "alice-subject") {
  const now = Math.floor(nowMs / 1000);
  return { iss: providerKey, aud: audience, sub: subject, sid: "session-1", iat: now - 5, exp: now + 300 };
}

test("verified signed session resolves provider subject to AIRenOS Identity", async () => {
  const token = issueToken(key, validClaims());
  const principal = await adapter.authenticate({ authorization: `Bearer ${token}`, tenant_id: "attacker-tenant", role: "platform_super_admin" });
  assert.ok(principal);
  assert.equal(principal.identityId, "alice-id");
  assert.equal(principal.providerSubject, "alice-subject");
  assert.deepEqual(principal.platformRoles, ["platform_support_readonly"]);
  assert.equal(principal.sessionId, "session-1");
});

test("tampered session signature is rejected", async () => {
  const token = issueToken(key, validClaims());
  assert.equal(await adapter.authenticate({ authorization: `Bearer ${mutateSignatureByte(token)}` }), null);
});

test("non-canonical Base64URL spelling of identical signature bytes is rejected", async () => {
  const token = issueToken(key, validClaims());
  assert.equal(await adapter.authenticate({ authorization: `Bearer ${makeNonCanonicalEquivalentSignature(token)}` }), null);
});

test("expired session is rejected", async () => {
  const now = Math.floor(nowMs / 1000);
  const token = issueToken(key, { iss: providerKey, aud: audience, sub: "alice-subject", sid: "expired", iat: now - 600, exp: now - 1 });
  assert.equal(await adapter.authenticate({ authorization: `Bearer ${token}` }), null);
});

test("unknown or suspended provider subject cannot become an authenticated principal", async () => {
  const unknown = issueToken(key, validClaims("unknown-subject"));
  const suspended = issueToken(key, validClaims("suspended-subject"));
  assert.equal(await adapter.authenticate({ authorization: `Bearer ${unknown}` }), null);
  assert.equal(await adapter.authenticate({ authorization: `Bearer ${suspended}` }), null);
});

test("Ed25519 signed session authenticates the same provider-neutral Identity contract", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const kid = "base44-session-k1";
  const edVerifier = new Ed25519SignedSessionVerifier({
    providerKey,
    audience,
    publicKeysJson: JSON.stringify({ [kid]: { key: publicKey.export({ format: "jwk" }), enabled: true } }),
    now: () => nowMs,
    clockSkewSeconds: 0
  });
  const edAdapter = new ProviderNeutralAuthenticationAdapter(edVerifier, identities);
  const token = issueEd25519Token(privateKey, kid, validClaims());
  const principal = await edAdapter.authenticate({ authorization: `Bearer ${token}` });
  assert.ok(principal);
  assert.equal(principal.identityId, "alice-id");
  assert.equal(principal.providerSubject, "alice-subject");
  assert.equal(principal.sessionId, "session-1");
  assert.equal(await edAdapter.authenticate({ authorization: `Bearer ${mutateSignatureByte(token)}` }), null);
});
