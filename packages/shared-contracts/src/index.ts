export type UUID = string;

export type AppErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "TENANT_RESOLUTION_FAILED"
  | "MEMBERSHIP_REQUIRED"
  | "LOCATION_MEMBERSHIP_REQUIRED"
  | "PERMISSION_DENIED"
  | "ENTITLEMENT_REQUIRED"
  | "TENANT_SCOPE_VIOLATION"
  | "LOCATION_SCOPE_VIOLATION"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(code: AppErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export type ResourceScope = Readonly<{ tenantId: UUID; locationId?: UUID }>;
export type SecurityContext = Readonly<{
  correlationId: string;
  actorIdentityId: UUID;
  platformRoles: readonly string[];
  platformPermissions: readonly string[];
  tenantId: UUID;
  locationId: UUID;
  tenantMembershipId?: UUID;
  locationMembershipId?: UUID;
  tenantRole?: string;
  locationRole?: string;
  permissions: readonly string[];
  entitlements: readonly string[];
}>;
export type DomainEvent = Readonly<{ eventType: string; aggregateType: string; aggregateId: string; payloadVersion: number; payload: Readonly<Record<string, unknown>> }>;
export function hasPermission(context: SecurityContext, permissionKey: string): boolean { return context.permissions.includes(permissionKey) || context.platformPermissions.includes(permissionKey); }
export function assertResourceScope(context: SecurityContext, resource: ResourceScope): void {
  if (resource.tenantId !== context.tenantId && !context.platformPermissions.includes("platform.override_tenant_scope")) throw new AppError("TENANT_SCOPE_VIOLATION", "Resource tenant does not match resolved tenant context");
  if (resource.locationId && resource.locationId !== context.locationId && !context.platformPermissions.includes("platform.override_tenant_scope")) throw new AppError("LOCATION_SCOPE_VIOLATION", "Resource location does not match resolved location context");
}
