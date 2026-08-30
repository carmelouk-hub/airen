import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { AppError } from "../../shared-contracts/src/index.ts";
import type { UpstreamIdentityCredentialVerifier, VerifiedUpstreamIdentity } from "../../identity/src/session-authority.ts";

export type OidcAuthorizationCodeCredential = Readonly<{
  code: string;
  codeVerifier: string;
  expectedNonce: string;
}>;

type FetchResponseLike = Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

type FetchLike = (
  url: string,
  init?: Readonly<{
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
  }>
) => Promise<FetchResponseLike>;

type OidcProviderMetadata = Readonly<{
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  idTokenSigningAlgs: readonly string[];
}>;

type JwkRecord = JsonWebKey & Readonly<{ kid?: string; use?: string; alg?: string }>;

type IdTokenClaims = Readonly<{
  iss: string;
  sub: string;
  aud: string | readonly string[];
  azp?: string;
  exp: number;
  iat: number;
  nbf?: number;
  auth_time?: number;
  nonce: string;
  sid?: string;
}>;

const providerKeyPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const pkceVerifierPattern = /^[A-Za-z0-9\-._~]{43,128}$/;
const defaultAllowedIdTokenAlgs = Object.freeze(["RS256", "ES256", "EdDSA"] as const);

function cleanHttpsIssuer(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("OIDC issuer must be an absolute URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("OIDC issuer must be a clean HTTPS URL without credentials, query, or fragment");
  }
  return url.toString().replace(/\/$/, "");
}

function cleanHttpsEndpoint(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${field} is required`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${field} must be an absolute URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${field} must be an HTTPS URL without credentials or fragment`);
  }
  return url.toString();
}

function exactRedirectUri(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("OIDC redirect URI must be absolute"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("OIDC redirect URI must be HTTPS and must not contain credentials or a fragment");
  }
  return url.toString();
}

