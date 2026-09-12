import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool, type PoolClient } from "pg";
import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import { AirenOSIdentitySessionAuthority } from "../../../packages/identity/src/session-authority.ts";
import { PersistentAirenOSSessionIssuer } from "../../../packages/identity/src/session-lifecycle.ts";
import { Ed25519AirenOSSessionIssuer, Ed25519AirenOSSessionVerifier } from "../../../packages/integrations/src/airenos-session-ed25519.ts";
import { OidcAuthorizationCodeUpstreamVerifier } from "../../../packages/integrations/src/oidc-upstream-provider.ts";
import { PostgresAuthenticationIdentityDirectory } from "../../../packages/persistence-postgres/src/index.ts";
import { PostgresAirenOSSessionLifecycleStore } from "../../../packages/persistence-postgres/src/airenos-session-lifecycle.ts";
import { classifyError } from "../../../packages/observability/src/index.ts";
import { parseDeploymentRuntimeOptions } from "./deployment-config.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export type SessionAuthorityRuntimeSecrets = Readonly<{
  databaseUrl: string;
  privateKeyPem: string;
  publicKeyringText: string;
}>;

type SessionAuthorityStagingConfig = Readonly<{
  issuer: string;
  audience: string;
  keyId: string;
  allowedOrigin: string;
  requireForwardedHttps: boolean;
  upstreamProviderKey: string;
  upstreamIssuer: string;
  upstreamClientId: string;
  upstreamRedirectUri: string;
}>;

function required(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required Session Authority staging field: ${key}`, { field: key });
  return value;
}

function cleanHttpsUrl(value: string, field: string, originOnly = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("RUNTIME_CONFIGURATION_INVALID", `${field} must be an absolute URL`, { field }); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", `${field} must be a clean HTTPS URL`, { field });
  }
  if (originOnly && (url.pathname !== "/" || url.search)) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", `${field} must be an HTTPS origin without path or query`, { field });
  }
  return originOnly ? url.origin : url.toString().replace(/\/$/, "");
}

function booleanField(input: EnvironmentInput, key: string, fallback: boolean): boolean {
  const raw = input[key]?.trim();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", `${key} must be true or false`, { field: key });
}

function loadConfig(input: EnvironmentInput): SessionAuthorityStagingConfig {
  return Object.freeze({
    issuer: cleanHttpsUrl(required(input, "AIRENOS_SESSION_ISSUER"), "AIRENOS_SESSION_ISSUER"),
    audience: required(input, "AIRENOS_SESSION_AUDIENCE"),
    keyId: required(input, "AIRENOS_SESSION_KEY_ID"),
    allowedOrigin: cleanHttpsUrl(required(input, "AIRENOS_SESSION_ALLOWED_ORIGIN"), "AIRENOS_SESSION_ALLOWED_ORIGIN", true),
    requireForwardedHttps: booleanField(input, "AIRENOS_SESSION_REQUIRE_FORWARDED_HTTPS", true),
    upstreamProviderKey: required(input, "AIRENOS_UPSTREAM_PROVIDER_KEY"),
    upstreamIssuer: cleanHttpsUrl(required(input, "AIRENOS_UPSTREAM_OIDC_ISSUER"), "AIRENOS_UPSTREAM_OIDC_ISSUER"),
    upstreamClientId: required(input, "AIRENOS_UPSTREAM_OIDC_CLIENT_ID"),
    upstreamRedirectUri: cleanHttpsUrl(required(input, "AIRENOS_UPSTREAM_OIDC_REDIRECT_URI"), "AIRENOS_UPSTREAM_OIDC_REDIRECT_URI"),
  });
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
}

function applyBrowserSecurityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
}

function json(response: ServerResponse, statusCode: number, body: Readonly<Record<string, unknown>>): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  applySecurityHeaders(response);
  response.end(JSON.stringify(body));
}

function browserHtml(response: ServerResponse, mode: "start" | "callback"): void {
  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  applyBrowserSecurityHeaders(response);
  const message = mode === "start" ? "Redirecting to AIRenOS identity provider…" : "Completing AIRenOS staging authentication…";
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIRenOS staging authentication</title></head><body data-mode="${mode}"><main><h1>AIRenOS staging authentication</h1><p id="status">${message}</p></main><script src="/oidc/client.js" defer></script></body></html>`);
}

