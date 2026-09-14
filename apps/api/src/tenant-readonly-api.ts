import { randomUUID } from "node:crypto";
import { AppError, type AppErrorCode } from "../../../packages/shared-contracts/src/index.ts";
import { requirePrincipal, type AuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import type { RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import { getTenantAdmin, listTenantsAdmin, type TenantAdminQueryStore, type TenantStatus } from "../../../packages/tenant/src/commands/manage-tenant.ts";
import { resolvePlatformSecurityContext } from "./platform-security-context.ts";

export const TENANT_READONLY_API_PREFIX = "/v1/tenants";

export type TenantReadOnlyApiRequest = Readonly<{
  method: string;
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
}>;

export type TenantReadOnlyApiResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
}>;

export type TenantReadOnlyApiDependencies = Readonly<{
  authentication: AuthenticationAdapter;
  roles: RolePermissionResolver;
  tenants: TenantAdminQueryStore;
}>;

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function correlationId(value: string | undefined): string {
  const candidate = value?.trim();
  return candidate && CORRELATION_ID.test(candidate) ? candidate : randomUUID();
}

function response(status: number, body: Readonly<Record<string, unknown>>, correlation: string): TenantReadOnlyApiResponse {
  return {
    status,
    body,
    headers: Object.freeze({
      "cache-control": "no-store",
      "x-correlation-id": correlation
    })
  };
}

function appErrorStatus(code: AppErrorCode): number {
  switch (code) {
    case "AUTHENTICATION_REQUIRED": return 401;
    case "PERMISSION_DENIED": return 403;
    case "VALIDATION_FAILED": return 400;
    case "NOT_FOUND": return 404;
    default: return 500;
  }
}

function queryNumber(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new AppError("VALIDATION_FAILED", `${name} must be an integer`);
  return value;
}

function queryString(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === "" ? undefined : value;
}

export async function handleTenantReadOnlyApi(
  request: TenantReadOnlyApiRequest,
  deps: TenantReadOnlyApiDependencies
): Promise<TenantReadOnlyApiResponse> {
  const correlation = correlationId(request.headers["x-correlation-id"]);

  if (request.method.toUpperCase() !== "GET") {
    return response(405, { error: "METHOD_NOT_ALLOWED", message: "Tenant read-only API accepts GET only", correlationId: correlation }, correlation);
  }

  try {
    const url = new URL(request.url, "https://airenos.invalid");
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "v1" || segments[1] !== "tenants" || segments.length > 3) {
      throw new AppError("NOT_FOUND", "Tenant read-only route not found");
    }

    const principal = requirePrincipal(await deps.authentication.authenticate({ authorization: request.headers.authorization }));
    const { context } = await resolvePlatformSecurityContext({ principal, roles: deps.roles, correlationId: correlation });

    if (segments.length === 2) {
      const items = await listTenantsAdmin({
        status: queryString(url, "status") as TenantStatus | undefined,
        afterId: queryString(url, "afterId"),
        limit: queryNumber(url, "limit")
      }, { context, queries: deps.tenants });
      return response(200, { items, correlationId: correlation }, correlation);
    }

    const tenant = await getTenantAdmin(segments[2], { context, queries: deps.tenants });
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found");
    return response(200, { tenant, correlationId: correlation }, correlation);
  } catch (error) {
    if (error instanceof AppError) {
      const status = appErrorStatus(error.code);
      return response(status, {
        error: error.code,
        message: status >= 500 ? "Tenant read-only request failed" : error.message,
        correlationId: correlation
      }, correlation);
    }
    return response(500, { error: "INTERNAL_ERROR", message: "Tenant read-only request failed", correlationId: correlation }, correlation);
  }
}
