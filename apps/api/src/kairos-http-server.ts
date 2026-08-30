import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import { loadFoundationRuntimeEnvironment } from "../../../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider, type SecretProvider } from "../../../packages/integrations/src/index.ts";
import { ProviderNeutralAuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import { PostgresAuthenticationIdentityDirectory, PostgresFoundationReadStore } from "../../../packages/persistence-postgres/src/index.ts";
import { PostgresKairosGraphStore } from "../../../packages/persistence-postgres/src/kairos-graph.ts";
import { classifyError, formatTraceparent, type LogSink, type MetricPoint, type MetricSink, type StructuredLogRecord } from "../../../packages/observability/src/index.ts";
import { bootstrapFoundationRuntime } from "./runtime-bootstrap.ts";
import { parseDeploymentRuntimeOptions } from "./deployment-config.ts";
import { dispatchKairosApiRequest, isKairosApiRequest, type KairosApiDependencies } from "./kairos-api.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

const CORS_ALLOWED_HEADERS = Object.freeze(["authorization", "content-type", "x-correlation-id"] as const);
const CORS_ALLOWED_HEADER_SET = new Set<string>(CORS_ALLOWED_HEADERS);

class StdoutJsonLogSink implements LogSink {
  emit(record: StructuredLogRecord): void { process.stdout.write(`${JSON.stringify({ type: "log", ...record })}\n`); }
}

class StdoutJsonMetricSink implements MetricSink {
  record(point: MetricPoint): void { process.stdout.write(`${JSON.stringify({ type: "metric", ...point })}\n`); }
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(
  response: ServerResponse,
  statusCode: number,
  body: Readonly<Record<string, unknown>>,
  headers?: Readonly<Record<string, string>>,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  for (const [name, value] of Object.entries(headers ?? {})) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function empty(response: ServerResponse, statusCode: number, headers: Readonly<Record<string, string>>): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end();
}

function secretProvider(environment: EnvironmentInput): SecretProvider {
  const config = loadFoundationRuntimeEnvironment(environment);
  if (config.secretManagerAdapter !== "env") {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Kairos HTTP runtime currently requires the configured SecretProvider adapter", { provider: config.secretManagerAdapter });
  }
  return new EnvironmentSecretProvider(environment, [config.databaseUrlRef.key, config.authSessionKeyRef.key]);
}

export function parseKairosAllowedOrigins(value: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const raw of value?.split(",") ?? []) {
    const candidate = raw.trim();
    if (!candidate) continue;
    if (candidate === "*") {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "KAIROS_CORS_ALLOWED_ORIGINS must never contain a wildcard");
    }
    let parsed: URL;
    try { parsed = new URL(candidate); }
    catch { throw new AppError("RUNTIME_CONFIGURATION_INVALID", "KAIROS_CORS_ALLOWED_ORIGINS contains an invalid origin"); }
    if (parsed.protocol !== "https:" || parsed.origin !== candidate || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "KAIROS_CORS_ALLOWED_ORIGINS entries must be exact HTTPS origins without path, query, or fragment");
    }
    origins.add(candidate);
  }
  return origins;
}

export type KairosCorsDecision =
  | Readonly<{ kind: "pass"; headers: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "preflight"; headers: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "deny"; reason: string }>;

function corsResponseHeaders(origin: string): Readonly<Record<string, string>> {
  return Object.freeze({
    "access-control-allow-origin": origin,
    "access-control-expose-headers": "x-correlation-id, traceparent",
    "vary": "Origin",
  });
}

export function evaluateKairosCors(input: Readonly<{
  method: string;
  origin?: string;
  requestedMethod?: string;
  requestedHeaders?: string;
  allowedOrigins: ReadonlySet<string>;
}>): KairosCorsDecision {
  const method = input.method.toUpperCase();
  const origin = input.origin?.trim();
  if (!origin) {
    return method === "OPTIONS"
      ? Object.freeze({ kind: "deny", reason: "cors_origin_required" })
      : Object.freeze({ kind: "pass", headers: Object.freeze({}) });
  }
  if (!input.allowedOrigins.has(origin)) return Object.freeze({ kind: "deny", reason: "cors_origin_denied" });
  const baseHeaders = corsResponseHeaders(origin);
  if (method !== "OPTIONS") return Object.freeze({ kind: "pass", headers: baseHeaders });

  if (input.requestedMethod?.trim().toUpperCase() !== "GET") {
    return Object.freeze({ kind: "deny", reason: "cors_method_denied" });
  }
  const requested = (input.requestedHeaders ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (requested.some((name) => !CORS_ALLOWED_HEADER_SET.has(name))) {
    return Object.freeze({ kind: "deny", reason: "cors_header_denied" });
  }
  return Object.freeze({
    kind: "preflight",
    headers: Object.freeze({
      ...baseHeaders,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": CORS_ALLOWED_HEADERS.join(", "),
      "access-control-max-age": "600",
    }),
  });
}

function kairosHeaders(request: IncomingMessage, correlationId: string): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    authorization: header(request, "authorization"),
    "x-correlation-id": correlationId,
  });
}

