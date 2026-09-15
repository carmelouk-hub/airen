import { AppError, type SecurityContext } from "../../shared-contracts/src/index.ts";
import { requirePermission } from "../../authorization/src/index.ts";
import { BOOKING_STATUSES, type BookingCreateInputV1, type BookingQueryInputV1, type BookingStatus, type BookingStatusTransitionInputV1, type BookingUpdateInputV1 } from "./contracts.ts";

export const BOOKING_PERMISSIONS = Object.freeze({
  read: "booking.read",
  create: "booking.create",
  update: "booking.update",
  statusUpdate: "booking.status.update"
} as const);

export const BOOKING_ALLOWED_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = Object.freeze({
  REQUESTED: ["PENDING", "CONFIRMED", "CANCELLED"],
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ARRIVED", "CANCELLED", "NO_SHOW"],
  ARRIVED: ["SEATED", "CANCELLED"],
  SEATED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: []
});

export function requireBookingRead(context: SecurityContext): void { requirePermission(context, BOOKING_PERMISSIONS.read); }
export function requireBookingCreate(context: SecurityContext): void { requirePermission(context, BOOKING_PERMISSIONS.create); }
export function requireBookingUpdate(context: SecurityContext): void { requirePermission(context, BOOKING_PERMISSIONS.update); }
export function requireBookingStatusUpdate(context: SecurityContext): void { requirePermission(context, BOOKING_PERMISSIONS.statusUpdate); }

const CLIENT_SCOPE_KEYS = new Set(["tenantId", "tenant_id", "locationId", "location_id"]);
function rejectClientScopeSpoof(input: object): void {
  for (const key of Object.keys(input)) {
    if (CLIENT_SCOPE_KEYS.has(key)) throw new AppError("TENANT_SCOPE_VIOLATION", "Client Tenant/Location scope is not authoritative");
  }
}
function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AppError("VALIDATION_FAILED", `${field} is required`);
  return normalized;
}
function validDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError("VALIDATION_FAILED", `${field} must be YYYY-MM-DD`);
  return value;
}
function validTime(value: string, field: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw new AppError("VALIDATION_FAILED", `${field} must be local HH:MM[:SS]`);
  return value;
}
function boundedInteger(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new AppError("VALIDATION_FAILED", `${field} must be an integer between ${min} and ${max}`);
  return value;
}

export function validateBookingQuery(input: BookingQueryInputV1): BookingQueryInputV1 {
  const limit = input.limit ?? 50;
  boundedInteger(limit, 1, 100, "limit");
  if (input.fromDate) validDate(input.fromDate, "from_date");
  if (input.toDate) validDate(input.toDate, "to_date");
  if (input.fromDate && input.toDate && input.fromDate > input.toDate) throw new AppError("VALIDATION_FAILED", "from_date must not be after to_date");
  for (const status of input.statuses ?? []) if (!BOOKING_STATUSES.includes(status)) throw new AppError("VALIDATION_FAILED", "Unknown Booking status");
  if (input.order && input.order !== "starts_at.asc" && input.order !== "starts_at.desc") throw new AppError("VALIDATION_FAILED", "Unsupported Booking order");
  return Object.freeze({ ...input, limit, order: input.order ?? "starts_at.asc" });
}

export function validateBookingCreate(input: BookingCreateInputV1): BookingCreateInputV1 {
  rejectClientScopeSpoof(input);
  boundedInteger(input.partySize, 1, 1000, "party_size");
  boundedInteger(input.expectedDurationMinutes, 15, 1440, "expected_duration_minutes");
  validDate(input.bookingDate, "booking_date");
  validTime(input.bookingTimeLocal, "booking_time_local");
  nonEmpty(input.source, "source");
  nonEmpty(input.customerNameSnapshot, "customer_name_snapshot");
  return input;
}

export function validateBookingUpdate(input: BookingUpdateInputV1): BookingUpdateInputV1 {
  rejectClientScopeSpoof(input);
  boundedInteger(input.rowVersion, 1, Number.MAX_SAFE_INTEGER, "row_version");
  if (input.partySize !== undefined) boundedInteger(input.partySize, 1, 1000, "party_size");
  if (input.expectedDurationMinutes !== undefined) boundedInteger(input.expectedDurationMinutes, 15, 1440, "expected_duration_minutes");
  if (input.bookingDate !== undefined) validDate(input.bookingDate, "booking_date");
  if (input.bookingTimeLocal !== undefined) validTime(input.bookingTimeLocal, "booking_time_local");
  if (input.customerNameSnapshot !== undefined) nonEmpty(input.customerNameSnapshot, "customer_name_snapshot");
  return input;
}

export function validateStatusTransition(fromStatus: BookingStatus, input: BookingStatusTransitionInputV1): void {
  rejectClientScopeSpoof(input);
  boundedInteger(input.rowVersion, 1, Number.MAX_SAFE_INTEGER, "row_version");
  if (!BOOKING_STATUSES.includes(input.requestedStatus)) throw new AppError("VALIDATION_FAILED", "Unknown Booking status");
  if (!BOOKING_ALLOWED_TRANSITIONS[fromStatus].includes(input.requestedStatus)) {
    throw new AppError("CONFLICT", `Booking transition ${fromStatus} -> ${input.requestedStatus} is not allowed`);
  }
}
