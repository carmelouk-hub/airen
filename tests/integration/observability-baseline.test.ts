import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import {
  StructuredLogger,
  FoundationMetrics,
  childTraceContext,
  createTraceContext,
  evaluateReadiness,
  formatTraceparent,
  traceContextFromHeaders,
  type LogSink,
  type MetricPoint,
  type MetricSink,
  type StructuredLogRecord
} from "../../packages/observability/src/index.ts";
import { EnvironmentSecretProvider } from "../../packages/integrations/src/index.ts";
import { bootstrapFoundationRuntime } from "../../apps/api/src/runtime-bootstrap.ts";

class MemoryLogSink implements LogSink {
  readonly records: StructuredLogRecord[] = [];
  emit(record: StructuredLogRecord): void { this.records.push(record); }
}

class MemoryMetricSink implements MetricSink {
  readonly points: MetricPoint[] = [];
  record(point: MetricPoint): void { this.points.push(point); }
}

function runtimeEnvironment(dbKey: string, authKey: string): Record<string, string> {
  return {
    NODE_ENV: "test",
    APP_BASE_DOMAIN: "ristoairen.test",
    AUTH_ADAPTER: "signed-session",
    AUTH_PROVIDER_KEY: "synthetic-auth",
    AUTH_AUDIENCE: "airenos-foundation",
    SECRET_MANAGER_ADAPTER: "env",
    DATABASE_URL_SECRET_REF: `secret://env/${dbKey}`,
    AUTH_SESSION_KEY_SECRET_REF: `secret://env/${authKey}`
  };
}

test("trace context preserves incoming W3C trace and creates child spans", () => {
  const root = createTraceContext({ correlationId: "corr-foundation-001" });
  const incoming = traceContextFromHeaders({
    traceparent: formatTraceparent(root),
    "x-correlation-id": root.correlationId
  });
  assert.equal(incoming.traceId, root.traceId);
  assert.equal(incoming.parentSpanId, root.spanId);
  assert.equal(incoming.correlationId, root.correlationId);
  assert.notEqual(incoming.spanId, root.spanId);

  const child = childTraceContext(incoming);
  assert.equal(child.traceId, incoming.traceId);
  assert.equal(child.parentSpanId, incoming.spanId);
  assert.equal(child.correlationId, incoming.correlationId);
});

test("invalid trace headers fail safely into a fresh trace context", () => {
  const context = traceContextFromHeaders({ traceparent: "00-invalid-invalid-01", "x-correlation-id": "bad" });
  assert.match(context.traceId, /^[0-9a-f]{32}$/);
  assert.match(context.spanId, /^[0-9a-f]{16}$/);
  assert.equal(context.parentSpanId, undefined);
  assert.notEqual(context.correlationId, "bad");
});

test("structured logs redact sensitive keys, PII and token-like values", () => {
  const sink = new MemoryLogSink();
  const logger = new StructuredLogger({ service: "airenos-api", environment: "test", sink, now: () => new Date("2026-08-21T17:30:00.000Z") });
  const context = createTraceContext({ correlationId: "corr-foundation-002" });
  const dynamicCredential = randomBytes(32).toString("hex");
  const signedLike = `${randomBytes(18).toString("base64url")}.${randomBytes(24).toString("base64url")}`;

  logger.emit("info", "http.request.completed", context, {
    operation: "tenant.location.create",
    outcome: "success",
    tenantId: "tenant-synthetic",
    locationId: "location-synthetic",
    attributes: {
      authorization: `Bearer ${dynamicCredential}`,
      email: "person@example.test",
      nested: { password: dynamicCredential, free_text: signedLike },
      safe_flag: true
    }
  });

  const serialized = JSON.stringify(sink.records[0]);
  assert.equal(serialized.includes(dynamicCredential), false);
  assert.equal(serialized.includes("person@example.test"), false);
  assert.equal(serialized.includes(signedLike), false);
  assert.match(serialized, /\[redacted\]/);
  assert.match(serialized, /\[pii\]/);
  assert.equal(sink.records[0].correlationId, context.correlationId);
  assert.equal(sink.records[0].traceId, context.traceId);
});

