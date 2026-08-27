import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { createRistoBookingRuntime, loadRistoBookingRuntimeSwitches } from "../../apps/api/src/ristoairen-booking-runtime.ts";
import { isRistoBookingApiRequest } from "../../apps/api/src/ristoairen-booking-api.ts";

test("RBL01-W01 Booking runtime switches default deny", () => {
  assert.deepEqual(loadRistoBookingRuntimeSwitches({}), {
    adapterEnabled: false,
    projectionEnabled: false,
    mutationEnabled: false
  });
});

test("RBL01-W02 child switches cannot bypass disabled adapter", () => {
  assert.throws(
    () => loadRistoBookingRuntimeSwitches({ RISTOAIREN_BOOKING_PROJECTION_ENABLED: "true" }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID"
  );
});

test("RBL01-W03 disabled composition returns fail-closed runtime without touching dependencies", async () => {
  const runtime = await createRistoBookingRuntime({
    environment: {},
    pool: null as never,
    authentication: null as never,
    foundationReads: null as never,
    tenantRepository: null as never,
    locationRepository: null as never,
    secretProvider: null as never,
    appBaseDomain: "ristoairen.test"
  });
  assert.equal(runtime.enabled, false);
  const result = await runtime.dispatch({ method: "GET", url: "/v1/ristoairen/bookings", hostname: "", headers: {} });
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: "PERMISSION_DENIED" });
});

test("RBL01-W04 production activation is forbidden in baseline 01", async () => {
  await assert.rejects(
    () => createRistoBookingRuntime({
      environment: { NODE_ENV: "production", RISTOAIREN_BOOKING_ADAPTER_ENABLED: "true" },
      pool: null as never,
      authentication: null as never,
      foundationReads: null as never,
      tenantRepository: null as never,
      locationRepository: null as never,
      secretProvider: null as never,
      appBaseDomain: "ristoairen.example"
    }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID"
  );
});

test("RBL01-W05 enabled non-production composition requires governed entitlement and key configuration", async () => {
  await assert.rejects(
    () => createRistoBookingRuntime({
      environment: { NODE_ENV: "test", RISTOAIREN_BOOKING_ADAPTER_ENABLED: "true" },
      pool: null as never,
      authentication: null as never,
      foundationReads: null as never,
      tenantRepository: null as never,
      locationRepository: null as never,
      secretProvider: null as never,
      appBaseDomain: "ristoairen.test"
    }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID"
  );
});

test("RBL01-W06 canonical Booking route remains the only wired vertical path prefix", () => {
  assert.equal(isRistoBookingApiRequest("/v1/ristoairen/bookings"), true);
  assert.equal(isRistoBookingApiRequest("/v1/ristoairen/bookings/booking-1"), true);
  assert.equal(isRistoBookingApiRequest("/v1/ristoairen/orders"), false);
});

test("RBL01-W07 Foundation HTTP server explicitly routes Booking through governed runtime composition", () => {
  const source = readFileSync(new URL("../../apps/api/src/server.ts", import.meta.url), "utf8");
  assert.match(source, /isRistoBookingApiRequest\(request\.url\)/);
  assert.match(source, /createRistoBookingRuntime/);
  assert.match(source, /bookingRuntime\.dispatch/);
  assert.match(source, /x-airen-service-assertion/);
  assert.match(source, /x-airen-correlation-id/);
  assert.match(source, /ristoairen\.booking\.api/);
});
