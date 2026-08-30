import { createPrivateKey, createPublicKey, randomUUID, sign as signData, verify as verifySignature, type KeyObject } from "node:crypto";
import type { UUID } from "../../shared-contracts/src/index.ts";
import type { AirenOSSessionCredentialVerifier, AirenOSSessionIssuer, AirenOSSessionIssueRequest, IssuedAirenOSSession, VerifiedAirenOSSession } from "../../identity/src/session-authority.ts";

type PrivateKeyMaterial = string | JsonWebKey | KeyObject;
type PublicKeyRecord = Readonly<{ key: string | JsonWebKey | KeyObject; enabled: boolean }>;
type Claims = Readonly<{ iss: string; aud: string; sub: UUID; sid: string; iat: number; exp: number }>;

function requireHttpsIssuer(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("AIRenOS session issuer must be an absolute URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error("AIRenOS session issuer must be a clean HTTPS URL");
  return url.toString().replace(/\/$/, "");
}

function base64Json(value: unknown): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function decodeCanonicalJson(segment: string): Record<string, unknown> | null {
  try {
    const bytes = Buffer.from(segment, "base64url");
    if (bytes.toString("base64url") !== segment) return null;
    const value = JSON.parse(bytes.toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function bearerToken(request: unknown): string | null {
  if (!request || typeof request !== "object") return null;
  const value = (request as { authorization?: unknown }).authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token || null;
}
function keyObject(material: PrivateKeyMaterial, kind: "private" | "public"): KeyObject {
  if (typeof material !== "string" && "type" in material && typeof (material as KeyObject).export === "function") return material as KeyObject;
  return kind === "private"
    ? createPrivateKey(typeof material === "string" ? material : { key: material, format: "jwk" })
    : createPublicKey(typeof material === "string" ? material : { key: material, format: "jwk" });
}
function parsePublicKeys(raw: string): ReadonlyMap<string, PublicKeyRecord> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("AIRENOS_SESSION_PUBLIC_KEYS_JSON must be valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AIRENOS_SESSION_PUBLIC_KEYS_JSON must be a JSON object");
  const map = new Map<string, PublicKeyRecord>();
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!kid || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AIRenOS session public key entry");
    const record = value as Record<string, unknown>;
    if (typeof record.enabled !== "boolean") throw new Error("AIRenOS session public key enabled flag must be boolean");
    const key = record.key;
    if (!(typeof key === "string" || (key && typeof key === "object" && !Array.isArray(key)))) throw new Error("AIRenOS session public key must be PEM or JWK");
    map.set(kid, Object.freeze({ key: key as string | JsonWebKey, enabled: record.enabled }));
  }
  if (!map.size) throw new Error("At least one AIRenOS session public key is required");
  return map;
}

export class Ed25519AirenOSSessionIssuer implements AirenOSSessionIssuer {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keyId: string;
  private readonly privateKey: KeyObject;
  private readonly ttlSeconds: number;
  private readonly now: () => number;
  private readonly sessionId: () => string;

  constructor(options: Readonly<{ issuer: string; audience: string; keyId: string; privateKey: PrivateKeyMaterial; ttlSeconds?: number; now?: () => number; sessionId?: () => string }>) {
    this.issuer = requireHttpsIssuer(options.issuer);
    if (!options.audience.trim()) throw new Error("AIRenOS session audience is required");
    if (!options.keyId.trim()) throw new Error("AIRenOS session keyId is required");
    this.audience = options.audience;
    this.keyId = options.keyId;
    this.privateKey = keyObject(options.privateKey, "private");
    if (this.privateKey.asymmetricKeyType !== "ed25519") throw new Error("AIRenOS session private key must be Ed25519");
    this.ttlSeconds = options.ttlSeconds ?? 300;
    if (!Number.isInteger(this.ttlSeconds) || this.ttlSeconds < 30 || this.ttlSeconds > 300) throw new Error("AIRenOS session TTL must be an integer between 30 and 300 seconds");
    this.now = options.now ?? Date.now;
    this.sessionId = options.sessionId ?? randomUUID;
  }

  async issue(input: AirenOSSessionIssueRequest): Promise<IssuedAirenOSSession> {
    if (!input.identityId) throw new Error("AIRenOS identityId is required");
    const iat = Math.floor(this.now() / 1000);
    const exp = iat + this.ttlSeconds;
    const sid = this.sessionId();
    const header = base64Json({ alg: "EdDSA", kid: this.keyId, typ: "at+jwt" });
    const payload = base64Json({ iss: this.issuer, aud: this.audience, sub: input.identityId, sid, iat, exp } satisfies Claims);
    const signingInput = `${header}.${payload}`;
    const signature = signData(null, Buffer.from(signingInput), this.privateKey).toString("base64url");
    return { accessToken: `${signingInput}.${signature}`, tokenType: "Bearer", sessionId: sid, issuedAtIso: new Date(iat * 1000).toISOString(), expiresAtIso: new Date(exp * 1000).toISOString() };
  }
}

export class Ed25519AirenOSSessionVerifier implements AirenOSSessionCredentialVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keys: ReadonlyMap<string, PublicKeyRecord>;
  private readonly now: () => number;
  private readonly clockSkewSeconds: number;
  private readonly maxTtlSeconds: number;

  constructor(options: Readonly<{ issuer: string; audience: string; publicKeysJson: string; now?: () => number; clockSkewSeconds?: number; maxTtlSeconds?: number }>) {
    this.issuer = requireHttpsIssuer(options.issuer);
    if (!options.audience.trim()) throw new Error("AIRenOS session audience is required");
    this.audience = options.audience;
    this.keys = parsePublicKeys(options.publicKeysJson);
    this.now = options.now ?? Date.now;
    this.clockSkewSeconds = options.clockSkewSeconds ?? 30;
    this.maxTtlSeconds = options.maxTtlSeconds ?? 300;
  }

  async verify(request: unknown): Promise<VerifiedAirenOSSession | null> {
    const token = bearerToken(request);
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decodeCanonicalJson(headerPart);
    const claimsRaw = decodeCanonicalJson(payloadPart);
    if (!header || !claimsRaw || header.alg !== "EdDSA" || header.typ !== "at+jwt" || typeof header.kid !== "string" || !header.kid) return null;
    let signature: Buffer;
    try { signature = Buffer.from(signaturePart, "base64url"); if (signature.toString("base64url") !== signaturePart) return null; } catch { return null; }
    const record = this.keys.get(header.kid);
    if (!record?.enabled) return null;
    let publicKey: KeyObject;
    try { publicKey = keyObject(record.key, "public"); } catch { return null; }
    if (publicKey.asymmetricKeyType !== "ed25519") return null;
    if (!verifySignature(null, Buffer.from(`${headerPart}.${payloadPart}`), publicKey, signature)) return null;
    const claims = claimsRaw as Partial<Claims>;
    if (claims.iss !== this.issuer || claims.aud !== this.audience || typeof claims.sub !== "string" || !claims.sub || typeof claims.sid !== "string" || !claims.sid || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return null;
    const iat = Number(claims.iat); const exp = Number(claims.exp);
    if (exp <= iat || exp - iat > this.maxTtlSeconds) return null;
    const now = Math.floor(this.now() / 1000);
    if (iat > now + this.clockSkewSeconds || exp < now - this.clockSkewSeconds) return null;
    return { issuer: this.issuer, audience: this.audience, identityId: claims.sub, sessionId: claims.sid, issuedAtIso: new Date(iat * 1000).toISOString(), expiresAtIso: new Date(exp * 1000).toISOString() };
  }
}
