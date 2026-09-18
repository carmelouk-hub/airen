import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import type {
  BookingPrivateListResultV1,
  BookingPrivateProjectionV1,
  BookingQueryInputV1,
  BookingReadRepository
} from "../../packages/booking-core/src/contracts.ts";
import {
  AVAILABILITY_ENTITLEMENT,
  AVAILABILITY_PERMISSION,
  type CanonicalLocationTimeZoneProvider,
  type LocationAvailabilityPolicyProvider,
  type LocationAvailabilityPolicyV1
} from "../../packages/ristoairen/src/availability/contracts.ts";
import { AvailabilityApplicationService } from "../../packages/ristoairen/src/availability/application-service.ts";
import { CanonicalBookingOccupancyReader } from "../../packages/ristoairen/src/availability/booking-occupancy-reader.ts";

const TENANT = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "a0000000-0000-4000-8000-000000000002";

function context(overrides: Partial<SecurityContext> = {}): SecurityContext {
  return Object.freeze({
    correlationId: "avail-source-098",
    actorIdentityId: "a0000000-0000-4000-8000-000000000003",
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    permissions: [AVAILABILITY_PERMISSION],
    entitlements: [AVAILABILITY_ENTITLEMENT],
    ...overrides
  });
}

function booking(
  id: string,
  status: BookingPrivateProjectionV1["status"],
  bookingTimeLocal: string,
  expectedDurationMinutes: number,
  partySize: number,
  bookingDate = "2026-09-25"
): BookingPrivateProjectionV1 {
  return Object.freeze({
    id,
    status,
    partySize,
    bookingDate,
    bookingTimeLocal,
    startsAt: `${bookingDate}T${bookingTimeLocal}:00+02:00`,
    expectedDurationMinutes,
    source: "SYNTHETIC",
    customerNameSnapshot: "Synthetic",
    createdAt: "2026-09-18T00:00:00Z",
    updatedAt: "2026-09-18T00:00:00Z",
    rowVersion: 1
  });
}

class InMemoryBookingRepository implements BookingReadRepository {
  readonly queries: BookingQueryInputV1[] = [];
  constructor(private readonly rows: readonly BookingPrivateProjectionV1[]) {}
  async query(_context: SecurityContext, input: BookingQueryInputV1): Promise<BookingPrivateListResultV1> {
    this.queries.push(input);
    const allowed = new Set(input.statuses ?? []);
    const filtered = this.rows.filter((row) =>
      (!input.fromDate || row.bookingDate >= input.fromDate) &&
      (!input.toDate || row.bookingDate <= input.toDate) &&
      (!input.statuses || allowed.has(row.status))
    );
    return Object.freeze({ items: Object.freeze(filtered) });
  }
  async findVisibleById(): Promise<BookingPrivateProjectionV1 | null> { return null; }
}

function policyProvider(policy: LocationAvailabilityPolicyV1): LocationAvailabilityPolicyProvider {
  return Object.freeze({ async getPolicyForDate() { return policy; } });
}
const timeZoneProvider: CanonicalLocationTimeZoneProvider = Object.freeze({
  async getCanonicalTimeZone() { return "Europe/Rome"; }
});

function policy(overrides: Partial<LocationAvailabilityPolicyV1> = {}): LocationAvailabilityPolicyV1 {
  return Object.freeze({
    tenantId: TENANT,
    locationId: LOCATION,
    windows: Object.freeze([Object.freeze({
      serviceDate: "2026-09-25",
      startsAtLocal: "18:00",
      endsAtLocal: "22:00",
      reservableCapacityCovers: 6,
      slotStepMinutes: 30
    })]),
    ...overrides
  });
}

