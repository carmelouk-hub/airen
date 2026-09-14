import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { Ed25519AirenOSSessionVerifier } from "../../../packages/integrations/src/airenos-session-ed25519.ts";
import { PostgresAirenOSIdentityDirectory } from "../../../packages/persistence-postgres/src/airenos-identity-directory.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;
type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(response: ServerResponse, statusCode: number, body: Readonly<Record<string, unknown>>): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.end(JSON.stringify(body));
}

export function installAirenOSSessionPrincipalHttp(
  server: Server,
  pool: Pool,
  environment: EnvironmentInput,
  publicKeyringText: string,
): void {
  const issuer = environment.AIRENOS_SESSION_ISSUER?.trim();
  const audience = environment.AIRENOS_SESSION_AUDIENCE?.trim();
  if (!issuer || !audience) throw new Error("Session issuer and audience are required for principal resolution");

  const verifier = new Ed25519AirenOSSessionVerifier({ issuer, audience, publicKeysJson: publicKeyringText });
  const identities = new PostgresAirenOSIdentityDirectory(pool);
  const existing = server.listeners("request") as RequestHandler[];
  if (existing.length !== 1) throw new Error("Expected exactly one Session Authority request handler");
  const delegate = existing[0];
  server.removeAllListeners("request");

  server.on("request", (request, response) => {
    void (async () => {
      const requestPath = (request.url ?? "").split("?", 1)[0];
      if (request.method === "GET" && requestPath === "/v1/session/principal") {
        // Internal/server-to-server contract only. Browser-originated requests fail closed.
        if (header(request, "origin")) return json(response, 403, { error: "origin_denied" });
        const verified = await verifier.verify({ authorization: header(request, "authorization") });
        if (!verified) return json(response, 401, { error: "invalid_session" });
        const identity = await identities.resolveIdentity(verified.identityId);
        if (!identity || identity.status !== "active") return json(response, 401, { error: "inactive_or_unknown_identity" });
        return json(response, 200, {
          identityId: identity.identityId,
          platformRoles: identity.platformRoles,
          sessionId: verified.sessionId,
          issuedAtIso: verified.issuedAtIso,
          expiresAtIso: verified.expiresAtIso,
        });
      }
      delegate(request, response);
    })().catch(() => {
      if (!response.headersSent) json(response, 503, { error: "principal_resolution_unavailable" });
      else if (!response.writableEnded) response.end();
    });
  });
}
