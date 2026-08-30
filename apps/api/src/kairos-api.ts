import { randomUUID } from "node:crypto";
import { AppError, type AppErrorCode } from "../../../packages/shared-contracts/src/index.ts";
import { requirePrincipal, type AuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import type { RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import { assertKairosNodeId, type KairosGraphQueryStore } from "../../../packages/kairos/src/graph.ts";
import { resolvePlatformSecurityContext } from "./platform-security-context.ts";

export const KAIROS_API_PREFIX = "/api/kairos/v1";

export type KairosApiRequest = Readonly<{
  method: string;
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
}>;

export type KairosApiResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
}>;

export type KairosApiDependencies = Readonly<{
  authentication: AuthenticationAdapter;
  roles: RolePermissionResolver;
  graph: KairosGraphQueryStore;
}>;

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function correlationId(value: string | undefined): string {
  const candidate = value?.trim();
  return candidate && CORRELATION_ID.test(candidate) ? candidate : randomUUID();
}

function response(status: number, body: Readonly<Record<string, unknown>>, correlation: string): KairosApiResponse {
  return Object.freeze({
    status,
    body: Object.freeze({ ...body }),
    headers: Object.freeze({ "cache-control": "no-store", "x-correlation-id": correlation }),
  });
}

function authorizationRequest(request: KairosApiRequest): Readonly<Record<string, unknown>> {
  return Object.freeze({ authorization: request.headers.authorization });
}

function integerParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new AppError("VALIDATION_FAILED", `${name} must be an integer`);
  return value;
}

function appErrorStatus(code: AppErrorCode): number {
  switch (code) {
    case "AUTHENTICATION_REQUIRED": return 401;
    case "PERMISSION_DENIED":
    case "MEMBERSHIP_REQUIRED":
    case "LOCATION_MEMBERSHIP_REQUIRED":
    case "ENTITLEMENT_REQUIRED":
    case "TENANT_SCOPE_VIOLATION":
    case "LOCATION_SCOPE_VIOLATION": return 403;
    case "NOT_FOUND": return 404;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT": return 409;
    case "TENANT_RESOLUTION_FAILED":
    case "VALIDATION_FAILED": return 400;
    default: return 500;
  }
}

function mapError(error: unknown, correlation: string): KairosApiResponse {
  if (error instanceof AppError) {
    const status = appErrorStatus(error.code);
    return response(status, {
      error: error.code,
      message: status >= 500 ? "Kairos request failed" : error.message,
      correlationId: correlation,
    }, correlation);
  }
  return response(500, { error: "INTERNAL_ERROR", message: "Kairos request failed", correlationId: correlation }, correlation);
}

export function isKairosApiRequest(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const pathname = new URL(url,"http://airenos.local").pathname;
    return pathname === KAIROS_API_PREFIX || pathname.startsWith(`${KAIROS_API_PREFIX}/`);
  } catch { return false; }
}

export async function dispatchKairosApiRequest(request: KairosApiRequest, deps: KairosApiDependencies): Promise<KairosApiResponse> {
  const correlation = correlationId(request.headers["x-correlation-id"]);
  try {
    if (request.method.toUpperCase() !== "GET") throw new AppError("NOT_FOUND", "Kairos route not found");
    const principal = requirePrincipal(await deps.authentication.authenticate(authorizationRequest(request)));
    const { context } = await resolvePlatformSecurityContext({ principal, roles: deps.roles, correlationId: correlation });
    const url = new URL(request.url,"http://airenos.local");
    const suffix = url.pathname.slice(KAIROS_API_PREFIX.length).replace(/^\/+|\/+$/g,"");
    const segments = suffix ? suffix.split("/") : [];

    if (segments.length === 1 && segments[0] === "graph") {
      const graph = await deps.graph.readSubgraph({
        rootCoordinate: url.searchParams.get("root") ?? undefined,
        nodeLimit: integerParam(url,"nodeLimit"),
        edgeLimit: integerParam(url,"edgeLimit"),
      }, context);
      return response(200,{ graph },correlation);
    }

    if (segments.length === 1 && segments[0] === "search") {
      const query = url.searchParams.get("q") ?? "";
      const items = await deps.graph.searchLexical(query,integerParam(url,"limit"),context);
      return response(200,{ items },correlation);
    }

    if (segments.length >= 2 && segments[0] === "nodes") {
      const nodeId = assertKairosNodeId(segments[1]);
      if (segments.length === 2) {
        const node = await deps.graph.readNodeDetail(nodeId,context);
        if (!node) throw new AppError("NOT_FOUND","Kairos node not found");
        return response(200,{ node },correlation);
      }
      if (segments.length === 3 && segments[2] === "timeline") {
        const items = await deps.graph.readTimeline(nodeId,integerParam(url,"limit"),context);
        return response(200,{ items },correlation);
      }
    }

    throw new AppError("NOT_FOUND","Kairos route not found");
  } catch (error) {
    return mapError(error,correlation);
  }
}
