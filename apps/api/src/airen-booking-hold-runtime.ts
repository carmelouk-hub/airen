import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import {
  BookingHoldOrchestrationBoundary,
  createRistoBookingHoldRuntime as createBookingHoldRuntimeCore,
  loadRistoBookingHoldRuntimeSwitches as loadBookingHoldRuntimeSwitchesCore,
  type BookingHoldExpiryScopeProvider,
  type BookingHoldLifecyclePort,
  type RistoBookingHoldInternalRuntime,
  type RistoBookingHoldRuntimeSwitches
} from "./airen-booking-hold-runtime-core.ts";

export { BookingHoldOrchestrationBoundary };
export type { BookingHoldExpiryScopeProvider, BookingHoldLifecyclePort };
export type AirenBookingHoldInternalRuntime = RistoBookingHoldInternalRuntime;
export type AirenBookingHoldRuntimeSwitches = RistoBookingHoldRuntimeSwitches;

type EnvironmentInput = Readonly<Record<string, string | undefined>>;
const ENV_ALIASES = Object.freeze([
  ["AIREN_BOOKING_HOLD_RUNTIME_ENABLED", "RISTOAIREN_BOOKING_HOLD_RUNTIME_ENABLED"],
  ["AIREN_BOOKING_HOLD_EXPIRY_WORKER_ENABLED", "RISTOAIREN_BOOKING_HOLD_EXPIRY_WORKER_ENABLED"],
  ["AIREN_BOOKING_HOLD_EXPIRY_INTERVAL_SECONDS", "RISTOAIREN_BOOKING_HOLD_EXPIRY_INTERVAL_SECONDS"],
  ["AIREN_BOOKING_HOLD_EXPIRY_BATCH_LIMIT", "RISTOAIREN_BOOKING_HOLD_EXPIRY_BATCH_LIMIT"]
] as const);

function normalizedAirenBookingHoldEnvironment(environment: EnvironmentInput): EnvironmentInput {
  const normalized: Record<string, string | undefined> = { ...environment };
  for (const [canonicalKey, compatibilityKey] of ENV_ALIASES) {
    const canonical = environment[canonicalKey]?.trim();
    const compatibility = environment[compatibilityKey]?.trim();
    if (canonical && compatibility && canonical !== compatibility) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", `${canonicalKey} conflicts with compatibility alias ${compatibilityKey}`, { field: canonicalKey });
    }
    if (canonical) normalized[compatibilityKey] = canonical;
  }
  return Object.freeze(normalized);
}

export function loadAirenBookingHoldRuntimeSwitches(environment: EnvironmentInput): AirenBookingHoldRuntimeSwitches {
  return loadBookingHoldRuntimeSwitchesCore(normalizedAirenBookingHoldEnvironment(environment));
}

export function createAirenBookingHoldRuntime(
  input: Parameters<typeof createBookingHoldRuntimeCore>[0]
): AirenBookingHoldInternalRuntime {
  return createBookingHoldRuntimeCore(Object.freeze({
    ...input,
    environment: normalizedAirenBookingHoldEnvironment(input.environment)
  }));
}
