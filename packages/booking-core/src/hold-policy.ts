import { AppError, type SecurityContext } from "../../shared-contracts/src/index.ts";
import { requirePermission } from "../../authorization/src/index.ts";
import { BOOKING_PERMISSIONS } from "./policy.ts";
import {
  BOOKING_GUARANTEE_MODES,
  BOOKING_HOLD_STATUSES,
  type BookingGuaranteeMode,
  type BookingGuaranteePolicyProjectionV1,
  type BookingHoldCancelInputV1,
  type BookingHoldCreateInputV1,
  type BookingHoldPrivateProjectionV1,
  type BookingHoldStatus
} from "./hold-contracts.ts";

export const BOOKING_HOLD_ALLOWED_TRANSITIONS: Readonly<Record<BookingHoldStatus, readonly BookingHoldStatus[]>> = Object.freeze({
  CREATED: ["GUARANTEE_REQUIRED", "GUARANTEED", "CANCELLED", "EXPIRED", "FAILED"],
  GUARANTEE_REQUIRED: ["GUARANTEE_PENDING", "CANCELLED", "EXPIRED", "FAILED"],
  GUARANTEE_PENDING: ["GUARANTEED", "CANCELLED", "EXPIRED", "FAILED"],
  GUARANTEED: ["CONVERTED", "CANCELLED", "EXPIRED", "FAILED"],
  CONVERTED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: []
});

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
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError("VALIDATION_FAILED", `${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function requireBookingHoldCreate(context: SecurityContext): void {
  requirePermission(context, BOOKING_PERMISSIONS.create);
}

export function requireBookingHoldCancel(context: SecurityContext): void {
  requirePermission(context, BOOKING_PERMISSIONS.update);
}

export function requireBookingHoldConvert(context: SecurityContext): void {
  requirePermission(context, BOOKING_PERMISSIONS.create);
}

export function validateBookingHoldCreate(input: BookingHoldCreateInputV1): BookingHoldCreateInputV1 {
  rejectClientScopeSpoof(input);
  boundedInteger(input.partySize, 1, 1000, "party_size");
  if (input.capacityClaim !== undefined) boundedInteger(input.capacityClaim, 1, 1000, "capacity_claim");
  if (input.capacityClaim !== undefined && input.capacityClaim < input.partySize) {
    throw new AppError("VALIDATION_FAILED", "capacity_claim must not be smaller than party_size");
  }
  boundedInteger(input.expectedDurationMinutes, 15, 1440, "expected_duration_minutes");
  validDate(input.bookingDate, "booking_date");
  validTime(input.bookingTimeLocal, "booking_time_local");
  nonEmpty(input.sourceChannel, "source_channel");
  nonEmpty(input.resourceKey, "resource_key");
  nonEmpty(input.customerNameSnapshot, "customer_name_snapshot");
  return Object.freeze({ ...input, capacityClaim: input.capacityClaim ?? input.partySize });
}

export function validateBookingHoldCancel(input: BookingHoldCancelInputV1): BookingHoldCancelInputV1 {
  rejectClientScopeSpoof(input);
  boundedInteger(input.rowVersion, 1, Number.MAX_SAFE_INTEGER, "row_version");
  if (input.reason !== undefined && !input.reason.trim()) throw new AppError("VALIDATION_FAILED", "reason must not be blank");
  return input;
}

function policyMatches(policy: BookingGuaranteePolicyProjectionV1, input: BookingHoldCreateInputV1): boolean {
  if (policy.status !== "active") return false;
  if (!BOOKING_GUARANTEE_MODES.includes(policy.guaranteeMode)) return false;
  if (policy.sourceChannel && policy.sourceChannel !== input.sourceChannel) return false;
  if (policy.resourceKey && policy.resourceKey !== input.resourceKey) return false;
  if (policy.minPartySize !== undefined && input.partySize < policy.minPartySize) return false;
  if (policy.maxPartySize !== undefined && input.partySize > policy.maxPartySize) return false;
  if (policy.effectiveFrom && input.bookingDate < policy.effectiveFrom) return false;
  if (policy.effectiveUntil && input.bookingDate > policy.effectiveUntil) return false;
  return true;
}

export function selectBookingGuaranteePolicy(
  candidates: readonly BookingGuaranteePolicyProjectionV1[],
  input: BookingHoldCreateInputV1
): BookingGuaranteePolicyProjectionV1 {
  const matches = candidates.filter((policy) => policyMatches(policy, input));
  if (!matches.length) throw new AppError("CONFLICT", "BOOKING_GUARANTEE_POLICY_NOT_CONFIGURED");
  const ordered = [...matches].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  if (ordered.length > 1 && ordered[0].priority === ordered[1].priority) {
    throw new AppError("CONFLICT", "BOOKING_GUARANTEE_POLICY_AMBIGUOUS");
  }
  const selected = ordered[0];
  boundedInteger(selected.holdDurationSeconds, 30, 3600, "hold_duration_seconds");
  boundedInteger(selected.priority, 0, 1000000, "priority");
  return selected;
}

export function initialBookingHoldStatus(guaranteeMode: BookingGuaranteeMode): BookingHoldStatus {
  if (!BOOKING_GUARANTEE_MODES.includes(guaranteeMode)) throw new AppError("VALIDATION_FAILED", "Unknown Booking guarantee mode");
  return guaranteeMode === "NONE" ? "GUARANTEED" : "GUARANTEE_REQUIRED";
}

export function validateBookingHoldTransition(fromStatus: BookingHoldStatus, toStatus: BookingHoldStatus): void {
  if (!BOOKING_HOLD_STATUSES.includes(fromStatus) || !BOOKING_HOLD_STATUSES.includes(toStatus)) {
    throw new AppError("VALIDATION_FAILED", "Unknown BookingHold status");
  }
  if (!BOOKING_HOLD_ALLOWED_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new AppError("CONFLICT", `BookingHold transition ${fromStatus} -> ${toStatus} is not allowed`);
  }
}

export function assertBookingHoldConvertible(hold: BookingHoldPrivateProjectionV1, now = new Date()): void {
  if (hold.status !== "GUARANTEED") throw new AppError("CONFLICT", "BookingHold must be GUARANTEED before conversion");
  if (new Date(hold.expiresAt).getTime() <= now.getTime()) throw new AppError("CONFLICT", "Expired BookingHold cannot be converted");
  if (hold.conversionBookingId) throw new AppError("CONFLICT", "BookingHold has already been converted");
}
