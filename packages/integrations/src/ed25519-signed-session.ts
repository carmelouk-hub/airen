import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import type { SessionCredentialVerifier, VerifiedAuthSession } from "../../identity/src/index.ts";

export type Ed25519SignedSessionVerifierOptions = Readonly<{
  providerKey: string;
  audience: string;
  publicKeysJson: string;
  now?: () => number;
  clockSkewSeconds?: number;
  maxTtlSeconds?: number;
}>;

type KeyRecord = Readonly<{ key: string | JsonWebKey | KeyObject; enabled: boolean }>;
type SessionClaims = Readonly<{
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}>;

function bearerToken(request: unknown): string | null {
  if (!request || typeof request !== "object") return null;
  const value = (request as { authorization?: unknown }).authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length ? token : null;
}

function decodeCanonicalJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const bytes = Buffer.from(segment, "base64url");
    if (bytes.toString("base64url") !== segment) return null;
    const parsed = JSON.parse(bytes.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseKeyRegistry(raw: string): ReadonlyMap<string, KeyRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AUTH_SESSION_PUBLIC_KEYS_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AUTH_SESSION_PUBLIC_KEYS_JSON must be a JSON object");
  }
  const records = new Map<string, KeyRecord>();
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!kid.trim() || !value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid AUTH_SESSION_PUBLIC_KEYS_JSON entry");
    }
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.enabled !== "boolean") throw new Error("Auth session public key enabled flag must be boolean");
    const key = candidate.key;
    if (!(typeof key === "string" || (key && typeof key === "object" && !Array.isArray(key)))) {
      throw new Error("Auth session public key must be PEM text or JWK");
    }
    records.set(kid, Object.freeze({ key: key as string | JsonWebKey, enabled: candidate.enabled }));
  }
  if (!records.size) throw new Error("AUTH_SESSION_PUBLIC_KEYS_JSON must contain at least one key");
  return records;
}

export class Ed25519SignedSessionVerifier implements SessionCredentialVerifier {
  private readonly providerKey: string;
  private readonly audience: string;
  private readonly keys: ReadonlyMap<string, KeyRecord>;
  private readonly now: () => number;
  private readonly clockSkewSeconds: number;
  private readonly maxTtlSeconds: number;

  constructor(options: Ed25519SignedSessionVerifierOptions) {
    this.providerKey = options.providerKey;
    this.audience = options.audience;
    this.keys = parseKeyRegistry(options.publicKeysJson);
    this.now = options.now ?? Date.now;
    this.clockSkewSeconds = options.clockSkewSeconds ?? 30;
    this.maxTtlSeconds = options.maxTtlSeconds ?? 300;
  }

  async verify(request: unknown): Promise<VerifiedAuthSession | null> {
    const token = bearerToken(request);
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decodeCanonicalJsonSegment(headerPart);
    const claimsRaw = decodeCanonicalJsonSegment(payloadPart);
    if (!header || !claimsRaw || header.alg !== "EdDSA" || typeof header.kid !== "string" || !header.kid) return null;

    let signature: Buffer;
    try {
      signature = Buffer.from(signaturePart, "base64url");
      if (signature.toString("base64url") !== signaturePart) return null;
    } catch {
      return null;
    }

    const record = this.keys.get(header.kid);
    if (!record?.enabled) return null;
    let key: KeyObject;
    try {
      key = record.key instanceof Object && "type" in record.key && typeof (record.key as KeyObject).export === "function"
        ? record.key as KeyObject
        : typeof record.key === "string"
          ? createPublicKey(record.key)
          : createPublicKey({ key: record.key as JsonWebKey, format: "jwk" });
    } catch {
      return null;
    }
    if (!verifySignature(null, Buffer.from(`${headerPart}.${payloadPart}`), key, signature)) return null;

    const claims = claimsRaw as Partial<SessionClaims>;
    if (
      claims.iss !== this.providerKey ||
      claims.aud !== this.audience ||
      typeof claims.sub !== "string" || !claims.sub ||
      typeof claims.sid !== "string" || !claims.sid ||
      !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp)
    ) return null;

    const iat = Number(claims.iat);
    const exp = Number(claims.exp);
    if (exp <= iat || exp - iat > this.maxTtlSeconds) return null;
    const nowSeconds = Math.floor(this.now() / 1000);
    if (iat > nowSeconds + this.clockSkewSeconds || exp < nowSeconds - this.clockSkewSeconds) return null;

    return {
      providerKey: this.providerKey,
      providerSubject: claims.sub,
      sessionId: claims.sid,
      issuedAtIso: new Date(iat * 1000).toISOString(),
      expiresAtIso: new Date(exp * 1000).toISOString()
    };
  }
}
