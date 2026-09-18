import type { SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { BookingStatus } from "../../../booking-core/src/contracts.ts";

export const AVAILABILITY_PERMISSION = "availability.read" as const;
export const AVAILABILITY_ENTITLEMENT = "availability.enabled" as const;
export const AVAILABILITY_CONSUMING_BOOKING_STATUSES = [
  "REQUESTED",
  "PENDING",
  "CONFIRMED",
  "ARRIVED",
  "SEATED"
] as const satisfies readonly BookingStatus[];
export const AVAILABILITY_MAX_CANDIDATES = 100 as const;

export type AvailabilityQueryInputV1 = Readonly<{
  bookingDate: string;
  partySize: number;
  expectedDurationMinutes: number;
  preferredTimeLocal?: string;
}>;

export type AvailabilityCandidateV1 = Readonly<{
  bookingDate: string;
  startsAtLocal: string;
  endsAtLocal: string;
}>;

export type AvailabilityQueryResultV1 = Readonly<{
  candidates: readonly AvailabilityCandidateV1[];
}>;

export type LocationAvailabilityServiceWindowV1 = Readonly<{
  serviceDate: string;
  startsAtLocal: string;
  endsAtLocal: string;
  reservableCapacityCovers: number;
  slotStepMinutes: number;
}>;

export type LocationAvailabilityPolicyV1 = Readonly<{
  tenantId: string;
  locationId: string;
  windows: readonly LocationAvailabilityServiceWindowV1[];
}>;

export interface LocationAvailabilityPolicyProvider {
  getPolicyForDate(
    context: SecurityContext,
    serviceDate: string
  ): Promise<LocationAvailabilityPolicyV1 | null>;
}

export interface CanonicalLocationTimeZoneProvider {
  getCanonicalTimeZone(context: SecurityContext): Promise<string | null>;
}

export type BookingOccupancyRecordV1 = Readonly<{
  status: BookingStatus;
  partySize: number;
  bookingDate: string;
  bookingTimeLocal: string;
  expectedDurationMinutes: number;
}>;

export interface AvailabilityBookingOccupancyReader {
  listConsumingBookings(
    context: SecurityContext,
    bookingDate: string
  ): Promise<readonly BookingOccupancyRecordV1[]>;
}
