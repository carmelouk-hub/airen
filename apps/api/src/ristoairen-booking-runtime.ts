// AB-04 compatibility surface only. Canonical AIRen Booking runtime ownership lives in airen-booking-runtime.ts.
export {
  RBL_BOOKING_TEST_COMPATIBILITY_ENTITLEMENT,
  createAirenBookingRuntime as createRistoBookingRuntime,
  loadAirenBookingRuntimeSwitches as loadRistoBookingRuntimeSwitches
} from "./airen-booking-runtime.ts";
export type {
  AirenBookingRuntime as RistoBookingRuntime,
  AirenBookingRuntimeSwitches as RistoBookingRuntimeSwitches
} from "./airen-booking-runtime.ts";
