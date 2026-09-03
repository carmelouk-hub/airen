import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import { loadFoundationRuntimeEnvironment, parseSecretRef } from "../../../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider, type SecretProvider } from "../../../packages/integrations/src/index.ts";
import { ProviderNeutralAuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import { classifyError, formatTraceparent, type LogSink, type MetricPoint, type MetricSink, type StructuredLogRecord } from "../../../packages/observability/src/index.ts";
import {
  PostgresAuthenticationIdentityDirectory, PostgresFoundationReadStore,
  PostgresLocationRepositoryAdapter, PostgresTenantRepositoryAdapter
} from "../../../packages/persistence-postgres/src/index.ts";
import { PostgresTenantProvisioningUnitOfWork } from "../../../packages/persistence-postgres/src/tenant-provisioning.ts";
import { PostgresTenantControlPlaneStore } from "../../../packages/persistence-postgres/src/tenant-control-plane.ts";
import { PostgresLocationControlPlaneStore } from "../../../packages/persistence-postgres/src/location-control-plane.ts";
import { PostgresTenantDomainControlPlaneStore } from "../../../packages/persistence-postgres/src/tenant-domain-control-plane.ts";
import { PostgresPlatformRoleAdminStore } from "../../../packages/persistence-postgres/src/platform-role-control-plane.ts";
import { PostgresBillingControlPlaneStore } from "../../../packages/persistence-postgres/src/billing-control-plane.ts";
import { PostgresEntitlementControlPlaneStore } from "../../../packages/persistence-postgres/src/entitlement-control-plane.ts";
import { PostgresCapabilityControlPlaneStore } from "../../../packages/persistence-postgres/src/capability-control-plane.ts";
import { PostgresPlatformAuditQueryStore } from "../../../packages/persistence-postgres/src/audit-query-control-plane.ts";
import { PostgresOrganizationContextRepository } from "../../../packages/persistence-postgres/src/organization-control-plane.ts";
import { PostgresProductAccessStore } from "../../../packages/persistence-postgres/src/product-access.ts";
import { bootstrapFoundationRuntime } from "./runtime-bootstrap.ts";
import { parseDeploymentRuntimeOptions } from "./deployment-config.ts";
import { dispatchAdminApiRequest, isAdminApiRequest, type AdminApiDependencies } from "./admin-api.ts";
import { isRistoBookingApiRequest } from "./ristoairen-booking-api.ts";
import { createRistoBookingRuntime } from "./ristoairen-booking-runtime.ts";
import {
  dispatchRistoairenProductAttachmentApiRequest,
  isRistoairenProductAttachmentApiRequest,
  type RistoairenProductAttachmentApiDependencies,
} from "./ristoairen-product-attachment-api.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

class StdoutJsonLogSink implements LogSink {
  emit(record: StructuredLogRecord): void { process.stdout.write(`${JSON.stringify({ type: "log", ...record })}\n`); }
}

class StdoutJsonMetricSink implements MetricSink {
  record(point: MetricPoint): void { process.stdout.write(`${JSON.stringify({ type: "metric", ...point })}\n`); }
}

function referenceSecretProvider(environment: EnvironmentInput): SecretProvider {
  const config = loadFoundationRuntimeEnvironment(environment);
  if (config.secretManagerAdapter === "env") {
    const allowedKeys = [config.databaseUrlRef.key, config.authSessionKeyRef.key];
    const canonicalBookingCursorRefRaw = environment.AIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF?.trim();
    const compatibilityBookingCursorRefRaw = environment.RISTOAIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF?.trim();
    if (canonicalBookingCursorRefRaw && compatibilityBookingCursorRefRaw && canonicalBookingCursorRefRaw !== compatibilityBookingCursorRefRaw) {
      throw new AppError(
        "RUNTIME_CONFIGURATION_INVALID",
        "AIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF conflicts with compatibility alias RISTOAIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF",
        { field: "AIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF" }
      );
    }
    const bookingCursorRefRaw = canonicalBookingCursorRefRaw ?? compatibilityBookingCursorRefRaw;
    const bookingCursorRefField = canonicalBookingCursorRefRaw
      ? "AIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF"
      : "RISTOAIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF";
    if (bookingCursorRefRaw) {
      const bookingCursorRef = parseSecretRef(bookingCursorRefRaw, bookingCursorRefField);
      if (bookingCursorRef.provider !== config.secretManagerAdapter) {
        throw new AppError(
          "RUNTIME_CONFIGURATION_INVALID",
          `${bookingCursorRefField} provider must match SECRET_MANAGER_ADAPTER`,
          { field: bookingCursorRefField }
        );
      }
      allowedKeys.push(bookingCursorRef.key);
    }
    return new EnvironmentSecretProvider(environment, allowedKeys);
  }
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", "No runtime SecretProvider adapter is registered for the configured provider", { provider: config.secretManagerAdapter });
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(response: ServerResponse, statusCode: number, body: Readonly<Record<string, unknown>>, headers?: Readonly<Record<string, string>>): void {
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  for (const [name, value] of Object.entries(headers ?? {})) response.setHeader(name, value);
  response.end(payload);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const contentType = header(request, "content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_FAILED", "Admin mutation content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 64 * 1024) throw new AppError("VALIDATION_FAILED", "Admin request body exceeds 64 KiB");
    chunks.push(data);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("VALIDATION_FAILED", "Admin request body is not valid JSON");
  }
}

async function readBookingJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const contentType = header(request, "content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_FAILED", "Booking mutation content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 64 * 1024) throw new AppError("VALIDATION_FAILED", "Booking request body exceeds 64 KiB");
    chunks.push(data);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("VALIDATION_FAILED", "Booking request body is not valid JSON");
  }
}

function adminHeaders(request: IncomingMessage): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    authorization: header(request, "authorization"),
    "x-correlation-id": header(request, "x-correlation-id"),
    "idempotency-key": header(request, "idempotency-key"),
    origin: header(request, "origin"),
    cookie: header(request, "cookie")
  });
}

