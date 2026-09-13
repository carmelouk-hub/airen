import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { Ed25519AirenOSSessionVerifier } from "../../../packages/integrations/src/airenos-session-ed25519.ts";
import { InMemorySingleUseSessionHandoffStore } from "./session-authority-handoff.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;
type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

const HANDOFF_COOKIE = "__Host-airenos_handoff";

function cleanOptionalHttpsOrigin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.pathname !== "/" || url.search) {
    throw new Error("AIRENOS_SESSION_HANDOFF_ORIGIN must be a clean HTTPS origin");
  }
  return url.origin;
}

function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function hasHandoffCookie(request: IncomingMessage): boolean {
  const cookies = requestHeader(request, "cookie") ?? "";
  return cookies.split(";").some((entry) => entry.trim() === `${HANDOFF_COOKIE}=1`);
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
}

function browserSecurityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
}

function json(response: ServerResponse, statusCode: number, body: Readonly<Record<string, unknown>>): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  securityHeaders(response);
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = requestHeader(request, "content-type");
  if (!contentType?.toLowerCase().startsWith("application/json")) throw new Error("invalid_content_type");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 4096) throw new Error("body_too_large");
    chunks.push(data);
  }
  if (!chunks.length) throw new Error("missing_body");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function handoffCallbackHtml(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader("content-type", "text/html; charset=utf-8");
  browserSecurityHeaders(response);
  response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIRenOS application authentication</title></head><body><main><h1>AIRenOS application authentication</h1><p id="status">Completing AIRenOS application session…</p></main><script src="/app/oidc/client.js" defer></script></body></html>');
}

function handoffClientScript(response: ServerResponse, handoffOrigin: string): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/javascript; charset=utf-8");
  browserSecurityHeaders(response);
  response.end(`(() => {
  "use strict";
  const targetOrigin = ${JSON.stringify(handoffOrigin)};
  const status = document.getElementById("status");
  const keys = Object.freeze({ state: "airenos.oidc.state", verifier: "airenos.oidc.verifier", nonce: "airenos.oidc.nonce" });
  const setStatus = (value) => { if (status) status.textContent = value; };
  const clearTransient = () => { try { sessionStorage.removeItem(keys.state); sessionStorage.removeItem(keys.verifier); sessionStorage.removeItem(keys.nonce); } catch {} };
  const fail = (message) => { clearTransient(); history.replaceState(null, "", "/oidc/callback"); document.title = "AIRenOS authentication failed"; setStatus(message); };
  const callback = async () => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("error")) return fail("The identity provider rejected authentication.");
    const code = query.get("code");
    const returnedState = query.get("state");
    let expectedState = null, verifier = null, nonce = null;
    try { expectedState = sessionStorage.getItem(keys.state); verifier = sessionStorage.getItem(keys.verifier); nonce = sessionStorage.getItem(keys.nonce); } catch {}
    history.replaceState(null, "", "/oidc/callback");
    if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier || !nonce) return fail("OIDC callback state is invalid or expired.");
    clearTransient();
    const exchangeResponse = await fetch("/v1/session/exchange", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, cache: "no-store", credentials: "same-origin", body: JSON.stringify({ code, codeVerifier: verifier, expectedNonce: nonce }) });
    if (!exchangeResponse.ok) return fail("AIRenOS session exchange failed.");
    const issued = await exchangeResponse.json();
    if (issued.tokenType !== "Bearer" || typeof issued.accessToken !== "string" || !issued.accessToken || typeof issued.sessionId !== "string" || !issued.sessionId) return fail("AIRenOS session response is invalid.");
    const verifyResponse = await fetch("/v1/session/verify", { method: "POST", headers: { accept: "application/json", authorization: "Bearer " + issued.accessToken }, cache: "no-store", credentials: "same-origin" });
    if (!verifyResponse.ok) return fail("AIRenOS session verification failed.");
    const verification = await verifyResponse.json();
    if (verification.valid !== true || verification.sessionId !== issued.sessionId) return fail("AIRenOS session verification failed.");
    const handoffResponse = await fetch("/v1/session/handoff/issue", { method: "POST", headers: { accept: "application/json", authorization: "Bearer " + issued.accessToken }, cache: "no-store", credentials: "same-origin" });
    if (!handoffResponse.ok) return fail("AIRenOS application handoff failed.");
    const handoff = await handoffResponse.json();
    if (typeof handoff.handoff !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(handoff.handoff)) return fail("AIRenOS application handoff is invalid.");
    window.location.replace(targetOrigin + "/auth/callback?handoff=" + encodeURIComponent(handoff.handoff));
  };
  callback().catch(() => fail("AIRenOS application authentication failed."));
})();`);
}

