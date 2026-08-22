import { randomBytes, randomUUID } from "node:crypto";
import { AppError, type AppErrorCode } from "../../shared-contracts/src/index.ts";

export type CriticalPathSignal = { name: string; success: boolean; latencyMs?: number; retryCount?: number; errorCode?: string; tenantViolation?: boolean; };

export type TraceContext = Readonly<{
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}>;

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogOutcome = "success" | "denied" | "failed" | "degraded";
export type SafeAttribute = string | number | boolean | null | readonly SafeAttribute[] | Readonly<Record<string, SafeAttribute>>;
export type SafeAttributes = Readonly<Record<string, SafeAttribute>>;

export type StructuredLogRecord = Readonly<{
  timestamp: string;
  level: LogLevel;
  event: string;
  service: string;
  environment: string;
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation?: string;
  outcome?: LogOutcome;
  durationMs?: number;
  errorCode?: string;
  tenantId?: string;
  locationId?: string;
  attributes?: SafeAttributes;
}>;

export interface LogSink {
  emit(record: StructuredLogRecord): void | Promise<void>;
}

export type MetricKind = "counter" | "histogram" | "gauge";
export type MetricLabels = Readonly<Record<string, string>>;
export type MetricPoint = Readonly<{
  name: string;
  kind: MetricKind;
  value: number;
  labels: MetricLabels;
}>;

export interface MetricSink {
  record(point: MetricPoint): void | Promise<void>;
}

export type ErrorClass = "authentication" | "authorization" | "routing" | "configuration" | "dependency" | "validation" | "conflict" | "internal";
export type ErrorClassification = Readonly<{
  code: AppErrorCode;
  class: ErrorClass;
  level: LogLevel;
  retryable: boolean;
}>;

export type HealthStatus = "PASS" | "FAIL";
export type ReadinessStatus = "READY" | "DEGRADED" | "NOT_READY";
export type HealthCheckResult = Readonly<{
  name: string;
  critical: boolean;
  status: HealthStatus;
  code: string;
  latencyMs: number;
}>;
export interface HealthCheck {
  name: string;
  critical: boolean;
  run(): Promise<Readonly<{ ok: boolean; code?: string }>>;
}
export type ReadinessReport = Readonly<{
  status: ReadinessStatus;
  checkedAt: string;
  checks: readonly HealthCheckResult[];
}>;

const eventPattern = /^[a-z][a-z0-9_.-]{1,95}$/;
const idPattern = /^[A-Za-z0-9._:-]{8,128}$/;
const traceIdPattern = /^[0-9a-f]{32}$/;
const spanIdPattern = /^[0-9a-f]{16}$/;
const forbiddenAttributeKey = /(authorization|cookie|password|secret|token|credential|api[_-]?key|session[_-]?key|connection[_-]?string)/i;
const piiAttributeKey = /(^|[_-])(email|phone|first[_-]?name|last[_-]?name|full[_-]?name|birth|iban|tax|fiscal|card)([_-]|$)/i;
const bearerPattern = /^Bearer\s+\S+/i;
const signedTokenPattern = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]{16,})?$/;
const connectionStringPattern = /^[a-z][a-z0-9+.-]*:\/\/[^\s@]+@/i;
const secretReferencePattern = /^secret:\/\//i;
const allowedMetricLabels = new Set(["service", "environment", "operation", "outcome", "error_class", "error_code", "dependency", "check"]);

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function safeCorrelationId(candidate?: string): string {
  if (candidate && idPattern.test(candidate)) return candidate;
  return randomUUID();
}

function sanitizeString(value: string): string {
  if (bearerPattern.test(value) || signedTokenPattern.test(value) || connectionStringPattern.test(value) || secretReferencePattern.test(value)) return "[redacted]";
  return value.length > 512 ? `${value.slice(0, 509)}...` : value;
}

function sanitizeValue(value: unknown, key: string, depth: number): SafeAttribute {
  if (forbiddenAttributeKey.test(key)) return "[redacted]";
  if (piiAttributeKey.test(key)) return "[pii]";
  if (depth > 4) return "[depth]";
  if (value === null) return null;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeValue(item, key, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, SafeAttribute> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 64)) {
      output[childKey] = sanitizeValue(childValue, childKey, depth + 1);
    }
    return Object.freeze(output);
  }
  return String(value);
}

export function sanitizeTelemetryAttributes(input?: Readonly<Record<string, unknown>>): SafeAttributes | undefined {
  if (!input) return undefined;
  const output: Record<string, SafeAttribute> = {};
  for (const [key, value] of Object.entries(input).slice(0, 64)) output[key] = sanitizeValue(value, key, 0);
  return Object.freeze(output);
}

