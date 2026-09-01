import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import {
  RBL_BOOKING_TEST_COMPATIBILITY_ENTITLEMENT,
  createRistoBookingRuntime as createBookingRuntimeCore,
  loadRistoBookingRuntimeSwitches as loadBookingRuntimeSwitchesCore,
  type RistoBookingRuntime,
  type RistoBookingRuntimeSwitches
} from "./airen-booking-runtime-core.ts";

export { RBL_BOOKING_TEST_COMPATIBILITY_ENTITLEMENT };
export type AirenBookingRuntime = RistoBookingRuntime;
export type AirenBookingRuntimeSwitches = RistoBookingRuntimeSwitches;

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

const ENV_ALIASES = Object.freeze([
  ["AIREN_BOOKING_ADAPTER_ENABLED", "RISTOAIREN_BOOKING_ADAPTER_ENABLED"],
  ["AIREN_BOOKING_PROJECTION_ENABLED", "RISTOAIREN_BOOKING_PROJECTION_ENABLED"],
  ["AIREN_BOOKING_MUTATION_ENABLED", "RISTOAIREN_BOOKING_MUTATION_ENABLED"],
  ["AIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON", "RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON"],
  ["AIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF", "RISTOAIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF"],
  ["AIREN_BOOKING_REQUIRED_ENTITLEMENT", "RISTOAIREN_BOOKING_REQUIRED_ENTITLEMENT"]
] as const);

function normalizedAirenBookingEnvironment(environment: EnvironmentInput): EnvironmentInput {
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

export function loadAirenBookingRuntimeSwitches(environment: EnvironmentInput): AirenBookingRuntimeSwitches {
  return loadBookingRuntimeSwitchesCore(normalizedAirenBookingEnvironment(environment));
}

export async function createAirenBookingRuntime(
  input: Parameters<typeof createBookingRuntimeCore>[0]
): Promise<AirenBookingRuntime> {
  return createBookingRuntimeCore(Object.freeze({
    ...input,
    environment: normalizedAirenBookingEnvironment(input.environment)
  }));
}
