import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { AirenOSIdentitySessionAuthority } from "../../packages/identity/src/session-authority.ts";
import {
  AirenOSSessionRevocationService,
  PersistentAirenOSSessionIssuer,
  RevocationAwareAirenOSSessionVerifier,
  type AirenOSSessionLifecycleStore,
  type AirenOSSessionRecord
} from "../../packages/identity/src/session-lifecycle.ts";
import { Ed25519AirenOSSessionIssuer, Ed25519AirenOSSessionVerifier } from "../../packages/integrations/src/airenos-session-ed25519.ts";

const nowMs = Date.UTC(2026, 7, 30, 22, 0, 0);
const identityId = "aaaaaaaa-0000-4000-8000-000000000001";
const issuerUrl = "https://identity.staging.airenos.example";
const audience = "airenos-kairos-staging";
const kid = "airenos-session-2026-08-b";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

class MemoryLifecycleStore implements AirenOSSessionLifecycleStore {
  readonly records = new Map<string, AirenOSSessionRecord>();
  readonly revoked = new Set<string>();
  lastRegisteredKeys: string[] = [];

  async register(record: AirenOSSessionRecord): Promise<void> {
    this.lastRegisteredKeys = Object.keys(record).sort();
    if (this.records.has(record.sessionId)) throw new Error("duplicate session");
    this.records.set(record.sessionId, Object.freeze({ ...record }));
  }

  async resolveActive(sessionId: string, subject: string): Promise<AirenOSSessionRecord | null> {
    const record = this.records.get(sessionId);
    if (!record || record.identityId !== subject || this.revoked.has(sessionId)) return null;
    return record;
  }

  async revoke(sessionId: string, subject: string): Promise<boolean> {
    const record = this.records.get(sessionId);
    if (!record || record.identityId !== subject || this.revoked.has(sessionId)) return false;
    this.revoked.add(sessionId);
    return true;
  }

  async revokeAllForIdentity(subject: string): Promise<number> {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.identityId === subject && !this.revoked.has(record.sessionId)) {
        this.revoked.add(record.sessionId);
        count += 1;
      }
    }
    return count;
  }
}

function cryptoIssuer(sessionId: () => string) {
  return new Ed25519AirenOSSessionIssuer({ issuer: issuerUrl, audience, keyId: kid, privateKey, ttlSeconds: 120, now: () => nowMs, sessionId });
}

function cryptoVerifier() {
  return new Ed25519AirenOSSessionVerifier({
    issuer: issuerUrl,
    audience,
    publicKeysJson: JSON.stringify({ [kid]: { key: publicKey.export({ format: "jwk" }), enabled: true } }),
    now: () => nowMs,
    clockSkewSeconds: 0
  });
}

function authority(issuer: PersistentAirenOSSessionIssuer) {
  return new AirenOSIdentitySessionAuthority(
    {
      async verify() {
        return { providerKey: "https://real-idp.example", providerSubject: "subject-1", authenticatedAtIso: new Date(nowMs - 1_000).toISOString() };
      }
    },
    {
      async resolveProviderIdentity() {
        return { identityId, status: "active", platformRoles: [] };
      }
    },
    issuer
  );
}

test("persistent issuer registers only session metadata before returning the bearer", async () => {
  const store = new MemoryLifecycleStore();
  const issuer = new PersistentAirenOSSessionIssuer(cryptoIssuer(() => "11111111-1111-4111-8111-111111111111"), store);
  const session = await authority(issuer).establishSession({});
  assert.equal(store.records.size, 1);
  assert.deepEqual(store.lastRegisteredKeys, ["expiresAtIso", "identityId", "issuedAtIso", "sessionId"]);
  assert.equal(store.records.get(session.sessionId)?.identityId, identityId);
  assert.equal(store.lastRegisteredKeys.includes("accessToken"), false);
});

test("session issuance fails closed when canonical lifecycle persistence fails", async () => {
  const failingStore: AirenOSSessionLifecycleStore = {
    async register() { throw new Error("session store unavailable"); },
    async resolveActive() { return null; },
    async revoke() { return false; },
    async revokeAllForIdentity() { return 0; }
  };
  const issuer = new PersistentAirenOSSessionIssuer(cryptoIssuer(() => "22222222-2222-4222-8222-222222222222"), failingStore);
  await assert.rejects(() => authority(issuer).establishSession({}), /session store unavailable/);
});

test("a cryptographically valid but unregistered AIRenOS token is rejected", async () => {
  const store = new MemoryLifecycleStore();
  const raw = await cryptoIssuer(() => "33333333-3333-4333-8333-333333333333").issue({
    identityId,
    upstreamProviderKey: "https://real-idp.example",
    upstreamProviderSubject: "subject-1",
    authenticatedAtIso: new Date(nowMs - 1_000).toISOString()
  });
  const verifier = new RevocationAwareAirenOSSessionVerifier(cryptoVerifier(), store);
  assert.equal(await verifier.verify({ authorization: `Bearer ${raw.accessToken}` }), null);
});

test("revocation invalidates a still-cryptographically-valid session immediately", async () => {
  const store = new MemoryLifecycleStore();
  const issuer = new PersistentAirenOSSessionIssuer(cryptoIssuer(() => "44444444-4444-4444-8444-444444444444"), store);
  const session = await authority(issuer).establishSession({});
  const verifier = new RevocationAwareAirenOSSessionVerifier(cryptoVerifier(), store);
  assert.ok(await verifier.verify({ authorization: `Bearer ${session.accessToken}` }));

  const revocations = new AirenOSSessionRevocationService(store);
  assert.equal(await revocations.revokeSession(session.sessionId, identityId, "user_logout"), true);
  assert.equal(await verifier.verify({ authorization: `Bearer ${session.accessToken}` }), null);
});

test("registry metadata must match signed temporal claims and revoke-all is identity-scoped", async () => {
  const store = new MemoryLifecycleStore();
  const first = await authority(new PersistentAirenOSSessionIssuer(cryptoIssuer(() => "55555555-5555-4555-8555-555555555555"), store)).establishSession({});
  const second = await authority(new PersistentAirenOSSessionIssuer(cryptoIssuer(() => "66666666-6666-4666-8666-666666666666"), store)).establishSession({});
  const verifier = new RevocationAwareAirenOSSessionVerifier(cryptoVerifier(), store);

  const original = store.records.get(first.sessionId)!;
  store.records.set(first.sessionId, { ...original, expiresAtIso: new Date(Date.parse(original.expiresAtIso) - 1_000).toISOString() });
  assert.equal(await verifier.verify({ authorization: `Bearer ${first.accessToken}` }), null);

  store.records.set(first.sessionId, original);
  const revocations = new AirenOSSessionRevocationService(store);
  assert.equal(await revocations.revokeAllSessions(identityId, "security_reset"), 2);
  assert.equal(await verifier.verify({ authorization: `Bearer ${first.accessToken}` }), null);
  assert.equal(await verifier.verify({ authorization: `Bearer ${second.accessToken}` }), null);
});

test("revocation reasons are mandatory and bounded", async () => {
  const store = new MemoryLifecycleStore();
  const revocations = new AirenOSSessionRevocationService(store);
  await assert.rejects(() => revocations.revokeAllSessions(identityId, "   "), /reason is required/);
  await assert.rejects(() => revocations.revokeAllSessions(identityId, "x".repeat(257)), /must not exceed 256/);
});