test("error telemetry emits stable taxonomy without serializing error messages", () => {
  const sink = new MemoryLogSink();
  const logger = new StructuredLogger({ service: "airenos-api", environment: "test", sink });
  const context = createTraceContext({ correlationId: "corr-foundation-003" });
  const sensitive = randomBytes(28).toString("hex");
  const error = new AppError("SECRET_RESOLUTION_FAILED", `provider failed with ${sensitive}`);
  logger.error("runtime.dependency.failed", context, error, { operation: "runtime.bootstrap" });

  const serialized = JSON.stringify(sink.records[0]);
  assert.equal(serialized.includes(sensitive), false);
  assert.equal(sink.records[0].errorCode, "SECRET_RESOLUTION_FAILED");
  assert.equal(sink.records[0].level, "error");
  assert.equal(sink.records[0].attributes?.error_class, "dependency");
});

test("metrics enforce low-cardinality labels and reject tenant or correlation identifiers", () => {
  const sink = new MemoryMetricSink();
  const metrics = new FoundationMetrics({ sink, service: "airenos-api", environment: "test" });
  metrics.request("tenant.location.create", "success", 12);
  assert.equal(sink.points.length, 2);
  assert.deepEqual(sink.points[0].labels, { service: "airenos-api", environment: "test", operation: "tenant.location.create", outcome: "success" });
  assert.throws(() => metrics.record("foundation.request.total", "counter", 1, { tenant_id: "tenant-a" }), (error: unknown) => error instanceof AppError && error.code === "VALIDATION_FAILED");
  assert.throws(() => metrics.record("foundation.request.total", "counter", 1, { correlation_id: "corr-a" }), (error: unknown) => error instanceof AppError && error.code === "VALIDATION_FAILED");
});

test("readiness fails closed on critical dependencies and never returns thrown error detail", async () => {
  const sensitive = randomBytes(24).toString("hex");
  let tick = 0;
  const report = await evaluateReadiness([
    { name: "database", critical: true, async run() { return { ok: true, code: "ok" }; } },
    { name: "secret-provider", critical: true, async run() { throw new Error(`unavailable ${sensitive}`); } },
    { name: "optional-cache", critical: false, async run() { return { ok: false, code: "timeout" }; } }
  ], () => { tick += 5; return tick; });

  assert.equal(report.status, "NOT_READY");
  assert.equal(report.checks[1].status, "FAIL");
  assert.equal(report.checks[1].code, "check_error");
  assert.equal(JSON.stringify(report).includes(sensitive), false);
});

test("Foundation bootstrap composes observability sinks without exposing resolved secrets", async () => {
  const dbKey = "FOUNDATION_OBS_DB_REF";
  const authKey = "FOUNDATION_OBS_AUTH_REF";
  const databaseValue = `postgresql://synthetic/${randomBytes(12).toString("hex")}`;
  const authValue = randomBytes(32).toString("hex");
  const logSink = new MemoryLogSink();
  const metricSink = new MemoryMetricSink();
  const provider = new EnvironmentSecretProvider({ [dbKey]: databaseValue, [authKey]: authValue }, [dbKey, authKey]);
  const runtime = await bootstrapFoundationRuntime(runtimeEnvironment(dbKey, authKey), provider, { logSink, metricSink });
  const context = runtime.observability.createContext({ "x-correlation-id": "corr-foundation-004" });
  runtime.observability.logger.emit("info", "runtime.bootstrap.ready", context, { operation: "runtime.bootstrap", outcome: "success", attributes: runtime.diagnostics });
  runtime.observability.metrics.request("runtime.bootstrap", "success", 4);

  const telemetry = JSON.stringify({ logs: logSink.records, metrics: metricSink.points, diagnostics: runtime.diagnostics });
  assert.equal(telemetry.includes(databaseValue), false);
  assert.equal(telemetry.includes(authValue), false);
  assert.equal(logSink.records.length, 1);
  assert.equal(metricSink.points.length, 2);
});