function bookingHeaders(request: IncomingMessage, correlationId: string): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    authorization: header(request, "authorization"),
    "x-airen-service-assertion": header(request, "x-airen-service-assertion"),
    "x-airen-correlation-id": correlationId,
    "x-airen-deadline-ms": header(request, "x-airen-deadline-ms"),
    "idempotency-key": header(request, "idempotency-key")
  });
}

function requestHostname(request: IncomingMessage): string {
  const host = header(request, "host")?.trim();
  if (!host) throw new AppError("VALIDATION_FAILED", "Host header is required for RISTOAIREN Booking routing");
  try { return new URL(`http://${host}`).hostname.toLowerCase(); }
  catch { throw new AppError("VALIDATION_FAILED", "Host header is invalid for RISTOAIREN Booking routing"); }
}

const ADMIN_ASSETS: Readonly<Record<string, Readonly<{ file: string; contentType: string }>>> = Object.freeze({
  "/admin": { file: "../../admin/index.html", contentType: "text/html; charset=utf-8" },
  "/admin/": { file: "../../admin/index.html", contentType: "text/html; charset=utf-8" },
  "/admin/index.html": { file: "../../admin/index.html", contentType: "text/html; charset=utf-8" },
  "/admin/admin.js": { file: "../../admin/admin.js", contentType: "text/javascript; charset=utf-8" },
  "/admin/styles.css": { file: "../../admin/styles.css", contentType: "text/css; charset=utf-8" }
});

async function serveAdminAsset(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.method !== "GET" || !request.url) return false;
  let pathname: string;
  try { pathname = new URL(request.url, "http://airenos.local").pathname; } catch { return false; }
  const asset = ADMIN_ASSETS[pathname];
  if (!asset) return false;
  const bytes = await readFile(new URL(asset.file, import.meta.url));
  response.statusCode = 200;
  response.setHeader("content-type", asset.contentType);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.end(bytes);
  return true;
}

