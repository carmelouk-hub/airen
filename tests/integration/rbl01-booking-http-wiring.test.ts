import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import {
  createAirenBookingRuntime,
  loadAirenBookingRuntimeSwitches
} from "../../apps/api/src/airen-booking-runtime.ts";
import {
  AIREN_BOOKING_API_PREFIX,
  RISTOAIREN_BOOKING_COMPATIBILITY_API_PREFIX,
  isAirenBookingApiRequest,
  isAirenBookingCanonicalApiRequest,
  isRistoAirenBookingCompatibilityApiRequest
} from "../../apps/api/src/airen-booking-api.ts";
import { isRistoBookingApiRequest } from "../../apps/api/src/ristoairen-booking-api.ts";

test("RBL01-W01 AIRen Booking runtime switches default deny", () => {
  assert.deepEqual(loadAirenBookingRuntimeSwitches({}), {
    adapterEnabled: false,
    projectionEnabled: false,
    mutationEnabled: false
  });
});

test("RBL01-W02 canonical child switches cannot bypass disabled adapter", () => {
  assert.throws(
    () => loadAirenBookingRuntimeSwitches({ AIREN_BOOKING_PROJECTION_ENABLED: "true" }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID"
  );
});

test("RBL01-W03 disabled canonical composition serves fail-closed /v1/bookings without touching dependencies", async () => {
  const runtime = await createAirenBookingRuntime({
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
  const result = await runtime.dispatch({ method: "GET", url: AIREN_BOOKING_API_PREFIX, hostname: "", headers: {} });
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: "PERMISSION_DENIED" });
});

test("RBL01-W04 production activation is forbidden through canonical AIRen Booking env", async () => {
  await assert.rejects(
    () => createAirenBookingRuntime({
      environment: { NODE_ENV: "production", AIREN_BOOKING_ADAPTER_ENABLED: "true" },
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

test("RBL01-W05 enabled canonical composition requires governed entitlement and key configuration", async () => {
  await assert.rejects(
    () => createAirenBookingRuntime({
      environment: { NODE_ENV: "test", AIREN_BOOKING_ADAPTER_ENABLED: "true" },
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

test("RBL01-W06 canonical and compatibility routes are explicit and prefix-safe", () => {
  assert.equal(AIREN_BOOKING_API_PREFIX, "/v1/bookings");
  assert.equal(RISTOAIREN_BOOKING_COMPATIBILITY_API_PREFIX, "/v1/ristoairen/bookings");
  assert.equal(isAirenBookingCanonicalApiRequest("/v1/bookings"), true);
  assert.equal(isAirenBookingCanonicalApiRequest("/v1/bookings/booking-1"), true);
  assert.equal(isAirenBookingCanonicalApiRequest("/v1/bookings-evil"), false);
  assert.equal(isRistoAirenBookingCompatibilityApiRequest("/v1/ristoairen/bookings"), true);
  assert.equal(isAirenBookingApiRequest("/v1/ristoairen/bookings/booking-1"), true);
  assert.equal(isAirenBookingApiRequest("/v1/ristoairen/orders"), false);
});

test("RBL01-W07 legacy matcher is only a compatibility binding to the canonical router", () => {
  assert.equal(isRistoBookingApiRequest("/v1/bookings"), true);
  assert.equal(isRistoBookingApiRequest("/v1/ristoairen/bookings"), true);
  assert.equal(isRistoBookingApiRequest("/v1/ristoairen/orders"), false);
});

test("RBL01-W08 canonical and compatibility env aliases fail closed on disagreement", () => {
  assert.throws(
    () => loadAirenBookingRuntimeSwitches({
      AIREN_BOOKING_ADAPTER_ENABLED: "true",
      RISTOAIREN_BOOKING_ADAPTER_ENABLED: "false"
    }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID"
  );
});

test("RBL01-W09 Foundation HTTP server routes through the AB-04 compatibility binding into AIRen Booking authority", () => {
  const source = readFileSync(new URL("../../apps/api/src/server.ts", import.meta.url), "utf8");
  const apiCompatibility = readFileSync(new URL("../../apps/api/src/ristoairen-booking-api.ts", import.meta.url), "utf8");
  const runtimeCompatibility = readFileSync(new URL("../../apps/api/src/ristoairen-booking-runtime.ts", import.meta.url), "utf8");
  assert.match(source, /isRistoBookingApiRequest\(request\.url\)/);
  assert.match(source, /createRistoBookingRuntime/);
  assert.match(source, /bookingRuntime\.dispatch/);
  assert.match(source, /x-airen-service-assertion/);
  assert.match(source, /x-airen-correlation-id/);
  assert.match(apiCompatibility, /Canonical AIRen Booking API ownership lives in airen-booking-api\.ts/);
  assert.match(runtimeCompatibility, /Canonical AIRen Booking runtime ownership lives in airen-booking-runtime\.ts/);
});
