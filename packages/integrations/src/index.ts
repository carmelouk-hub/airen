import { createHmac, timingSafeEqual } from "node:crypto";
import type { TenantContext } from "../../shared-contracts/src/index.ts";
import type { SessionCredentialVerifier, VerifiedAuthSession } from "../../identity/src/index.ts";

export type VerifiedWebhookEvent<T> = { provider: string; providerEventId: string; receivedAtIso: string; payload: T; };
export interface WebhookAdapter<TPayload, TResult> { verify(rawBody: Uint8Array, headers: Readonly<Record<string, string>>): Promise<VerifiedWebhookEvent<TPayload>>; handle(event: VerifiedWebhookEvent<TPayload>, context: TenantContext): Promise<TResult>; }
// Trusted provider-account -> Tenant/Location routing is mandatory. Payload tenant identifiers are never authoritative.

type SignedSessionClaims = Readonly<{ iss: string; aud: string; sub: string; sid: string; iat: number; exp: number }>;

type SignedSessionVerifierOptions = Readonly<{
  providerKey: string;
  audience: string;
  verificationKey: string | Uint8Array;
  now?: () => number;
  clockSkewSeconds?: number;
}>;

function bearerToken(request: unknown): string | null {
  if (!request || typeof request !== "object") return null;
  const value = (request as { authorization?: unknown }).authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length ? token : null;
}

function decodeClaims(segment: string): SignedSessionClaims | null {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Partial<SignedSessionClaims>;
    if (typeof parsed.iss !== "string" || typeof parsed.aud !== "string" || typeof parsed.sub !== "string" || typeof parsed.sid !== "string") return null;
    if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return null;
    return parsed as SignedSessionClaims;
  } catch {
    return null;
  }
}

export class HmacSignedSessionVerifier implements SessionCredentialVerifier {
  private readonly providerKey: string;
  private readonly audience: string;
  private readonly verificationKey: string | Uint8Array;
  private readonly now: () => number;
  private readonly clockSkewSeconds: number;

  constructor(options: SignedSessionVerifierOptions) {
    this.providerKey = options.providerKey;
    this.audience = options.audience;
    this.verificationKey = options.verificationKey;
    this.now = options.now ?? Date.now;
    this.clockSkewSeconds = options.clockSkewSeconds ?? 30;
  }

  async verify(request: unknown): Promise<VerifiedAuthSession | null> {
    const token = bearerToken(request);
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payloadSegment, signatureSegment] = parts;
    let actualSignature: Buffer;
    try { actualSignature = Buffer.from(signatureSegment, "base64url"); } catch { return null; }
    const expectedSignature = createHmac("sha256", this.verificationKey).update(payloadSegment).digest();
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) return null;
    const claims = decodeClaims(payloadSegment);
    if (!claims || claims.iss !== this.providerKey || claims.aud !== this.audience || !claims.sub || !claims.sid) return null;
    const nowSeconds = Math.floor(this.now() / 1000);
    if (claims.exp <= nowSeconds - this.clockSkewSeconds) return null;
    if (claims.iat > nowSeconds + this.clockSkewSeconds) return null;
    if (claims.exp <= claims.iat) return null;
    return {
      providerKey: this.providerKey,
      providerSubject: claims.sub,
      sessionId: claims.sid,
      issuedAtIso: new Date(claims.iat * 1000).toISOString(),
      expiresAtIso: new Date(claims.exp * 1000).toISOString()
    };
  }
}