export function installAirenOSSessionHandoffHttp(
  server: Server,
  environment: EnvironmentInput,
  publicKeyringText: string,
): Readonly<{ enabled: boolean; handoffOrigin: string | null }> {
  const handoffOrigin = cleanOptionalHttpsOrigin(environment.AIRENOS_SESSION_HANDOFF_ORIGIN);
  if (!handoffOrigin) return Object.freeze({ enabled: false, handoffOrigin: null });

  const issuer = environment.AIRENOS_SESSION_ISSUER?.trim();
  const audience = environment.AIRENOS_SESSION_AUDIENCE?.trim();
  if (!issuer || !audience) throw new Error("Session issuer and audience are required for handoff");
  const browserOrigin = new URL(issuer).origin;
  const verifier = new Ed25519AirenOSSessionVerifier({ issuer, audience, publicKeysJson: publicKeyringText });
  const store = new InMemorySingleUseSessionHandoffStore(90_000);
  const existing = server.listeners("request") as RequestHandler[];
  if (existing.length !== 1) throw new Error("Expected exactly one Session Authority request handler");
  const delegate = existing[0];
  server.removeAllListeners("request");

  server.on("request", (request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", issuer);
      const requestPath = requestUrl.pathname;

      if (request.method === "GET" && requestPath === "/app/oidc/start") {
        response.statusCode = 302;
        response.setHeader("location", "/oidc/start");
        response.setHeader("set-cookie", `${HANDOFF_COOKIE}=1; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Lax`);
        securityHeaders(response);
        response.end();
        return;
      }

      if (request.method === "GET" && requestPath === "/oidc/callback" && hasHandoffCookie(request)) {
        response.setHeader("set-cookie", `${HANDOFF_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
        handoffCallbackHtml(response);
        return;
      }

      if (request.method === "GET" && requestPath === "/app/oidc/client.js") {
        handoffClientScript(response, handoffOrigin);
        return;
      }

      if (request.method === "POST" && requestPath === "/v1/session/handoff/issue") {
        const origin = requestHeader(request, "origin");
        if (origin && origin !== browserOrigin) return json(response, 403, { error: "origin_denied" });
        const authorization = requestHeader(request, "authorization");
        const verified = await verifier.verify({ authorization });
        if (!verified || !authorization?.startsWith("Bearer ")) return json(response, 401, { error: "invalid_session" });
        const accessToken = authorization.slice("Bearer ".length);
        const issued = store.issue({ accessToken, sessionId: verified.sessionId, issuedAtIso: verified.issuedAtIso, expiresAtIso: verified.expiresAtIso });
        json(response, 200, { handoff: issued.handoff, expiresAtIso: issued.expiresAtIso });
        return;
      }

      if (request.method === "OPTIONS" && requestPath === "/v1/session/handoff/redeem") {
        const origin = requestHeader(request, "origin");
        if (origin !== handoffOrigin) return json(response, 403, { error: "origin_denied" });
        response.statusCode = 204;
        response.setHeader("access-control-allow-origin", handoffOrigin);
        response.setHeader("vary", "Origin");
        response.setHeader("access-control-allow-methods", "POST,OPTIONS");
        response.setHeader("access-control-allow-headers", "content-type");
        response.setHeader("access-control-max-age", "300");
        securityHeaders(response);
        response.end();
        return;
      }

      if (request.method === "POST" && requestPath === "/v1/session/handoff/redeem") {
        const origin = requestHeader(request, "origin");
        if (origin !== handoffOrigin) return json(response, 403, { error: "origin_denied" });
        response.setHeader("access-control-allow-origin", handoffOrigin);
        response.setHeader("vary", "Origin");
        let body: unknown;
        try { body = await readJsonBody(request); } catch { return json(response, 400, { error: "invalid_handoff_request" }); }
        const handoff = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).handoff : null;
        if (typeof handoff !== "string") return json(response, 400, { error: "invalid_handoff_request" });
        const payload = store.redeem(handoff);
        if (!payload) return json(response, 401, { error: "invalid_or_expired_handoff" });
        const verified = await verifier.verify({ authorization: `Bearer ${payload.accessToken}` });
        if (!verified || verified.sessionId !== payload.sessionId) return json(response, 401, { error: "invalid_session" });
        json(response, 200, { tokenType: "Bearer", accessToken: payload.accessToken, sessionId: payload.sessionId, issuedAtIso: payload.issuedAtIso, expiresAtIso: payload.expiresAtIso });
        return;
      }

      delegate(request, response);
    })().catch(() => {
      if (!response.headersSent) json(response, 500, { error: "handoff_bridge_failed" });
      else if (!response.writableEnded) response.end();
    });
  });

  return Object.freeze({ enabled: true, handoffOrigin });
}
