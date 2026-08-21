import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { ProviderNeutralAuthenticationAdapter } from "../../packages/identity/src/index.ts";
import { HmacSignedSessionVerifier } from "../../packages/integrations/src/index.ts";

function issueToken(key: Uint8Array, claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
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
  const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal(await adapter.authenticate({ authorization: `Bearer ${tampered}` }), null);
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
