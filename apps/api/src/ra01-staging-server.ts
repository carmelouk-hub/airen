import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import { loadFoundationRuntimeEnvironment } from "../../../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider, type SecretProvider } from "../../../packages/integrations/src/index.ts";
import { Ed25519AirenOSSessionVerifier } from "../../../packages/integrations/src/airenos-session-ed25519.ts";
import { AirenOSSessionAuthenticationAdapter } from "../../../packages/identity/src/session-authority.ts";
import type { AuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import { RevocationAwareAirenOSSessionVerifier } from "../../../packages/identity/src/session-lifecycle.ts";
import {
  PostgresFoundationReadStore,
  PostgresLocationRepositoryAdapter,
  PostgresTenantRepositoryAdapter,
} from "../../../packages/persistence-postgres/src/index.ts";
import { PostgresAirenOSSessionLifecycleStore } from "../../../packages/persistence-postgres/src/airenos-session-lifecycle.ts";
import { PostgresOrganizationContextRepository } from "../../../packages/persistence-postgres/src/organization-control-plane.ts";
import { PostgresProductAccessStore } from "../../../packages/persistence-postgres/src/product-access.ts";
import { PostgresEntitlementControlPlaneStore } from "../../../packages/persistence-postgres/src/entitlement-control-plane.ts";
import { PostgresRistoairenExperienceHandoffStore } from "../../../packages/persistence-postgres/src/ristoairen-experience-handoff.ts";
import { bootstrapFoundationRuntime } from "./runtime-bootstrap.ts";
import { parseDeploymentRuntimeOptions } from "./deployment-config.ts";
import {
  dispatchRistoairenProductAttachmentApiRequest,
  isRistoairenProductAttachmentApiRequest,
  type RistoairenProductAttachmentApiDependencies,
} from "./ristoairen-product-attachment-api.ts";
import { classifyError, formatTraceparent, type LogSink, type MetricPoint, type MetricSink, type StructuredLogRecord } from "../../../packages/observability/src/index.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

class StdoutJsonLogSink implements LogSink {
  emit(record: StructuredLogRecord): void { process.stdout.write(`${JSON.stringify({ type: "log", ...record })}\n`); }
}

class StdoutJsonMetricSink implements MetricSink {
  record(point: MetricPoint): void { process.stdout.write(`${JSON.stringify({ type: "metric", ...point })}\n`); }
}

function required(environment: EnvironmentInput, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required RA-01 staging environment field: ${key}`, { field: key });
  return value;
}

function referenceSecretProvider(environment: EnvironmentInput): SecretProvider {
  const config = loadFoundationRuntimeEnvironment(environment);
  if (config.secretManagerAdapter !== "env") {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RA-01 staging currently requires the env SecretProvider adapter", { provider: config.secretManagerAdapter });
  }
  return new EnvironmentSecretProvider(environment, [config.databaseUrlRef.key, config.authSessionKeyRef.key]);
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(response: ServerResponse, statusCode: number, body: Readonly<Record<string, unknown>>, headers?: Readonly<Record<string, string>>): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  for (const [name, value] of Object.entries(headers ?? {})) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

async function readAttachmentJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const contentType = header(request, "content-type");
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_FAILED", "RISTOAIREN attachment content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 16 * 1024) throw new AppError("VALIDATION_FAILED", "RISTOAIREN attachment request body exceeds 16 KiB");
    chunks.push(data);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError("VALIDATION_FAILED", "RISTOAIREN attachment request body is not valid JSON"); }
}

export function createRa01AirenOSAuthentication(
  pool: Pool,
  environment: EnvironmentInput,
  audience: string,
): AuthenticationAdapter {
  if (environment.AUTH_ADAPTER?.trim() !== "airenos-session-ed25519") {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RA-01 staging requires canonical AIRenOS Session Authority authentication", { field: "AUTH_ADAPTER" });
  }

  const issuer = required(environment, "AIRENOS_SESSION_ISSUER");
  const publicKeysJson = required(environment, "AUTH_SESSION_PUBLIC_KEYS_JSON");
  const sessions = new PostgresAirenOSSessionLifecycleStore(pool);

  let cryptoVerifier: Ed25519AirenOSSessionVerifier;
  try {
    cryptoVerifier = new Ed25519AirenOSSessionVerifier({
      issuer,
      audience,
      publicKeysJson,
    });
  } catch {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RA-01 AIRenOS session issuer/keyring configuration is invalid", { field: "AUTH_SESSION_PUBLIC_KEYS_JSON" });
  }

  return new AirenOSSessionAuthenticationAdapter(
    new RevocationAwareAirenOSSessionVerifier(cryptoVerifier, sessions),
    sessions,
  );
}

export async function startRa01FoundationHttpServer(environment: EnvironmentInput = process.env) {
  const deployment = parseDeploymentRuntimeOptions(environment);
  const secretProvider = referenceSecretProvider(environment);
  const runtime = await bootstrapFoundationRuntime(environment, secretProvider, {
    logSink: new StdoutJsonLogSink(),
    metricSink: new StdoutJsonMetricSink(),
  });
  const pool = runtime.withDatabaseConnectionString((connectionString) => new Pool({
    connectionString,
    max: 5,
    application_name: "airenos-ra01-foundation-staging",
    options: "-c role=airen_app",
  }));

  const foundationReads = new PostgresFoundationReadStore(pool);
  const authentication = createRa01AirenOSAuthentication(pool, environment, runtime.config.authAudience);
  const tenantRepository = new PostgresTenantRepositoryAdapter(foundationReads);
  const locationRepository = new PostgresLocationRepositoryAdapter(foundationReads);
  const entitlementStore = new PostgresEntitlementControlPlaneStore(pool);

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
    handoffs: new PostgresRistoairenExperienceHandoffStore(pool),
    trustedRequestScopes: foundationReads,
  });

  const readiness = async () => {
    const result = await pool.query<{
      session_role: string;
      active_role: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      app_member: boolean;
      auth_member: boolean;
      control_plane_member: boolean;
      owner_member: boolean;
      session_table: boolean;
    }>(`SELECT
        session_user AS session_role,
        current_user AS active_role,
        r.rolsuper,
        r.rolbypassrls,
        pg_has_role(session_user,'airen_app','MEMBER') AS app_member,
        pg_has_role(session_user,'airen_auth','MEMBER') AS auth_member,
        pg_has_role(session_user,'airen_control_plane','MEMBER') AS control_plane_member,
        pg_has_role(session_user,'airen_control_plane_owner','MEMBER') AS owner_member,
        to_regclass('identity.airenos_sessions') IS NOT NULL AS session_table
      FROM pg_roles r
      WHERE r.rolname=session_user`);
    const role = result.rows[0];
    const ok = Boolean(
      role &&
      !role.rolsuper &&
      !role.rolbypassrls &&
      !role.owner_member &&
      role.app_member &&
      role.auth_member &&
      role.control_plane_member &&
      role.active_role === "airen_app" &&
      role.session_table
    );
    return { ok, code: ok ? "ok" : "ra01_session_authority_runtime_not_ready" } as const;
  };

  const server = createServer(async (request, response) => {
    const started = Date.now();
    const context = runtime.observability.createContext({
      "x-correlation-id": header(request, "x-correlation-id"),
      traceparent: header(request, "traceparent"),
    });
    response.setHeader("x-correlation-id", context.correlationId);
    response.setHeader("traceparent", formatTraceparent(context));

    try {
      if (request.method === "GET" && request.url === "/health/live") {
        json(response, 200, { status: "LIVE", service: "airenos-ra01-foundation-staging", releaseRevision: deployment.releaseRevision });
        return;
      }

      if (request.method === "GET" && request.url === "/health/ready") {
        const probe = await readiness();
        json(response, probe.ok ? 200 : 503, {
          status: probe.ok ? "READY" : "NOT_READY",
          service: "airenos-ra01-foundation-staging",
          releaseRevision: deployment.releaseRevision,
          checks: [{ name: "postgres.airenos_session_authority", critical: true, ...probe }],
        });
        return;
      }

      if (isRistoairenProductAttachmentApiRequest(request.url)) {
        let body: unknown;
        try {
          body = await readAttachmentJsonBody(request);
        } catch (error) {
          const classification = classifyError(error);
          json(response, classification.code === "VALIDATION_FAILED" ? 400 : 500, {
            error: classification.code,
            correlationId: context.correlationId,
          });
          return;
        }

        const result = await dispatchRistoairenProductAttachmentApiRequest({
          method: request.method ?? "GET",
          url: request.url ?? "",
          headers: Object.freeze({
            authorization: header(request, "authorization"),
            host: header(request, "host"),
            "x-correlation-id": context.correlationId,
          }),
          body,
        }, ristoairenAttachmentDeps);

        json(response, result.status, result.body, result.headers);
        const outcome = result.status < 400 ? "success" : result.status >= 500 ? "failed" : "denied";
        await runtime.observability.metrics.request("ristoairen.product_attachment.api", outcome, Date.now() - started);
        return;
      }

      json(response, 404, { error: "not_found" });
    } catch (error) {
      const classification = classifyError(error);
      await runtime.observability.logger.error("ra01.http.request_failed", context, error, { operation: "ra01.http.request" });
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

  let stopping = false;
  const stop = async (signal = "manual") => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), deployment.shutdownTimeoutMs);
    timeout.unref();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await pool.end();
    clearTimeout(timeout);
    process.stdout.write(`${JSON.stringify({ event: "ra01.foundation.service.stopped", signal })}\n`);
  };

  return Object.freeze({ server, pool, runtime, deployment, stop });
}
