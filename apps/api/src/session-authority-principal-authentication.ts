import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import type { AuthenticatedPrincipal, AuthenticationAdapter } from "../../../packages/identity/src/index.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

type PrincipalResponse = Readonly<{
  identityId: string;
  platformRoles: readonly string[];
  sessionId: string;
  issuedAtIso: string;
  expiresAtIso: string;
}>;

function cleanHttpsBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session Authority base URL must be a clean HTTPS URL");
  }
  return url.toString().replace(/\/$/, "");
}

function bearerFromRequest(request: unknown): string | null {
  if (!request || typeof request !== "object") return null;
  const authorization = (request as { authorization?: unknown }).authorization;
  return typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization : null;
}

function validPrincipal(value: unknown): value is PrincipalResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.identityId === "string" && record.identityId.length > 0
    && Array.isArray(record.platformRoles) && record.platformRoles.every((role) => typeof role === "string" && role.length > 0)
    && typeof record.sessionId === "string" && record.sessionId.length > 0
    && typeof record.issuedAtIso === "string" && record.issuedAtIso.length > 0
    && typeof record.expiresAtIso === "string" && record.expiresAtIso.length > 0;
}

export class SessionAuthorityPrincipalAuthenticationAdapter implements AuthenticationAdapter {
  private readonly principalUrl: string;
  private readonly timeoutMs: number;

  constructor(environment: EnvironmentInput = process.env) {
    const base = environment.AIRENOS_SESSION_AUTHORITY_INTERNAL_BASE_URL?.trim();
    if (!base) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "AIRENOS_SESSION_AUTHORITY_INTERNAL_BASE_URL is required");
    this.principalUrl = `${cleanHttpsBaseUrl(base)}/v1/session/principal`;
    const timeout = Number(environment.AIRENOS_SESSION_AUTHORITY_TIMEOUT_MS ?? "3000");
    if (!Number.isInteger(timeout) || timeout < 250 || timeout > 10000) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "AIRENOS_SESSION_AUTHORITY_TIMEOUT_MS must be an integer between 250 and 10000");
    }
    this.timeoutMs = timeout;
  }

  async authenticate(request: unknown): Promise<AuthenticatedPrincipal | null> {
    const authorization = bearerFromRequest(request);
    if (!authorization) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.principalUrl, {
        method: "GET",
        headers: { accept: "application/json", authorization },
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new AppError("UPSTREAM_IDP_UNAVAILABLE", "Session Authority principal endpoint is unavailable");
      const payload: unknown = await response.json();
      if (!validPrincipal(payload)) throw new AppError("UPSTREAM_IDP_UNAVAILABLE", "Session Authority principal response is invalid");
      return {
        identityId: payload.identityId,
        providerKey: "airenos_session_authority",
        providerSubject: payload.identityId,
        platformRoles: Object.freeze([...payload.platformRoles]),
        sessionId: payload.sessionId,
        authenticatedAtIso: payload.issuedAtIso,
        expiresAtIso: payload.expiresAtIso,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("UPSTREAM_IDP_UNAVAILABLE", "Session Authority principal endpoint is unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}