function canonicalJsonSegment(segment: string): Record<string, unknown> | null {
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

function canonicalSignature(segment: string): Buffer | null {
  try {
    const bytes = Buffer.from(segment, "base64url");
    return bytes.toString("base64url") === segment ? bytes : null;
  } catch {
    return null;
  }
}

function credentialFrom(request: unknown): OidcAuthorizationCodeCredential | null {
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const candidate = request as Record<string, unknown>;
  if (typeof candidate.code !== "string" || !candidate.code || candidate.code.length > 4096) return null;
  if (typeof candidate.codeVerifier !== "string" || !pkceVerifierPattern.test(candidate.codeVerifier)) return null;
  if (typeof candidate.expectedNonce !== "string" || !candidate.expectedNonce || candidate.expectedNonce.length > 256) return null;
  return Object.freeze({
    code: candidate.code,
    codeVerifier: candidate.codeVerifier,
    expectedNonce: candidate.expectedNonce
  });
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as readonly string[];
}

function numericDate(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

function audienceMatches(claims: Partial<IdTokenClaims>, clientId: string): boolean {
  if (typeof claims.aud === "string") {
    if (claims.aud !== clientId) return false;
    return claims.azp === undefined || claims.azp === clientId;
  }
  if (!Array.isArray(claims.aud) || claims.aud.some((item) => typeof item !== "string") || !claims.aud.includes(clientId)) return false;
  if (claims.aud.length > 1) return claims.azp === clientId;
  return claims.azp === undefined || claims.azp === clientId;
}

function verifyJws(algorithm: string, signingInput: string, publicKey: KeyObject, signature: Buffer): boolean {
  const data = Buffer.from(signingInput);
  if (algorithm === "RS256") return verifySignature("RSA-SHA256", data, publicKey, signature);
  if (algorithm === "ES256") return verifySignature("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature);
  if (algorithm === "EdDSA") return verifySignature(null, data, publicKey, signature);
  return false;
}

export function oidcPkceS256Challenge(codeVerifier: string): string {
  if (!pkceVerifierPattern.test(codeVerifier)) throw new Error("PKCE code verifier must be 43-128 RFC 7636 unreserved characters");
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export class OidcAuthorizationCodeUpstreamVerifier implements UpstreamIdentityCredentialVerifier {
  private readonly providerKey: string;
  private readonly issuer: string;
  private readonly clientId: string;
  private readonly redirectUri: string;
  private readonly fetcher: FetchLike;
  private readonly now: () => number;
  private readonly clockSkewSeconds: number;
  private readonly metadataCacheMs: number;
  private readonly jwksCacheMs: number;
  private readonly maxIdTokenTtlSeconds: number;
  private readonly maxAuthenticationAgeSeconds: number;
  private readonly allowedIdTokenAlgs: ReadonlySet<string>;
  private metadataCache?: Readonly<{ value: OidcProviderMetadata; fetchedAtMs: number }>;
  private jwksCache?: Readonly<{ keys: readonly JwkRecord[]; fetchedAtMs: number }>;

  constructor(options: Readonly<{
    providerKey: string;
    issuer: string;
    clientId: string;
    redirectUri: string;
    fetch?: FetchLike;
    now?: () => number;
    clockSkewSeconds?: number;
    metadataCacheMs?: number;
    jwksCacheMs?: number;
    maxIdTokenTtlSeconds?: number;
    maxAuthenticationAgeSeconds?: number;
    allowedIdTokenAlgs?: readonly string[];
  }>) {
    if (!providerKeyPattern.test(options.providerKey)) throw new Error("OIDC providerKey must be a normalized AIRenOS provider identifier");
    if (!options.clientId.trim() || options.clientId.length > 256) throw new Error("OIDC clientId is required and must be bounded");
    this.providerKey = options.providerKey;
    this.issuer = cleanHttpsIssuer(options.issuer);
    this.clientId = options.clientId;
    this.redirectUri = exactRedirectUri(options.redirectUri);
    const runtimeFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!runtimeFetch) throw new Error("OIDC adapter requires a fetch implementation");
    this.fetcher = runtimeFetch;
    this.now = options.now ?? Date.now;
    this.clockSkewSeconds = options.clockSkewSeconds ?? 30;
    this.metadataCacheMs = options.metadataCacheMs ?? 300_000;
    this.jwksCacheMs = options.jwksCacheMs ?? 300_000;
    this.maxIdTokenTtlSeconds = options.maxIdTokenTtlSeconds ?? 3600;
    this.maxAuthenticationAgeSeconds = options.maxAuthenticationAgeSeconds ?? 300;
    const allowed = options.allowedIdTokenAlgs ?? defaultAllowedIdTokenAlgs;
    if (!allowed.length || allowed.some((alg) => !defaultAllowedIdTokenAlgs.includes(alg as typeof defaultAllowedIdTokenAlgs[number]))) {
      throw new Error("OIDC allowed ID-token algorithms must be a non-empty subset of RS256, ES256, EdDSA");
    }
    this.allowedIdTokenAlgs = new Set(allowed);
    for (const [label, value] of [
      ["clockSkewSeconds", this.clockSkewSeconds],
      ["metadataCacheMs", this.metadataCacheMs],
      ["jwksCacheMs", this.jwksCacheMs],
      ["maxIdTokenTtlSeconds", this.maxIdTokenTtlSeconds],
      ["maxAuthenticationAgeSeconds", this.maxAuthenticationAgeSeconds]
    ] as const) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`OIDC ${label} must be a non-negative integer`);
    }
  }

  async authorizationEndpoint(): Promise<string> {
    return (await this.metadata()).authorizationEndpoint;
  }

  async verify(request: unknown): Promise<VerifiedUpstreamIdentity | null> {
    const credential = credentialFrom(request);
    if (!credential) return null;
    const metadata = await this.metadata();
    const tokenResponse = await this.fetcher(metadata.tokenEndpoint, {
      method: "POST",
      headers: Object.freeze({
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      }),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        code: credential.code,
        redirect_uri: this.redirectUri,
        code_verifier: credential.codeVerifier
      }).toString()
    });
    if (!tokenResponse.ok) return null;
    const tokenPayload = await this.safeJson(tokenResponse, "OIDC token endpoint returned invalid JSON");
    if (!tokenPayload || typeof tokenPayload !== "object" || Array.isArray(tokenPayload)) return null;
    const idToken = (tokenPayload as Record<string, unknown>).id_token;
    if (typeof idToken !== "string" || !idToken) return null;
    return this.verifyIdToken(idToken, credential.expectedNonce, metadata);
  }

  private async metadata(force = false): Promise<OidcProviderMetadata> {
    const nowMs = this.now();
    if (!force && this.metadataCache && nowMs - this.metadataCache.fetchedAtMs <= this.metadataCacheMs) return this.metadataCache.value;
    const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
    let response: FetchResponseLike;
    try {
      response = await this.fetcher(discoveryUrl, { headers: Object.freeze({ accept: "application/json" }) });
    } catch {
      throw new AppError("UPSTREAM_IDP_UNAVAILABLE", "OIDC discovery endpoint is unavailable");
    }
    if (!response.ok) throw new AppError("UPSTREAM_IDP_UNAVAILABLE", "OIDC discovery endpoint rejected the request", { status: response.status });
    const raw = await this.safeJson(response, "OIDC discovery response is invalid JSON");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "OIDC discovery response must be a JSON object");
    const document = raw as Record<string, unknown>;
    if (document.issuer !== this.issuer) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "OIDC discovery issuer does not exactly match configured issuer");
    const responseTypes = stringArray(document.response_types_supported);
    if (!responseTypes?.includes("code")) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "OIDC provider must support Authorization Code flow");
    const challengeMethods = stringArray(document.code_challenge_methods_supported);
    if (!challengeMethods?.includes("S256")) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "OIDC provider must advertise PKCE S256 support");
    const advertisedAlgs = document.id_token_signing_alg_values_supported === undefined
      ? null
      : stringArray(document.id_token_signing_alg_values_supported);
    if (advertisedAlgs && !advertisedAlgs.some((alg) => this.allowedIdTokenAlgs.has(alg))) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "OIDC provider does not advertise an allowed ID-token signing algorithm");
    }
    const value = Object.freeze({
      issuer: this.issuer,
      authorizationEndpoint: cleanHttpsEndpoint(document.authorization_endpoint, "OIDC authorization_endpoint"),
      tokenEndpoint: cleanHttpsEndpoint(document.token_endpoint, "OIDC token_endpoint"),
      jwksUri: cleanHttpsEndpoint(document.jwks_uri, "OIDC jwks_uri"),
      idTokenSigningAlgs: advertisedAlgs ?? [...this.allowedIdTokenAlgs]
    });
    this.metadataCache = Object.freeze({ value, fetchedAtMs: nowMs });
    return value;
  }

  private async jwks(metadata: OidcProviderMetadata, force = false): Promise<readonly JwkRecord[]> {
    const nowMs = this.now();
    if (!force && this.jwksCache && nowMs - this.jwksCache.fetchedAtMs <= this.jwksCacheMs) return this.jwksCache.keys;
    let response: FetchResponseLike;
    try {
      response = await this.fetcher(metadata.jwksUri, { headers: Object.freeze({ accept: "application/json" }) });
    } catch {
      throw new AppError("UPSTREAM_IDP_UNAVAILABLE", "OIDC JWKS endpoint is unavailable");
    }
    if (!response.ok) throw new AppError("UPSTREAM_IDP_UNAVAILABLE", "OIDC JWKS endpoint rejected the request", { status: response.status });
    const raw = await this.safeJson(response, "OIDC JWKS response is invalid JSON");
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray((raw as Record<string, unknown>).keys)) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "OIDC JWKS response must contain a keys array");
    }
    const keys = (raw as { keys: unknown[] }).keys.filter((item): item is JwkRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    if (!keys.length) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "OIDC JWKS response contains no usable keys");
    this.jwksCache = Object.freeze({ keys: Object.freeze(keys), fetchedAtMs: nowMs });
    return this.jwksCache.keys;
  }

  private async verifyIdToken(idToken: string, expectedNonce: string, metadata: OidcProviderMetadata): Promise<VerifiedUpstreamIdentity | null> {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = canonicalJsonSegment(headerPart);
    const claimsRaw = canonicalJsonSegment(payloadPart);
    const signature = canonicalSignature(signaturePart);
    if (!header || !claimsRaw || !signature) return null;
    const alg = typeof header.alg === "string" ? header.alg : "";
    const kid = typeof header.kid === "string" ? header.kid : "";
    if (!this.allowedIdTokenAlgs.has(alg) || !metadata.idTokenSigningAlgs.includes(alg) || !kid) return null;
    if (header.typ !== undefined && header.typ !== "JWT") return null;

    let keys = await this.jwks(metadata);
    let jwk = keys.find((candidate) => candidate.kid === kid && candidate.use !== "enc" && (candidate.alg === undefined || candidate.alg === alg));
    if (!jwk) {
      keys = await this.jwks(metadata, true);
      jwk = keys.find((candidate) => candidate.kid === kid && candidate.use !== "enc" && (candidate.alg === undefined || candidate.alg === alg));
    }
    if (!jwk) return null;
    let publicKey: KeyObject;
    try { publicKey = createPublicKey({ key: jwk, format: "jwk" }); } catch { return null; }
    if (!verifyJws(alg, `${headerPart}.${payloadPart}`, publicKey, signature)) return null;

    const claims = claimsRaw as Partial<IdTokenClaims>;
    const exp = numericDate(claims.exp);
    const iat = numericDate(claims.iat);
    const nbf = claims.nbf === undefined ? null : numericDate(claims.nbf);
    const authTime = claims.auth_time === undefined ? iat : numericDate(claims.auth_time);
    if (claims.iss !== this.issuer || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return null;
    if (!audienceMatches(claims, this.clientId)) return null;
    if (typeof claims.nonce !== "string" || claims.nonce !== expectedNonce) return null;
    if (exp === null || iat === null || authTime === null || (claims.nbf !== undefined && nbf === null)) return null;
    if (exp <= iat || exp - iat > this.maxIdTokenTtlSeconds) return null;
    const nowSeconds = Math.floor(this.now() / 1000);
    if (exp < nowSeconds - this.clockSkewSeconds || iat > nowSeconds + this.clockSkewSeconds) return null;
    if (nbf !== null && nbf > nowSeconds + this.clockSkewSeconds) return null;
    if (authTime > nowSeconds + this.clockSkewSeconds || nowSeconds - authTime > this.maxAuthenticationAgeSeconds + this.clockSkewSeconds) return null;
    if (claims.sid !== undefined && (typeof claims.sid !== "string" || !claims.sid || claims.sid.length > 256)) return null;
    return Object.freeze({
      providerKey: this.providerKey,
      providerSubject: claims.sub,
      authenticatedAtIso: new Date(authTime * 1000).toISOString(),
      ...(typeof claims.sid === "string" ? { providerSessionId: claims.sid } : {})
    });
  }

  private async safeJson(response: FetchResponseLike, message: string): Promise<unknown> {
    try { return await response.json(); } catch { throw new AppError("UPSTREAM_IDP_UNAVAILABLE", message); }
  }
}
