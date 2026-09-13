import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const CROSS_DOMAIN_TRACE_ENVIRONMENT = "TEST_TEMPORARY" as const;
export const CROSS_DOMAIN_TRACE_PERMISSION = "platform.audit.read" as const;
export const RISTOAIREN_TRACE_ENTITLEMENT = "vertical.ristoairen" as const;

export type CrossDomainTraceEvidenceKind = "runtime" | "audit" | "outbox";

export type CrossDomainTraceEvidence = Readonly<{
  evidenceKind: CrossDomainTraceEvidenceKind;
  evidenceId: string;
  tenantId: string;
  locationId: string;
  actorIdentityId?: string;
  commandKey?: string;
  decision: string;
  stateTransition?: string;
  emittedFact?: string;
  resourceType?: string;
  resourceId?: string;
  sourceId: string;
  correlationId: string;
  occurredAt: string;
  metadataSanitized: Readonly<Record<string, unknown>>;
}>;

export interface CrossDomainTraceStore {
  queryByCorrelation(
    correlationId: string,
    context: SecurityContext
  ): Promise<readonly CrossDomainTraceEvidence[]>;
}

export type CrossDomainTraceSnapshot = Readonly<{
  tenantId: string;
  locationId: string;
  correlationId: string;
  environmentClass: typeof CROSS_DOMAIN_TRACE_ENVIRONMENT;
  evidence: readonly CrossDomainTraceEvidence[];
  evidenceKinds: readonly CrossDomainTraceEvidenceKind[];
  successfulCommands: number;
  deniedCommands: number;
  emittedFacts: number;
}>;

const FORBIDDEN_METADATA_KEYS = new Set([
  "secret",
  "token",
  "password",
  "authorization",
  "api_key",
  "client_secret",
  "access_token",
  "refresh_token"
]);

function validation(message: string): never {
  throw new AppError("VALIDATION_FAILED", message);
}

function correlation(value: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 240) validation("correlationId is invalid");
  return normalized;
}

function assertAuditAuthority(context: SecurityContext): void {
  if (!context.entitlements.includes(RISTOAIREN_TRACE_ENTITLEMENT)) {
    throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_TRACE_ENTITLEMENT}`);
  }
  if (!context.platformPermissions.includes(CROSS_DOMAIN_TRACE_PERMISSION)) {
    throw new AppError("PERMISSION_DENIED", `Missing platform permission: ${CROSS_DOMAIN_TRACE_PERMISSION}`);
  }
  if (!context.tenantMembershipId && !context.platformPermissions.includes("platform.override_tenant_scope")) {
    throw new AppError("MEMBERSHIP_REQUIRED", "Active tenant membership is required for cross-domain trace reconstruction");
  }
  if (
    !context.locationMembershipId &&
    !context.permissions.includes("tenant.location.all") &&
    !context.platformPermissions.includes("platform.override_tenant_scope")
  ) {
    throw new AppError("LOCATION_MEMBERSHIP_REQUIRED", "Authorized location scope is required for cross-domain trace reconstruction");
  }
}

function assertNoForbiddenKeys(value: unknown, path = "metadata"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenKeys(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [rawKey, nested] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      throw new AppError("INTERNAL_ERROR", `Forbidden sensitive metadata key returned at ${path}.${rawKey}`);
    }
    assertNoForbiddenKeys(nested, `${path}.${rawKey}`);
  }
}

function assertEvidenceScope(
  item: CrossDomainTraceEvidence,
  context: SecurityContext,
  requestedCorrelationId: string
): void {
  if (item.tenantId !== context.tenantId) {
    throw new AppError("TENANT_SCOPE_VIOLATION", "Cross-domain trace evidence tenant mismatch");
  }
  if (item.locationId !== context.locationId) {
    throw new AppError("LOCATION_SCOPE_VIOLATION", "Cross-domain trace evidence location mismatch");
  }
  if (item.correlationId !== requestedCorrelationId) {
    throw new AppError("CONFLICT", "Cross-domain trace evidence correlation mismatch");
  }
  if (!item.evidenceId?.trim() || !item.sourceId?.trim() || !item.decision?.trim()) {
    throw new AppError("INTERNAL_ERROR", "Cross-domain trace evidence is incomplete");
  }
  if (!Number.isFinite(Date.parse(item.occurredAt))) {
    throw new AppError("INTERNAL_ERROR", "Cross-domain trace evidence timestamp is invalid");
  }
  assertNoForbiddenKeys(item.metadataSanitized);
}

export async function reconstructCrossDomainTrace(
  input: Readonly<{ correlationId: string }>,
  deps: Readonly<{ context: SecurityContext; store: CrossDomainTraceStore }>
): Promise<CrossDomainTraceSnapshot> {
  const { context, store } = deps;
  assertAuditAuthority(context);
  const requestedCorrelationId = correlation(input.correlationId);
  const evidence = await store.queryByCorrelation(requestedCorrelationId, context);

  for (const item of evidence) assertEvidenceScope(item, context, requestedCorrelationId);

  const evidenceKinds = Object.freeze(
    [...new Set(evidence.map((item) => item.evidenceKind))].sort() as CrossDomainTraceEvidenceKind[]
  );
  const successfulCommands = evidence.filter(
    (item) => item.evidenceKind === "audit" && item.decision === "success"
  ).length;
  const deniedCommands = evidence.filter(
    (item) => item.evidenceKind === "audit" && item.decision === "denied"
  ).length;
  const emittedFacts = evidence.filter((item) => Boolean(item.emittedFact)).length;

  return Object.freeze({
    tenantId: context.tenantId,
    locationId: context.locationId,
    correlationId: requestedCorrelationId,
    environmentClass: CROSS_DOMAIN_TRACE_ENVIRONMENT,
    evidence: Object.freeze([...evidence]),
    evidenceKinds,
    successfulCommands,
    deniedCommands,
    emittedFacts
  });
}