function service(rows: readonly BookingPrivateProjectionV1[], p = policy()): AvailabilityApplicationService {
  return new AvailabilityApplicationService({
    policyProvider: policyProvider(p),
    timeZoneProvider,
    occupancyReader: new CanonicalBookingOccupancyReader(new InMemoryBookingRepository(rows))
  });
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

test("Gate098 source slice generates deterministic ordered candidate slots", async () => {
  const result = await service([]).query(context(), {
    bookingDate: "2026-09-25",
    partySize: 2,
    expectedDurationMinutes: 60
  });
  assert.deepEqual(result.candidates.slice(0, 3), [
    { bookingDate: "2026-09-25", startsAtLocal: "18:00", endsAtLocal: "19:00" },
    { bookingDate: "2026-09-25", startsAtLocal: "18:30", endsAtLocal: "19:30" },
    { bookingDate: "2026-09-25", startsAtLocal: "19:00", endsAtLocal: "20:00" }
  ]);
  const replay = await service([]).query(context(), {
    bookingDate: "2026-09-25",
    partySize: 2,
    expectedDurationMinutes: 60
  });
  assert.deepEqual(replay, result);
});

test("overlapping consuming Booking removes only conflicting candidates", async () => {
  const rows = [booking("a0000000-0000-4000-8000-000000000010", "CONFIRMED", "19:00", 60, 5)];
  const result = await service(rows).query(context(), {
    bookingDate: "2026-09-25",
    partySize: 2,
    expectedDurationMinutes: 60
  });
  assert.equal(result.candidates.some((c) => c.startsAtLocal === "18:00"), true);
  assert.equal(result.candidates.some((c) => c.startsAtLocal === "18:30"), false);
  assert.equal(result.candidates.some((c) => c.startsAtLocal === "19:00"), false);
  assert.equal(result.candidates.some((c) => c.startsAtLocal === "19:30"), false);
  assert.equal(result.candidates.some((c) => c.startsAtLocal === "20:00"), true);
});

test("non-consuming Booking statuses do not consume Availability", async () => {
  const rows = [booking("a0000000-0000-4000-8000-000000000011", "CANCELLED", "19:00", 120, 6)];
  const result = await service(rows).query(context(), {
    bookingDate: "2026-09-25",
    partySize: 6,
    expectedDurationMinutes: 60
  });
  assert.equal(result.candidates.some((c) => c.startsAtLocal === "19:00"), true);
});

test("permission and entitlement remain separate and platform permission cannot grant domain access", async () => {
  const base = service([]);
  await assert.rejects(
    base.query(context({ permissions: [], platformPermissions: [AVAILABILITY_PERMISSION] }), {
      bookingDate: "2026-09-25", partySize: 2, expectedDurationMinutes: 60
    }),
    hasCode("PERMISSION_DENIED")
  );
  await assert.rejects(
    base.query(context({ entitlements: [] }), {
      bookingDate: "2026-09-25", partySize: 2, expectedDurationMinutes: 60
    }),
    hasCode("ENTITLEMENT_REQUIRED")
  );
});

test("policy bounds and scope fail closed", async () => {
  await assert.rejects(
    service([], policy({ windows: [{ serviceDate: "2026-09-25", startsAtLocal: "18:00", endsAtLocal: "22:00", reservableCapacityCovers: 1001, slotStepMinutes: 30 }] }))
      .query(context(), { bookingDate: "2026-09-25", partySize: 2, expectedDurationMinutes: 60 }),
    hasCode("VALIDATION_FAILED")
  );
  await assert.rejects(
    service([], policy({ locationId: "a0000000-0000-4000-8000-000000000099" }))
      .query(context(), { bookingDate: "2026-09-25", partySize: 2, expectedDurationMinutes: 60 }),
    hasCode("LOCATION_SCOPE_VIOLATION")
  );
  await assert.rejects(
    service([], policy({ windows: [{ serviceDate: "2026-09-25", startsAtLocal: "18:00", endsAtLocal: "22:00", reservableCapacityCovers: 10, slotStepMinutes: 7 }] }))
      .query(context(), { bookingDate: "2026-09-25", partySize: 2, expectedDurationMinutes: 60 }),
    hasCode("RUNTIME_CONFIGURATION_INVALID")
  );
});

test("candidate result count is capped at 100 after filtering", async () => {
  const p = policy({ windows: [Object.freeze({
    serviceDate: "2026-09-25",
    startsAtLocal: "00:00",
    endsAtLocal: "23:59",
    reservableCapacityCovers: 1000,
    slotStepMinutes: 5
  })] });
  const result = await service([], p).query(context(), {
    bookingDate: "2026-09-25",
    partySize: 1,
    expectedDurationMinutes: 15
  });
  assert.equal(result.candidates.length, 100);
  assert.equal(result.candidates[0].startsAtLocal, "00:00");
  assert.equal(result.candidates[99].startsAtLocal, "08:15");
});