const OIDC_BROWSER_CLIENT = String.raw`(() => {
  "use strict";
  const status = document.getElementById("status");
  const mode = document.body.dataset.mode;
  const keys = Object.freeze({
    state: "airenos.oidc.state",
    verifier: "airenos.oidc.verifier",
    nonce: "airenos.oidc.nonce"
  });

  const setStatus = (value) => { if (status) status.textContent = value; };
  const clearTransient = () => {
    try {
      sessionStorage.removeItem(keys.state);
      sessionStorage.removeItem(keys.verifier);
      sessionStorage.removeItem(keys.nonce);
    } catch {}
  };
  const fail = (message) => {
    clearTransient();
    document.title = "AIRenOS authentication failed";
    setStatus(message);
  };
  const base64url = (bytes) => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };
  const randomToken = (size) => {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  };
  const pkceChallenge = async (verifier) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(digest));
  };

  const start = async () => {
    if (!window.isSecureContext || !crypto?.subtle) return fail("Secure browser cryptography is required.");
    const configResponse = await fetch("/v1/oidc/config", { headers: { accept: "application/json" }, cache: "no-store", credentials: "same-origin" });
    if (!configResponse.ok) return fail("OIDC configuration is unavailable.");
    const config = await configResponse.json();
    if (config.pkceMethod !== "S256" || config.responseType !== "code" || typeof config.authorizationEndpoint !== "string" || typeof config.clientId !== "string" || typeof config.redirectUri !== "string") {
      return fail("OIDC configuration is invalid.");
    }

    const verifier = randomToken(64);
    const nonce = randomToken(32);
    const state = randomToken(32);
    const challenge = await pkceChallenge(verifier);
    try {
      sessionStorage.setItem(keys.verifier, verifier);
      sessionStorage.setItem(keys.nonce, nonce);
      sessionStorage.setItem(keys.state, state);
    } catch {
      return fail("Browser session storage is required.");
    }

    const authorizationUrl = new URL(config.authorizationEndpoint);
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid");
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("state", state);
    window.location.assign(authorizationUrl.toString());
  };

  const callback = async () => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("error")) {
      history.replaceState(null, "", "/oidc/callback");
      return fail("The identity provider rejected authentication.");
    }

    const code = query.get("code");
    const returnedState = query.get("state");
    let expectedState = null;
    let verifier = null;
    let nonce = null;
    try {
      expectedState = sessionStorage.getItem(keys.state);
      verifier = sessionStorage.getItem(keys.verifier);
      nonce = sessionStorage.getItem(keys.nonce);
    } catch {}

    history.replaceState(null, "", "/oidc/callback");
    if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier || !nonce) {
      return fail("OIDC callback state is invalid or expired.");
    }
    clearTransient();

    const exchangeResponse = await fetch("/v1/session/exchange", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      body: JSON.stringify({ code, codeVerifier: verifier, expectedNonce: nonce })
    });
    if (!exchangeResponse.ok) return fail("AIRenOS session exchange failed.");
    const issued = await exchangeResponse.json();
    if (issued.tokenType !== "Bearer" || typeof issued.accessToken !== "string" || !issued.accessToken || typeof issued.sessionId !== "string" || !issued.sessionId) {
      return fail("AIRenOS session response is invalid.");
    }

    const verifyResponse = await fetch("/v1/session/verify", {
      method: "POST",
      headers: { accept: "application/json", authorization: "Bearer " + issued.accessToken },
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!verifyResponse.ok) return fail("AIRenOS session verification failed.");
    const verification = await verifyResponse.json();
    if (verification.valid !== true || verification.sessionId !== issued.sessionId) return fail("AIRenOS session verification failed.");

    document.title = "AIRenOS staging session verified";
    setStatus("AIRenOS staging session established and verified.");
  };

  Promise.resolve(mode === "start" ? start() : mode === "callback" ? callback() : fail("Invalid authentication page."))
    .catch(() => fail("AIRenOS staging authentication failed."));
})();`;

function browserScript(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/javascript; charset=utf-8");
  applyBrowserSecurityHeaders(response);
  response.end(OIDC_BROWSER_CLIENT);
}

function exactOriginAllowed(request: IncomingMessage, response: ServerResponse, allowedOrigins: readonly string[], requiredForRequest: boolean): boolean {
  const origin = header(request, "origin");
  if (!origin) return !requiredForRequest;
  if (!allowedOrigins.includes(origin)) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  return true;
}

function forwardedHttps(request: IncomingMessage): boolean {
  const raw = header(request, "x-forwarded-proto") ?? "";
  return raw.split(",")[0]?.trim().toLowerCase() === "https";
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = header(request, "content-type");
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_FAILED", "Session exchange content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 16 * 1024) throw new AppError("VALIDATION_FAILED", "Session exchange request body exceeds 16 KiB");
    chunks.push(data);
  }
  if (!chunks.length) throw new AppError("VALIDATION_FAILED", "Session exchange body is required");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError("VALIDATION_FAILED", "Session exchange body is not valid JSON"); }
}

