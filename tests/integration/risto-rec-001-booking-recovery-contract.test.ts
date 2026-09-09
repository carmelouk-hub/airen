import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_DONOR_FORBIDDEN_FIELDS,
  REC001_BOOKING_RECOVERY_EVIDENCE,
  mapDonorBookingStatus,
  recoverBookingCreateIntent,
} from "../../packages/ristoairen/src/booking/donor-recovery.ts";

test("REC-001 maps portable booking intent without donor authority", () => {
  const recovered = recoverBookingCreateIntent({
    name: "Synthetic Guest",
    phone: "+39 000 0000000",
    guests: "4",
    date: "2026-10-10",
    time: "20:30",
    source: "online",
    experience_type: "cena",
    notes: "synthetic fixture",
    zone: "rooftop",
    table_label: "T12",
    status: "pending",
  });

  assert.equal(recovered.input.customerNameSnapshot, "Synthetic Guest");
  assert.equal(recovered.input.partySize, 4);
  assert.equal(recovered.input.bookingDate, "2026-10-10");
  assert.equal(recovered.input.bookingTimeLocal, "20:30");
  assert.equal(recovered.donorStatus, "PENDING");
  assert.equal("tenantId" in recovered.input, false);
  assert.equal("locationId" in recovered.input, false);
  assert.equal("customerProfileId" in recovered.input, false);
  assert.deepEqual(REC001_BOOKING_RECOVERY_EVIDENCE.acceptanceTests, ["GJ2-003", "GJ2-004", "GJ2-032", "GJ2-034"]);
});

test("REC-001 rejects donor tenant/location/provider/entity authority", () => {
  for (const field of BOOKING_DONOR_FORBIDDEN_FIELDS) {
    assert.throws(
      () => recoverBookingCreateIntent({
        name: "Synthetic Guest",
        phone: "+39 000 0000000",
        guests: 2,
        date: "2026-10-10",
        time: "20:30",
        [field]: "legacy-authority",
      }),
      new RegExp(`REC001_FORBIDDEN_DONOR_AUTHORITY:${field}`),
    );
  }
});

test("REC-001 normalizes only supported legacy booking statuses", () => {
  assert.equal(mapDonorBookingStatus("pending"), "PENDING");
  assert.equal(mapDonorBookingStatus("confirmed"), "CONFIRMED");
  assert.equal(mapDonorBookingStatus("cancelled"), "CANCELLED");
  assert.equal(mapDonorBookingStatus("no_show"), "NO_SHOW");
  assert.equal(mapDonorBookingStatus("legacy_unknown"), undefined);
});