export async function startKairosHttpServer(environment: EnvironmentInput = process.env) {
  const deployment = parseDeploymentRuntimeOptions(environment);
  const runtimeSecrets = secretProvider(environment);
  const runtime = await bootstrapFoundationRuntime(environment, runtimeSecrets, {
    logSink: new StdoutJsonLogSink(),
    metricSink: new StdoutJsonMetricSink(),
  });
  const pool = runtime.withDatabaseConnectionString((connectionString) => new Pool({
    connectionString,
    max: 5,
    application_name: "airenos-kairos-api",
    options: "-c role=airen_app",
  }));
  const foundationReads = new PostgresFoundationReadStore(pool);
  const authentication = new ProviderNeutralAuthenticationAdapter(
    runtime.createReferenceSignedSessionVerifier(),
    new PostgresAuthenticationIdentityDirectory(pool),
  );
  const deps: KairosApiDependencies = Object.freeze({
    authentication,
    roles: foundationReads,
    graph: new PostgresKairosGraphStore(pool),
  });
  const allowedOrigins = parseKairosAllowedOrigins(environment.KAIROS_CORS_ALLOWED_ORIGINS);

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
        json(response, 200, { status: "LIVE", service: "airenos-kairos-api", releaseRevision: deployment.releaseRevision });
        return;
      }
      if (request.method === "GET" && request.url === "/health/ready") {
        await pool.query("SELECT 1");
        json(response, 200, { status: "READY", service: "airenos-kairos-api", releaseRevision: deployment.releaseRevision });
        return;
      }
      if (!isKairosApiRequest(request.url)) {
        json(response, 404, { error: "not_found" });
        return;
      }

      const cors = evaluateKairosCors({
        method: request.method ?? "GET",
        origin: header(request, "origin"),
        requestedMethod: header(request, "access-control-request-method"),
        requestedHeaders: header(request, "access-control-request-headers"),
        allowedOrigins,
      });
      if (cors.kind === "deny") {
        json(response, 403, { error: "CORS_ORIGIN_DENIED", reason: cors.reason, correlationId: context.correlationId });
        return;
      }
      if (cors.kind === "preflight") {
        empty(response, 204, cors.headers);
        return;
      }

      const result = await dispatchKairosApiRequest({
        method: request.method ?? "GET",
        url: request.url ?? "",
        headers: kairosHeaders(request, context.correlationId),
      }, deps);
      json(response, result.status, result.body, { ...result.headers, ...cors.headers });
      const outcome = result.status < 400 ? "success" : result.status >= 500 ? "failed" : "denied";
      await runtime.observability.metrics.request("kairos.api", outcome, Date.now() - started);
      await runtime.observability.logger.emit(result.status >= 500 ? "error" : result.status >= 400 ? "warn" : "info", "http.kairos_api", context, {
        operation: "kairos.api",
        outcome,
        durationMs: Date.now() - started,
        attributes: { method: request.method, statusCode: result.status },
      });
    } catch (error) {
      const classification = classifyError(error);
      await runtime.observability.logger.error("http.kairos_request_failed", context, error, { operation: "kairos.api" });
      await runtime.observability.metrics.error("kairos.api", error);
      json(response, 500, { error: classification.code, correlationId: context.correlationId });
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
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await pool.end();
  };

  return Object.freeze({ server, pool, runtime, deployment, allowedOrigins, stop });
}

async function main(): Promise<void> {
  const service = await startKairosHttpServer(process.env);
  const shutdown = () => { void service.stop().then(() => { process.exitCode = 0; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  main().catch((error: unknown) => {
    const classification = classifyError(error);
    process.stderr.write(`${JSON.stringify({ event: "kairos.service.start_failed", errorCode: classification.code })}\n`);
    process.exitCode = 1;
  });
}