function statusForError(code: string): number {
  if (code === "VALIDATION_FAILED") return 400;
  if (code === "AUTHENTICATION_REQUIRED") return 401;
  if (code === "UPSTREAM_IDP_UNAVAILABLE") return 503;
  return 500;
}

function safeDatabaseErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "UNKNOWN";
  const code = (error as Readonly<{ code?: unknown }>).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : "UNKNOWN";
}

export async function startAirenOSSessionAuthorityStagingServer(
  environment: EnvironmentInput = process.env,
  secrets: SessionAuthorityRuntimeSecrets,
) {
  const deployment = parseDeploymentRuntimeOptions(environment);
  const config = loadConfig(environment);
  const browserOrigin = new URL(config.issuer).origin;
  const allowedOrigins = Object.freeze([...new Set([config.allowedOrigin, browserOrigin])]);
  const pool = new Pool({
    connectionString: secrets.databaseUrl,
    max: 5,
    application_name: "airenos-session-authority-f23-staging",
  });

  const identities = new PostgresAuthenticationIdentityDirectory(pool);
  const lifecycle = new PostgresAirenOSSessionLifecycleStore(pool);
  const upstream = new OidcAuthorizationCodeUpstreamVerifier({
    providerKey: config.upstreamProviderKey,
    issuer: config.upstreamIssuer,
    clientId: config.upstreamClientId,
    redirectUri: config.upstreamRedirectUri,
  });
  const cryptoIssuer = new Ed25519AirenOSSessionIssuer({
    issuer: config.issuer,
    audience: config.audience,
    keyId: config.keyId,
    privateKey: secrets.privateKeyPem,
    ttlSeconds: 300,
  });
  const sessionVerifier = new Ed25519AirenOSSessionVerifier({
    issuer: config.issuer,
    audience: config.audience,
    publicKeysJson: secrets.publicKeyringText,
  });
  const authority = new AirenOSIdentitySessionAuthority(
    upstream,
    identities,
    new PersistentAirenOSSessionIssuer(cryptoIssuer, lifecycle),
  );

  const publicKeyring = JSON.parse(secrets.publicKeyringText) as Readonly<Record<string, unknown>>;

  const readiness = async () => {
    let databaseOk = false;
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      const login = await client.query<{
        session_role: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        auth_member: boolean;
      }>(`SELECT
        session_user AS session_role,
        r.rolsuper,
        r.rolbypassrls,
        pg_has_role(session_user,'airen_auth','MEMBER') AS auth_member
      FROM pg_roles r WHERE r.rolname=session_user`);
      const role = login.rows[0];
      const loginOk = Boolean(role && !role.rolsuper && !role.rolbypassrls && role.auth_member);

      if (loginOk) {
        await client.query("SET LOCAL ROLE airen_auth");
        const authorityDatabase = await client.query<{
          effective_role: string;
          resolve_auth_function: boolean;
          resolve_auth_executable: boolean;
        }>(`SELECT
          current_user AS effective_role,
          to_regprocedure('security.resolve_authentication_identity(text,text)') IS NOT NULL AS resolve_auth_function,
          has_function_privilege(
            current_user,
            'security.resolve_authentication_identity(text,text)',
            'EXECUTE'
          ) AS resolve_auth_executable
        FROM (
          SELECT count(*)
          FROM security.resolve_authentication_identity(
            '__airenos_readiness__',
            '__airenos_readiness__'
          )
        ) AS authority_path_probe`);
        const effective = authorityDatabase.rows[0];
        databaseOk = Boolean(
          effective
          && effective.effective_role === "airen_auth"
          && effective.resolve_auth_function
          && effective.resolve_auth_executable
        );
      }

      await client.query("ROLLBACK");
    } catch (error) {
      const databaseErrorCode = safeDatabaseErrorCode(error);
      process.stderr.write(`${JSON.stringify({ event: "airenos.session_authority.readiness_database_failed", errorCode: databaseErrorCode })}\n`);
      try { if (client) await client.query("ROLLBACK"); } catch {}
      databaseOk = false;
    } finally {
      client?.release();
    }

    let upstreamOk = false;
    try {
      const endpoint = await upstream.authorizationEndpoint();
      upstreamOk = endpoint.startsWith("https://");
    } catch {
      upstreamOk = false;
    }

    return Object.freeze({ databaseOk, upstreamOk, ok: databaseOk && upstreamOk });
  };

  const server = createServer(async (request, response) => {
    try {
      const requestPath = (request.url ?? "").split("?", 1)[0];

      if (request.method === "GET" && requestPath === "/health/live") {
        json(response, 200, { status: "LIVE", service: "airenos-session-authority-f23-staging", releaseRevision: deployment.releaseRevision });
        return;
      }

      if (request.method === "GET" && requestPath === "/health/ready") {
        const probe = await readiness();
        json(response, probe.ok ? 200 : 503, {
          status: probe.ok ? "READY" : "NOT_READY",
          service: "airenos-session-authority-f23-staging",
          releaseRevision: deployment.releaseRevision,
          checks: [
            { name: "postgres.identity_session_authority", critical: true, ok: probe.databaseOk },
            { name: "oidc.discovery", critical: true, ok: probe.upstreamOk },
          ],
        });
        return;
      }

      if (request.method === "GET" && (requestPath === "/oidc/start" || requestPath === "/oidc/callback" || requestPath === "/oidc/client.js")) {
        if (config.requireForwardedHttps && !forwardedHttps(request)) {
          json(response, 400, { error: "https_required" });
          return;
        }
        if (requestPath === "/oidc/client.js") browserScript(response);
        else browserHtml(response, requestPath === "/oidc/start" ? "start" : "callback");
        return;
      }

      if (request.method === "OPTIONS" && requestPath.startsWith("/v1/")) {
        if (!exactOriginAllowed(request, response, allowedOrigins, true)) {
          json(response, 403, { error: "origin_denied" });
          return;
        }
        response.statusCode = 204;
        response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type,authorization");
        response.setHeader("access-control-max-age", "300");
        applySecurityHeaders(response);
        response.end();
        return;
      }

      if (request.method === "GET" && requestPath === "/v1/oidc/config") {
        if (!exactOriginAllowed(request, response, allowedOrigins, false)) {
          json(response, 403, { error: "origin_denied" });
          return;
        }
        const authorizationEndpoint = await upstream.authorizationEndpoint();
        json(response, 200, {
          providerKey: config.upstreamProviderKey,
          authorizationEndpoint,
          clientId: config.upstreamClientId,
          redirectUri: config.upstreamRedirectUri,
          pkceMethod: "S256",
          responseType: "code",
        });
        return;
      }

      if (request.method === "GET" && requestPath === "/v1/session/public-keyring") {
        if (!exactOriginAllowed(request, response, allowedOrigins, false)) {
          json(response, 403, { error: "origin_denied" });
          return;
        }
        json(response, 200, { issuer: config.issuer, audience: config.audience, keys: publicKeyring });
        return;
      }

      if (request.method === "POST" && requestPath === "/v1/session/exchange") {
        if (!exactOriginAllowed(request, response, allowedOrigins, true)) {
          json(response, 403, { error: "origin_denied" });
          return;
        }
        if (config.requireForwardedHttps && !forwardedHttps(request)) {
          json(response, 400, { error: "https_required" });
          return;
        }
        const body = await readJsonBody(request);
        const issued = await authority.establishSession(body);
        json(response, 200, {
          tokenType: issued.tokenType,
          accessToken: issued.accessToken,
          sessionId: issued.sessionId,
          issuedAtIso: issued.issuedAtIso,
          expiresAtIso: issued.expiresAtIso,
        });
        return;
      }

      if (request.method === "POST" && requestPath === "/v1/session/verify") {
        if (!exactOriginAllowed(request, response, allowedOrigins, true)) {
          json(response, 403, { error: "origin_denied" });
          return;
        }
        if (config.requireForwardedHttps && !forwardedHttps(request)) {
          json(response, 400, { error: "https_required" });
          return;
        }
        const verified = await sessionVerifier.verify({ authorization: header(request, "authorization") });
        if (!verified) {
          json(response, 401, { valid: false });
          return;
        }
        json(response, 200, { valid: true, sessionId: verified.sessionId, issuedAtIso: verified.issuedAtIso, expiresAtIso: verified.expiresAtIso });
        return;
      }

      json(response, 404, { error: "not_found" });
    } catch (error) {
      const classification = classifyError(error);
      process.stderr.write(`${JSON.stringify({ event: "airenos.session_authority.request_failed", errorCode: classification.code })}\n`);
      json(response, statusForError(classification.code), { error: classification.code });
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolveListen(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(deployment.port, deployment.host);
  });

  let stopping = false;
  const stop = async (signal = "manual") => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), deployment.shutdownTimeoutMs);
    timeout.unref();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await pool.end();
    clearTimeout(timeout);
    process.stdout.write(`${JSON.stringify({ event: "airenos.session_authority.service_stopped", signal })}\n`);
  };

  return Object.freeze({ server, pool, deployment, stop });
}
