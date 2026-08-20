export type CriticalPathSignal = { name: string; success: boolean; latencyMs?: number; retryCount?: number; errorCode?: string; tenantViolation?: boolean; };
// PII and secret values must never become telemetry labels or event payloads.
