import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import { AirenOSIdentitySessionAuthority } from "../../../packages/identity/src/session-authority.ts";
import { PersistentAirenOSSessionIssuer } from "../../../packages/identity/src/session-lifecycle.ts";
import { Ed25519AirenOSSessionIssuer } from "../../../packages/integrations/src/airenos-session-ed25519.ts";
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

function json(response: ServerResponse, statusCode: number, body: Readonly<Record<string, unknown>>): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  applySecurityHeaders(response);
  response.end(JSON.stringify(body));
}

function exactOriginAllowed(request: IncomingMessage, response: ServerResponse, allowedOrigin: string, requiredForRequest: boolean): boolean {
  const origin = header(request, "origin");
  if (!origin) return !requiredForRequest;
  if (origin !== allowedOrigin) return false;
  response.setHeader("access-control-allow-origin", allowedOrigin);
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

export async function startAirenOSSessionAuthorityStagingServer(
  environment: EnvironmentInput = process.env,
  secrets: SessionAuthorityRuntimeSecrets,
) {
  const deployment = parseDeploymentRuntimeOptions(environment);
  const config = loadConfig(environment);
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
  const authority = new AirenOSIdentitySessionAuthority(
    upstream,
    identities,
    new PersistentAirenOSSessionIssuer(cryptoIssuer, lifecycle),
  );

  const publicKeyring = JSON.parse(secrets.publicKeyringText) as Readonly<Record<string, unknown>>;

  const readiness = async () => {
    const database = await pool.query<{
      session_role: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      auth_member: boolean;
      identity_table: boolean;
      session_table: boolean;
      resolve_auth_function: boolean;
    }>(`SELECT
      session_user AS session_role,
      r.rolsuper,
      r.rolbypassrls,
      pg_has_role(session_user,'airen_auth','MEMBER') AS auth_member,
      to_regclass('identity.identities') IS NOT NULL AS identity_table,
      to_regclass('identity.airenos_sessions') IS NOT NULL AS session_table,
      to_regprocedure('security.resolve_authentication_identity(text,text)') IS NOT NULL AS resolve_auth_function
    FROM pg_roles r WHERE r.rolname=session_user`);
    const role = database.rows[0];
    const databaseOk = Boolean(role && !role.rolsuper && !role.rolbypassrls && role.auth_member && role.identity_table && role.session_table && role.resolve_auth_function);

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
      if (request.method === "GET" && request.url === "/health/live") {
        json(response, 200, { status: "LIVE", service: "airenos-session-authority-f23-staging", releaseRevision: deployment.releaseRevision });
        return;
      }

      if (request.method === "GET" && request.url === "/health/ready") {
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

      if (request.method === "OPTIONS" && request.url?.startsWith("/v1/")) {
        if (!exactOriginAllowed(request, response, config.allowedOrigin, true)) {
          json(response, 403, { error: "origin_denied" });
          return;
        }
        response.statusCode = 204;
        response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type");
        response.setHeader("access-control-max-age", "300");
        applySecurityHeaders(response);
        response.end();
        return;
      }

      if (request.method === "GET" && request.url === "/v1/oidc/config") {
        if (!exactOriginAllowed(request, response, config.allowedOrigin, false)) {
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

      if (request.method === "GET" && request.url === "/v1/session/public-keyring") {
        if (!exactOriginAllowed(request, response, config.allowedOrigin, false)) {
          json(response, 403, { error: "origin_denied" });
          return;
        }
        json(response, 200, { issuer: config.issuer, audience: config.audience, keys: publicKeyring });
        return;
      }

      if (request.method === "POST" && request.url === "/v1/session/exchange") {
        if (!exactOriginAllowed(request, response, config.allowedOrigin, true)) {
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
