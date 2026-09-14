import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { handleTenantReadOnlyApi, TENANT_READONLY_API_PREFIX } from "./tenant-readonly-api.ts";
import { SessionAuthorityPrincipalAuthenticationAdapter } from "./session-authority-principal-authentication.ts";
import { PostgresPlatformRoleClaimPermissionResolver, PostgresTenantRoleClaimReadStore } from "../../../packages/persistence-postgres/src/tenant-role-claim-read.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

function required(environment: EnvironmentInput, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`Missing Tenant Control Plane runtime field: ${key}`);
  return value;
}

function positiveInteger(environment: EnvironmentInput, key: string, fallback: number): number {
  const raw = environment[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${key} must be a positive integer`);
  return value;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function secureJson(response: ServerResponse, statusCode: number, body: unknown, extraHeaders: Readonly<Record<string, string>> = {}): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  for (const [key, value] of Object.entries(extraHeaders)) response.setHeader(key, value);
  response.end(JSON.stringify(body));
}

export async function startTenantControlPlaneStagingServer(environment: EnvironmentInput = process.env) {
  const host = environment.HOST?.trim() || "0.0.0.0";
  const port = positiveInteger(environment, "PORT", 3000);
  const databaseUrl = required(environment, "CONTROL_PLANE_DATABASE_URL");
  const pool = new Pool({ connectionString: databaseUrl, max: 5, application_name: "airenos-tenant-control-plane-staging" });
  const authentication = new SessionAuthorityPrincipalAuthenticationAdapter(environment);
  const roles = new PostgresPlatformRoleClaimPermissionResolver(pool);
  const tenants = new PostgresTenantRoleClaimReadStore(pool);

  const readiness = async (): Promise<boolean> => {
    try {
      const result = await pool.query<{ permissions: boolean; list_tenants: boolean; get_tenant: boolean }>(`SELECT
        to_regprocedure('security.platform_permissions_for_roles(text[])') IS NOT NULL AS permissions,
        to_regprocedure('security.platform_list_tenants_for_roles(text[],text,uuid,integer)') IS NOT NULL AS list_tenants,
        to_regprocedure('security.platform_get_tenant_for_roles(text[],uuid)') IS NOT NULL AS get_tenant`);
      const row = result.rows[0];
      return Boolean(row?.permissions && row.list_tenants && row.get_tenant);
    } catch {
      return false;
    }
  };

  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "https://airenos.invalid");
      if (request.method === "GET" && requestUrl.pathname === "/health/live") {
        return secureJson(response, 200, { status: "LIVE", service: "airenos-tenant-control-plane-staging" });
      }
      if (request.method === "GET" && requestUrl.pathname === "/health/ready") {
        const ready = await readiness();
        return secureJson(response, ready ? 200 : 503, {
          status: ready ? "READY" : "NOT_READY",
          service: "airenos-tenant-control-plane-staging",
          checks: [{ name: "postgres.tenant_read_claim_bridge", critical: true, ok: ready }],
        });
      }
      if (requestUrl.pathname === TENANT_READONLY_API_PREFIX || requestUrl.pathname.startsWith(`${TENANT_READONLY_API_PREFIX}/`)) {
        const result = await handleTenantReadOnlyApi({
          method: request.method ?? "GET",
          url: request.url ?? requestUrl.pathname,
          headers: {
            authorization: header(request, "authorization"),
            "x-correlation-id": header(request, "x-correlation-id"),
          },
        }, { authentication, roles, tenants });
        return secureJson(response, result.status, result.body, result.headers);
      }
      return secureJson(response, 404, { error: "not_found" });
    })().catch(() => secureJson(response, 503, { error: "tenant_control_plane_unavailable" }));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  };

  return Object.freeze({ server, pool, stop });
}
