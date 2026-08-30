import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signData } from "node:crypto";
import { OidcAuthorizationCodeUpstreamVerifier, oidcPkceS256Challenge } from "../../packages/integrations/src/oidc-upstream-provider.ts";

const issuer = "https://idp.example.com";
const clientId = "airenos-browser-client";
const redirectUri = "https://identity.airenos.example/oidc/callback";
const providerKey = "upstream_oidc";
const codeVerifier = "A".repeat(43);
const expectedNonce = "nonce-0123456789abcdef";
const nowMs = Date.UTC(2026, 7, 31, 12, 0, 0);
const nowSeconds = Math.floor(nowMs / 1000);
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "oidc-rs256-k1";
const publicJwk = Object.freeze({
  ...(publicKey.export({ format: "jwk" }) as JsonWebKey),
  kid,
  use: "sig",
  alg: "RS256"
});

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function issueIdToken(overrides: Record<string, unknown> = {}): string {
  const header = base64Json({ alg: "RS256", kid, typ: "JWT" });
  const payload = base64Json({
    iss: issuer,
    sub: "provider-subject-123",
    aud: clientId,
    exp: nowSeconds + 300,
    iat: nowSeconds - 2,
    auth_time: nowSeconds - 10,
    nonce: expectedNonce,
    sid: "upstream-session-1",
    ...overrides
  });
  const signingInput = `${header}.${payload}`;
  const signature = signData("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function jsonResponse(body: unknown, status = 200) {
  return Object.freeze({
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  });
}

function providerHarness(options: Readonly<{
  idToken?: string;
  discoveryIssuer?: string;
  challengeMethods?: readonly string[];
  tokenStatus?: number;
}> = {}) {
  const calls: Array<Readonly<{ url: string; method: string; body?: string }>> = [];
  const discovery = Object.freeze({
    issuer: options.discoveryIssuer ?? issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: options.challengeMethods ?? ["S256"],
    id_token_signing_alg_values_supported: ["RS256"]
  });
  const fetcher = async (url: string, init?: Readonly<{ method?: string; headers?: Readonly<Record<string, string>>; body?: string }>) => {
    calls.push(Object.freeze({ url, method: init?.method ?? "GET", ...(init?.body ? { body: init.body } : {}) }));
    if (url === `${issuer}/.well-known/openid-configuration`) return jsonResponse(discovery);
    if (url === `${issuer}/jwks`) return jsonResponse({ keys: [publicJwk] });
    if (url === `${issuer}/token`) {
      if (options.tokenStatus && options.tokenStatus !== 200) return jsonResponse({ error: "invalid_grant" }, options.tokenStatus);
      return jsonResponse({ token_type: "Bearer", access_token: "UPSTREAM_TOKEN_NOT_USED_AS_AIRENOS_AUTHORITY", id_token: options.idToken ?? issueIdToken() });
    }
    return jsonResponse({ error: "unexpected_url" }, 404);
  };
  const verifier = new OidcAuthorizationCodeUpstreamVerifier({
    providerKey,
    issuer,
    clientId,
    redirectUri,
    fetch: fetcher,
    now: () => nowMs,
    clockSkewSeconds: 0,
    metadataCacheMs: 300_000,
    jwksCacheMs: 300_000
  });
  return { verifier, calls };
}

test("F2 performs discovery, public-client Authorization Code exchange with PKCE, JWKS validation and nonce binding", async () => {
  const { verifier, calls } = providerHarness();
  assert.equal(await verifier.authorizationEndpoint(), `${issuer}/authorize`);
  const verified = await verifier.verify({
    code: "one-time-authorization-code",
    codeVerifier,
    expectedNonce,
    tenant_id: "attacker-tenant",
    role: "platform_super_admin"
  });
  assert.deepEqual(verified, {
    providerKey,
    providerSubject: "provider-subject-123",
    authenticatedAtIso: new Date((nowSeconds - 10) * 1000).toISOString(),
    providerSessionId: "upstream-session-1"
  });
  const tokenCall = calls.find((call) => call.url === `${issuer}/token`);
  assert.ok(tokenCall);
  assert.equal(tokenCall.method, "POST");
  const form = new URLSearchParams(tokenCall.body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("client_id"), clientId);
  assert.equal(form.get("redirect_uri"), redirectUri);
  assert.equal(form.get("code_verifier"), codeVerifier);
  assert.equal(form.get("code"), "one-time-authorization-code");
  assert.equal(form.has("client_secret"), false);
  assert.equal(oidcPkceS256Challenge(codeVerifier), "DwBzhbb51LfusnSGBa_hqYSgo7-j8BTQnip4TOnlzRo");
});

test("F2 rejects invalid PKCE credential shape before contacting the upstream provider", async () => {
  const { verifier, calls } = providerHarness();
  assert.equal(await verifier.verify({ code: "code", codeVerifier: "too-short", expectedNonce }), null);
  assert.equal(calls.length, 0);
});

test("F2 rejects nonce, audience and cryptographic-signature mismatches", async () => {
  const nonceHarness = providerHarness();
  assert.equal(await nonceHarness.verifier.verify({ code: "code", codeVerifier, expectedNonce: "wrong-nonce" }), null);

  const audienceHarness = providerHarness({ idToken: issueIdToken({ aud: "wrong-client" }) });
  assert.equal(await audienceHarness.verifier.verify({ code: "code", codeVerifier, expectedNonce }), null);

  const token = issueIdToken();
  const parts = token.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  const signatureHarness = providerHarness({ idToken: parts.join(".") });
  assert.equal(await signatureHarness.verifier.verify({ code: "code", codeVerifier, expectedNonce }), null);
});

test("F2 fails closed when OIDC discovery issuer is not the exact configured issuer", async () => {
  const { verifier } = providerHarness({ discoveryIssuer: "https://evil.example.com" });
  await assert.rejects(
    () => verifier.verify({ code: "code", codeVerifier, expectedNonce }),
    /issuer does not exactly match configured issuer/
  );
});

test("F2 requires provider-advertised PKCE S256 support and does not treat token endpoint denial as identity", async () => {
  const noPkce = providerHarness({ challengeMethods: ["plain"] });
  await assert.rejects(
    () => noPkce.verifier.verify({ code: "code", codeVerifier, expectedNonce }),
    /PKCE S256/
  );

  const denied = providerHarness({ tokenStatus: 400 });
  assert.equal(await denied.verifier.verify({ code: "denied-code", codeVerifier, expectedNonce }), null);
});