export function createTraceContext(input?: Readonly<{ correlationId?: string; traceId?: string; parentSpanId?: string }>): TraceContext {
  const traceId = input?.traceId && traceIdPattern.test(input.traceId) && input.traceId !== "00000000000000000000000000000000" ? input.traceId : randomHex(16);
  const parentSpanId = input?.parentSpanId && spanIdPattern.test(input.parentSpanId) && input.parentSpanId !== "0000000000000000" ? input.parentSpanId : undefined;
  return Object.freeze({ correlationId: safeCorrelationId(input?.correlationId), traceId, spanId: randomHex(8), ...(parentSpanId ? { parentSpanId } : {}) });
}

export function childTraceContext(parent: TraceContext): TraceContext {
  return createTraceContext({ correlationId: parent.correlationId, traceId: parent.traceId, parentSpanId: parent.spanId });
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-01`;
}

export function parseTraceparent(value?: string): Readonly<{ traceId: string; parentSpanId: string }> | null {
  if (!value) return null;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(value.trim());
  if (!match || match[1] === "00000000000000000000000000000000" || match[2] === "0000000000000000") return null;
  return Object.freeze({ traceId: match[1], parentSpanId: match[2] });
}

export function traceContextFromHeaders(headers: Readonly<Record<string, string | undefined>>): TraceContext {
  const incoming = parseTraceparent(headers.traceparent);
  return createTraceContext({
    correlationId: headers["x-correlation-id"],
    traceId: incoming?.traceId,
    parentSpanId: incoming?.parentSpanId
  });
}

function requireEventName(value: string): string {
  if (!eventPattern.test(value)) throw new AppError("VALIDATION_FAILED", "Telemetry event name must be a stable low-cardinality identifier");
  return value;
}

export function classifyError(error: unknown): ErrorClassification {
  const code: AppErrorCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  switch (code) {
    case "AUTHENTICATION_REQUIRED": return { code, class: "authentication", level: "warn", retryable: false };
    case "TENANT_RESOLUTION_FAILED": return { code, class: "routing", level: "warn", retryable: false };
    case "MEMBERSHIP_REQUIRED":
    case "LOCATION_MEMBERSHIP_REQUIRED":
    case "PERMISSION_DENIED":
    case "ENTITLEMENT_REQUIRED":
    case "TENANT_SCOPE_VIOLATION":
    case "LOCATION_SCOPE_VIOLATION": return { code, class: "authorization", level: "warn", retryable: false };
    case "RUNTIME_CONFIGURATION_INVALID": return { code, class: "configuration", level: "fatal", retryable: false };
    case "SECRET_RESOLUTION_FAILED": return { code, class: "dependency", level: "error", retryable: true };
    case "VALIDATION_FAILED": return { code, class: "validation", level: "warn", retryable: false };
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT": return { code, class: "conflict", level: "warn", retryable: false };
    default: return { code: "INTERNAL_ERROR", class: "internal", level: "error", retryable: true };
  }
}

export class StructuredLogger {
  private readonly service: string;
  private readonly environment: string;
  private readonly sink: LogSink;
  private readonly now: () => Date;

  constructor(input: { service: string; environment: string; sink: LogSink; now?: () => Date }) {
    this.service = requireEventName(input.service);
    this.environment = requireEventName(input.environment);
    this.sink = input.sink;
    this.now = input.now ?? (() => new Date());
  }

  emit(level: LogLevel, event: string, context: TraceContext, fields?: Readonly<{
    operation?: string;
    outcome?: LogOutcome;
    durationMs?: number;
    errorCode?: string;
    tenantId?: string;
    locationId?: string;
    attributes?: Readonly<Record<string, unknown>>;
  }>): void | Promise<void> {
    const record: StructuredLogRecord = Object.freeze({
      timestamp: this.now().toISOString(),
      level,
      event: requireEventName(event),
      service: this.service,
      environment: this.environment,
      correlationId: context.correlationId,
      traceId: context.traceId,
      spanId: context.spanId,
      ...(context.parentSpanId ? { parentSpanId: context.parentSpanId } : {}),
      ...(fields?.operation ? { operation: requireEventName(fields.operation) } : {}),
      ...(fields?.outcome ? { outcome: fields.outcome } : {}),
      ...(Number.isFinite(fields?.durationMs) ? { durationMs: Math.max(0, Number(fields?.durationMs)) } : {}),
      ...(fields?.errorCode ? { errorCode: fields.errorCode } : {}),
      ...(fields?.tenantId ? { tenantId: fields.tenantId } : {}),
      ...(fields?.locationId ? { locationId: fields.locationId } : {}),
      ...(fields?.attributes ? { attributes: sanitizeTelemetryAttributes(fields.attributes) } : {})
    });
    return this.sink.emit(record);
  }

  error(event: string, context: TraceContext, error: unknown, fields?: Readonly<{ operation?: string; tenantId?: string; locationId?: string; attributes?: Readonly<Record<string, unknown>> }>): void | Promise<void> {
    const classification = classifyError(error);
    return this.emit(classification.level, event, context, {
      ...fields,
      outcome: "failed",
      errorCode: classification.code,
      attributes: { ...fields?.attributes, error_class: classification.class, retryable: classification.retryable }
    });
  }
}

function validateMetricLabels(labels: MetricLabels): MetricLabels {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!allowedMetricLabels.has(key)) throw new AppError("VALIDATION_FAILED", `Metric label is not permitted: ${key}`);
    if (forbiddenAttributeKey.test(key) || piiAttributeKey.test(key)) throw new AppError("VALIDATION_FAILED", "Sensitive metric label is prohibited");
    clean[key] = sanitizeString(String(value)).slice(0, 96);
  }
  return Object.freeze(clean);
}

export class FoundationMetrics {
  private readonly sink: MetricSink;
  private readonly baseLabels: MetricLabels;

  constructor(input: { sink: MetricSink; service: string; environment: string }) {
    this.sink = input.sink;
    this.baseLabels = Object.freeze({ service: requireEventName(input.service), environment: requireEventName(input.environment) });
  }

  record(name: string, kind: MetricKind, value: number, labels: MetricLabels = {}): void | Promise<void> {
    requireEventName(name);
    if (!Number.isFinite(value)) throw new AppError("VALIDATION_FAILED", "Metric value must be finite");
    return this.sink.record(Object.freeze({ name, kind, value, labels: validateMetricLabels({ ...this.baseLabels, ...labels }) }));
  }

  request(operation: string, outcome: LogOutcome, durationMs: number): void | Promise<void> {
    const labels = { operation: requireEventName(operation), outcome };
    const result = this.record("foundation.request.total", "counter", 1, labels);
    const second = this.record("foundation.request.duration_ms", "histogram", Math.max(0, durationMs), labels);
    if (result instanceof Promise || second instanceof Promise) return Promise.all([result, second]).then(() => undefined);
  }

  error(operation: string, error: unknown): void | Promise<void> {
    const classification = classifyError(error);
    return this.record("foundation.error.total", "counter", 1, { operation: requireEventName(operation), error_class: classification.class, error_code: classification.code });
  }
}

export class NoopLogSink implements LogSink {
  emit(_record: StructuredLogRecord): void {}
}

export class NoopMetricSink implements MetricSink {
  record(_point: MetricPoint): void {}
}

export async function evaluateReadiness(checks: readonly HealthCheck[], now: () => number = Date.now): Promise<ReadinessReport> {
  const results: HealthCheckResult[] = [];
  for (const check of checks) {
    const started = now();
    try {
      const result = await check.run();
      results.push(Object.freeze({ name: requireEventName(check.name), critical: check.critical, status: result.ok ? "PASS" : "FAIL", code: requireEventName(result.code ?? (result.ok ? "ok" : "failed")), latencyMs: Math.max(0, now() - started) }));
    } catch {
      results.push(Object.freeze({ name: requireEventName(check.name), critical: check.critical, status: "FAIL", code: "check_error", latencyMs: Math.max(0, now() - started) }));
    }
  }
  const criticalFailure = results.some((item) => item.critical && item.status === "FAIL");
  const anyFailure = results.some((item) => item.status === "FAIL");
  return Object.freeze({ status: criticalFailure ? "NOT_READY" : anyFailure ? "DEGRADED" : "READY", checkedAt: new Date(now()).toISOString(), checks: Object.freeze(results) });
}

export type FoundationObservabilityRuntime = Readonly<{
  logger: StructuredLogger;
  metrics: FoundationMetrics;
  createContext(headers?: Readonly<Record<string, string | undefined>>): TraceContext;
  readiness(checks: readonly HealthCheck[]): Promise<ReadinessReport>;
}>;

export function createFoundationObservabilityRuntime(input: { service: string; environment: string; logSink?: LogSink; metricSink?: MetricSink; now?: () => Date }): FoundationObservabilityRuntime {
  const logger = new StructuredLogger({ service: input.service, environment: input.environment, sink: input.logSink ?? new NoopLogSink(), now: input.now });
  const metrics = new FoundationMetrics({ service: input.service, environment: input.environment, sink: input.metricSink ?? new NoopMetricSink() });
  return Object.freeze({
    logger,
    metrics,
    createContext(headers = {}) { return traceContextFromHeaders(headers); },
    readiness(checks) { return evaluateReadiness(checks); }
  });
}

// PII and secret values must never become telemetry labels or unredacted event payloads.
