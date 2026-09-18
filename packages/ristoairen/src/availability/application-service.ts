import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import {
  AVAILABILITY_MAX_CANDIDATES,
  type AvailabilityBookingOccupancyReader,
  type AvailabilityCandidateV1,
  type AvailabilityQueryInputV1,
  type AvailabilityQueryResultV1,
  type BookingOccupancyRecordV1,
  type CanonicalLocationTimeZoneProvider,
  type LocationAvailabilityPolicyProvider,
  type LocationAvailabilityServiceWindowV1
} from "./contracts.ts";
import {
  localTimeToMinutes,
  minutesToLocalTime,
  requireAvailabilityAccess,
  validateAvailabilityPolicy,
  validateAvailabilityQuery,
  validateLocationTimeZone
} from "./policy.ts";

export type AvailabilityApplicationDependencies = Readonly<{
  policyProvider: LocationAvailabilityPolicyProvider;
  timeZoneProvider: CanonicalLocationTimeZoneProvider;
  occupancyReader: AvailabilityBookingOccupancyReader;
}>;

export class AvailabilityApplicationService {
  private readonly policyProvider: LocationAvailabilityPolicyProvider;
  private readonly timeZoneProvider: CanonicalLocationTimeZoneProvider;
  private readonly occupancyReader: AvailabilityBookingOccupancyReader;

  constructor(dependencies: AvailabilityApplicationDependencies) {
    this.policyProvider = dependencies.policyProvider;
    this.timeZoneProvider = dependencies.timeZoneProvider;
    this.occupancyReader = dependencies.occupancyReader;
  }

  async query(
    context: SecurityContext,
    rawInput: AvailabilityQueryInputV1
  ): Promise<AvailabilityQueryResultV1> {
    requireAvailabilityAccess(context);
    const input = validateAvailabilityQuery(rawInput);
    validateLocationTimeZone(await this.timeZoneProvider.getCanonicalTimeZone(context));
    const policy = validateAvailabilityPolicy(
      context,
      await this.policyProvider.getPolicyForDate(context, input.bookingDate),
      input.bookingDate
    );
    const occupancy = await this.occupancyReader.listConsumingBookings(context, input.bookingDate);

    const candidates: AvailabilityCandidateV1[] = [];
    for (const window of policy.windows) {
      for (const candidate of generateCandidates(window, input.expectedDurationMinutes, input.bookingDate)) {
        if (hasCapacity(candidate, input.partySize, window.reservableCapacityCovers, occupancy)) {
          candidates.push(candidate);
          if (candidates.length === AVAILABILITY_MAX_CANDIDATES) {
            return Object.freeze({ candidates: Object.freeze(candidates) });
          }
        }
      }
    }
    return Object.freeze({ candidates: Object.freeze(candidates) });
  }
}

function generateCandidates(
  window: LocationAvailabilityServiceWindowV1,
  durationMinutes: number,
  bookingDate: string
): readonly AvailabilityCandidateV1[] {
  const start = localTimeToMinutes(window.startsAtLocal, "startsAtLocal");
  const end = localTimeToMinutes(window.endsAtLocal, "endsAtLocal");
  const result: AvailabilityCandidateV1[] = [];
  for (let current = start; current + durationMinutes <= end; current += window.slotStepMinutes) {
    result.push(Object.freeze({
      bookingDate,
      startsAtLocal: minutesToLocalTime(current),
      endsAtLocal: minutesToLocalTime(current + durationMinutes)
    }));
  }
  return Object.freeze(result);
}

function hasCapacity(
  candidate: AvailabilityCandidateV1,
  requestedPartySize: number,
  reservableCapacityCovers: number,
  occupancy: readonly BookingOccupancyRecordV1[]
): boolean {
  const candidateStart = localTimeToMinutes(candidate.startsAtLocal);
  const candidateEnd = localTimeToMinutes(candidate.endsAtLocal);
  const events = new Map<number, number>();

  for (const booking of occupancy) {
    if (booking.bookingDate !== candidate.bookingDate) continue;
    const bookingStart = localTimeToMinutes(booking.bookingTimeLocal);
    const bookingEnd = bookingStart + booking.expectedDurationMinutes;
    const overlapStart = Math.max(candidateStart, bookingStart);
    const overlapEnd = Math.min(candidateEnd, bookingEnd);
    if (overlapStart >= overlapEnd) continue;
    events.set(overlapStart, (events.get(overlapStart) ?? 0) + booking.partySize);
    events.set(overlapEnd, (events.get(overlapEnd) ?? 0) - booking.partySize);
  }

  let occupied = 0;
  for (const minute of [...events.keys()].sort((a, b) => a - b)) {
    occupied += events.get(minute) ?? 0;
    if (occupied + requestedPartySize > reservableCapacityCovers) return false;
  }
  return requestedPartySize <= reservableCapacityCovers;
}
