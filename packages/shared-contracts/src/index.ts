export type UUID = string;
export type TenantContext = { correlationId: string; actorIdentityId: UUID; platformRoles: readonly string[]; tenantId: UUID; locationIds: readonly UUID[]; permissions: readonly string[]; entitlements: readonly string[]; };
export type DomainCommand<TInput, TResult> = (input: TInput, context: TenantContext) => Promise<TResult>;
export type PublicProjection<T> = Readonly<T>;
export type AppErrorCode = "AUTHENTICATION_REQUIRED" | "MEMBERSHIP_REQUIRED" | "PERMISSION_DENIED" | "ENTITLEMENT_REQUIRED" | "TENANT_SCOPE_VIOLATION" | "LOCATION_SCOPE_VIOLATION" | "VALIDATION_FAILED" | "CONFLICT" | "STALE_STATE" | "IDEMPOTENCY_CONFLICT" | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED" | "INTERNAL_ERROR";
