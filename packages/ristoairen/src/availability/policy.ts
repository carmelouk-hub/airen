import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type {
  AvailabilityQueryInputV1,
  LocationAvailabilityPolicyV1,
  LocationAvailabilityServiceWindowV1
} from "./contracts.ts";
import {
  AVAILABILITY_ENTITLEMENT,
  AVAILABILITY_PERMISSION
} from "./contracts.ts";

function validation(message: string): never {
  throw new AppError("VALIDATION_FAILED", message);
}

function boundedInteger(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    validation(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function validDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) validation(`${field} must be YYYY-MM-DD`);
  return value;
}

function validTime(value: string, field: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) validation(`${field} must be HH:MM`);
  return value;
}

export function localTimeToMinutes(value: string, field = "local_time"): number {
  validTime(value, field);
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function minutesToLocalTime(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) {
    validation("local minute value is outside the canonical service day");
  }
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function requireAvailabilityAccess(context: SecurityContext): void {
  if (!context.entitlements.includes(AVAILABILITY_ENTITLEMENT)) {
    throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${AVAILABILITY_ENTITLEMENT}`);
  }
  if (!context.permissions.includes(AVAILABILITY_PERMISSION)) {
    throw new AppError("PERMISSION_DENIED", `Missing permission: ${AVAILABILITY_PERMISSION}`);
  }
}

export function validateAvailabilityQuery(input: AvailabilityQueryInputV1): AvailabilityQueryInputV1 {
  validDate(input.bookingDate, "bookingDate");
  boundedInteger(input.partySize, 1, 1000, "partySize");
  boundedInteger(input.expectedDurationMinutes, 15, 1440, "expectedDurationMinutes");
  if (input.preferredTimeLocal !== undefined) validTime(input.preferredTimeLocal, "preferredTimeLocal");
  return Object.freeze({ ...input });
}

export function validateLocationTimeZone(timeZone: string | null): string {
  const normalized = timeZone?.trim();
  if (!normalized) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Canonical Location timezone is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date(0));
  } catch {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Canonical Location timezone is invalid");
  }
  return normalized;
}

export function validateAvailabilityPolicy(
  context: SecurityContext,
  policy: LocationAvailabilityPolicyV1 | null,
  serviceDate: string
): LocationAvailabilityPolicyV1 {
  if (!policy) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "LocationAvailabilityPolicy is required");
  if (policy.tenantId !== context.tenantId) {
    throw new AppError("TENANT_SCOPE_VIOLATION", "Availability policy tenant mismatch");
  }
  if (policy.locationId !== context.locationId) {
    throw new AppError("LOCATION_SCOPE_VIOLATION", "Availability policy location mismatch");
  }
  const normalized = policy.windows.map((window) => validateWindow(window, serviceDate));
  const ordered = [...normalized].sort((a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal));
  for (let index = 1; index < ordered.length; index += 1) {
    if (localTimeToMinutes(ordered[index].startsAtLocal) < localTimeToMinutes(ordered[index - 1].endsAtLocal)) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Availability service windows must not overlap");
    }
  }
  return Object.freeze({ ...policy, windows: Object.freeze(ordered) });
}

function validateWindow(
  window: LocationAvailabilityServiceWindowV1,
  serviceDate: string
): LocationAvailabilityServiceWindowV1 {
  validDate(window.serviceDate, "serviceDate");
  if (window.serviceDate !== serviceDate) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Availability service window date mismatch");
  }
  const startsAt = localTimeToMinutes(window.startsAtLocal, "startsAtLocal");
  const endsAt = localTimeToMinutes(window.endsAtLocal, "endsAtLocal");
  if (endsAt <= startsAt) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Availability service window end must be after start");
  }
  boundedInteger(window.reservableCapacityCovers, 1, 1000, "reservableCapacityCovers");
  boundedInteger(window.slotStepMinutes, 5, 240, "slotStepMinutes");
  if (window.slotStepMinutes % 5 !== 0) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "slotStepMinutes must be divisible by 5");
  }
  return Object.freeze({ ...window });
}