export async function startFoundationHttpServer(environment: EnvironmentInput = process.env) {
  const deployment = parseDeploymentRuntimeOptions(environment);
  const secretProvider = referenceSecretProvider(environment);
  const runtime = await bootstrapFoundationRuntime(environment, secretProvider, {
    logSink: new StdoutJsonLogSink(),
    metricSink: new StdoutJsonMetricSink()
  });
  const pool = runtime.withDatabaseConnectionString((connectionString) => new Pool({ connectionString, max: 5, application_name: "airenos-api", options: "-c role=airen_app" }));

  const foundationReads = new PostgresFoundationReadStore(pool);
  const authentication = new ProviderNeutralAuthenticationAdapter(
    runtime.createReferenceSignedSessionVerifier(),
    new PostgresAuthenticationIdentityDirectory(pool)
  );
  const tenantRepository = new PostgresTenantRepositoryAdapter(foundationReads);
  const locationRepository = new PostgresLocationRepositoryAdapter(foundationReads);
  const entitlementStore = new PostgresEntitlementControlPlaneStore(pool);
  const bookingRuntime = await createRistoBookingRuntime({
    environment,
    pool,
    authentication,
    foundationReads,
    tenantRepository,
    locationRepository,
    secretProvider,
    appBaseDomain: runtime.config.appBaseDomain
  });

  const ristoairenAttachmentDeps: RistoairenProductAttachmentApiDependencies = Object.freeze({
    authentication,
    roles: foundationReads,
    appBaseDomain: runtime.config.appBaseDomain,
    tenantContext: Object.freeze({
      tenants: tenantRepository,
      locations: locationRepository,
      domains: foundationReads,
      memberships: foundationReads,
      entitlements: foundationReads,
    }),
    organizations: new PostgresOrganizationContextRepository(pool),
    productSubscriptions: new PostgresProductAccessStore(pool),
    effectiveEntitlements: entitlementStore,
    trustedRequestScopes: foundationReads,
  });

  const adminDeps: AdminApiDependencies = Object.freeze({
    authentication,
    roles: foundationReads,
    appBaseDomain: runtime.config.appBaseDomain,
    tenantProvisioning: new PostgresTenantProvisioningUnitOfWork(pool),
    tenants: new PostgresTenantControlPlaneStore(pool),
    locations: new PostgresLocationControlPlaneStore(pool),
    domains: new PostgresTenantDomainControlPlaneStore(pool),
    platformRoles: new PostgresPlatformRoleAdminStore(pool),
    billing: new PostgresBillingControlPlaneStore(pool),
    entitlements: entitlementStore,
    capabilities: new PostgresCapabilityControlPlaneStore(pool),
    audit: new PostgresPlatformAuditQueryStore(pool),
    tenantContext: Object.freeze({
      tenants: tenantRepository,
      locations: locationRepository,
      domains: foundationReads,
      memberships: foundationReads,
      entitlements: foundationReads
    })
  });

  const databaseReadiness = {
    name: "postgres.runtime",
    critical: true,
    run: async () => {
      const runtimeRole = await pool.query<{
        session_role: string;
        active_role: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        app_member: boolean;
        auth_member: boolean;
        control_plane_member: boolean;
        owner_member: boolean;
      }>(`SELECT
          session_user AS session_role,
          current_user AS active_role,
          r.rolsuper,
          r.rolbypassrls,
          pg_has_role(session_user,'airen_app','MEMBER') AS app_member,
          pg_has_role(session_user,'airen_auth','MEMBER') AS auth_member,
          pg_has_role(session_user,'airen_control_plane','MEMBER') AS control_plane_member,
          pg_has_role(session_user,'airen_control_plane_owner','MEMBER') AS owner_member
        FROM pg_roles r
        WHERE r.rolname=session_user`);
      const role = runtimeRole.rows[0];
      if (!role) return { ok: false, code: "runtime_session_role_missing" };
      if (role.rolsuper || role.rolbypassrls || role.owner_member) return { ok: false, code: "privileged_runtime_role" };
      if (!role.app_member || !role.auth_member || !role.control_plane_member) return { ok: false, code: "runtime_role_membership_missing" };
      if (role.active_role !== "airen_app") return { ok: false, code: "runtime_application_role_not_active" };
      return { ok: true, code: "ok" };
    }
  } as const;

  const server = createServer(async (request, response) => {
    const started = Date.now();
    const context = runtime.observability.createContext({
      "x-correlation-id": header(request, "x-correlation-id"),
      traceparent: header(request, "traceparent")
    });
    response.setHeader("x-correlation-id", context.correlationId);
    response.setHeader("traceparent", formatTraceparent(context));

    try {
      if (request.method === "GET" && request.url === "/health/live") {
        json(response, 200, { status: "LIVE", service: "airenos-api", releaseRevision: deployment.releaseRevision });
        await runtime.observability.metrics.request("health.live", "success", Date.now() - started);
        return;
      }

      if (request.method === "GET" && request.url === "/health/ready") {
        const readiness = await runtime.observability.readiness([databaseReadiness]);
        const statusCode = readiness.status === "READY" ? 200 : 503;
        json(response, statusCode, { ...readiness, service: "airenos-api", releaseRevision: deployment.releaseRevision });
        const outcome = readiness.status === "READY" ? "success" : "degraded";
        await runtime.observability.metrics.request("health.ready", outcome, Date.now() - started);
        await runtime.observability.logger.emit(readiness.status === "READY" ? "info" : "warn", "http.health_ready", context, { operation: "health.ready", outcome, durationMs: Date.now() - started, attributes: { readiness: readiness.status } });
        return;
      }

      if (isRistoairenProductAttachmentApiRequest(request.url)) {
        const result = await dispatchRistoairenProductAttachmentApiRequest({
          method: request.method ?? "GET",
          url: request.url ?? "",
          headers: Object.freeze({
            authorization: header(request, "authorization"),
            host: header(request, "host"),
            "x-correlation-id": context.correlationId,
          }),
        }, ristoairenAttachmentDeps);
        json(response, result.status, result.body, result.headers);
        const outcome = result.status < 400 ? "success" : result.status >= 500 ? "failed" : "denied";
        await runtime.observability.metrics.request("ristoairen.product_attachment.api", outcome, Date.now() - started);
        await runtime.observability.logger.emit(result.status >= 500 ? "error" : result.status >= 400 ? "warn" : "info", "http.ristoairen_product_attachment_api", context, {
          operation: "ristoairen.product_attachment.api",
          outcome,
          durationMs: Date.now() - started,
          attributes: { method: request.method, statusCode: result.status }
        });
        return;
      }

      if (isRistoBookingApiRequest(request.url)) {
        let result;
        if (!bookingRuntime.enabled) {
          result = await bookingRuntime.dispatch({ method: request.method ?? "GET", url: request.url ?? "", hostname: "", headers: {} });
        } else {
          let body: unknown;
          try {
            body = await readBookingJsonBody(request);
          } catch (error) {
            const classification = classifyError(error);
            json(response, classification.code === "VALIDATION_FAILED" ? 422 : 500, {
              error: classification.code,
              correlation_id: context.correlationId
            });
            return;
          }
          result = await bookingRuntime.dispatch({
            method: request.method ?? "GET",
            url: request.url ?? "",
            hostname: requestHostname(request),
            headers: bookingHeaders(request, context.correlationId),
            body
          });
        }
        json(response, result.status, result.body, result.headers);
        const outcome = result.status < 400 ? "success" : result.status >= 500 ? "failed" : "denied";
        await runtime.observability.metrics.request("ristoairen.booking.api", outcome, Date.now() - started);
        await runtime.observability.logger.emit(result.status >= 500 ? "error" : result.status >= 400 ? "warn" : "info", "http.ristoairen_booking_api", context, {
          operation: "ristoairen.booking.api",
          outcome,
          durationMs: Date.now() - started,
          attributes: { method: request.method, statusCode: result.status }
        });
        return;
      }

      if (isAdminApiRequest(request.url)) {
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch (error) {
          const classification = classifyError(error);
          json(response, classification.code === "VALIDATION_FAILED" ? 400 : 500, {
            error: classification.code,
            message: classification.code === "VALIDATION_FAILED" ? "Invalid administrative request body" : "Administrative request failed",
            correlationId: context.correlationId
          });
          return;
        }
        const result = await dispatchAdminApiRequest({
          method: request.method ?? "GET",
          url: request.url ?? "",
          headers: { ...adminHeaders(request), "x-correlation-id": context.correlationId },
          body
        }, adminDeps);
        json(response, result.status, result.body, result.headers);
        const outcome = result.status < 400 ? "success" : result.status >= 500 ? "failed" : "denied";
        await runtime.observability.metrics.request("admin.api", outcome, Date.now() - started);
        await runtime.observability.logger.emit(result.status >= 500 ? "error" : result.status >= 400 ? "warn" : "info", "http.admin_api", context, {
          operation: "admin.api",
          outcome,
          durationMs: Date.now() - started,
          attributes: { method: request.method, statusCode: result.status }
        });
        return;
      }

      if (await serveAdminAsset(request, response)) {
        await runtime.observability.metrics.request("admin.ui", "success", Date.now() - started);
        return;
      }

      json(response, 404, { error: "not_found" });
      await runtime.observability.metrics.request("http.not_found", "denied", Date.now() - started);
    } catch (error) {
      const classification = classifyError(error);
      await runtime.observability.logger.error("http.request_failed", context, error, { operation: "http.request" });
      await runtime.observability.metrics.error("http.request", error);
      json(response, 500, { error: classification.code });
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolveListen(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(deployment.port, deployment.host);
  });

  const startupContext = runtime.observability.createContext();
  await runtime.observability.logger.emit("info", "service.started", startupContext, {
    operation: "service.start",
    outcome: "success",
    attributes: { release_revision: deployment.releaseRevision, port: deployment.port }
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
    await runtime.observability.logger.emit("info", "service.stopped", runtime.observability.createContext(), { operation: "service.stop", outcome: "success", attributes: { signal } });
  };

  return Object.freeze({ server, pool, runtime, deployment, stop });
}

async function main(): Promise<void> {
  const service = await startFoundationHttpServer(process.env);
  const shutdown = (signal: string) => { void service.stop(signal).then(() => { process.exitCode = 0; }); };
  process.once("SIGTERM", () => shutdown("sigterm"));
  process.once("SIGINT", () => shutdown("sigint"));
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  main().catch((error: unknown) => {
    const classification = classifyError(error);
    process.stderr.write(`${JSON.stringify({ event: "service.start_failed", errorCode: classification.code })}\n`);
    process.exitCode = 1;
  });
}
