import {
  dispatchRistoBookingApiRequest as dispatchLegacyBookingApiRequest,
  EdDsaServiceAssertionVerifier,
  InMemoryBookingRateLimiter,
  type BookingApiDependencies,
  type BookingApiRequest,
  type BookingApiResult
} from "./airen-booking-api-core.ts";

export const AIREN_BOOKING_API_PREFIX = "/v1/bookings" as const;
export const RISTOAIREN_BOOKING_COMPATIBILITY_API_PREFIX = "/v1/ristoairen/bookings" as const;

export type AirenBookingApiRequest = BookingApiRequest;
export type AirenBookingApiResult = BookingApiResult;
export type AirenBookingApiDependencies = BookingApiDependencies;
export { EdDsaServiceAssertionVerifier, InMemoryBookingRateLimiter };

function isPathWithin(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function parsedUrl(url: string | undefined): URL | null {
  if (!url) return null;
  try { return new URL(url, "https://airenos.invalid"); } catch { return null; }
}

export function isAirenBookingCanonicalApiRequest(url: string | undefined): boolean {
  const parsed = parsedUrl(url);
  return parsed !== null && isPathWithin(parsed.pathname, AIREN_BOOKING_API_PREFIX);
}

export function isRistoAirenBookingCompatibilityApiRequest(url: string | undefined): boolean {
  const parsed = parsedUrl(url);
  return parsed !== null && isPathWithin(parsed.pathname, RISTOAIREN_BOOKING_COMPATIBILITY_API_PREFIX);
}

export function isAirenBookingApiRequest(url: string | undefined): boolean {
  return isAirenBookingCanonicalApiRequest(url) || isRistoAirenBookingCompatibilityApiRequest(url);
}

function canonicalRequestToCompatibilityUrl(url: string): string {
  const parsed = parsedUrl(url);
  if (!parsed || !isPathWithin(parsed.pathname, AIREN_BOOKING_API_PREFIX)) return url;
  const suffix = parsed.pathname.slice(AIREN_BOOKING_API_PREFIX.length);
  return `${RISTOAIREN_BOOKING_COMPATIBILITY_API_PREFIX}${suffix}${parsed.search}`;
}

export async function dispatchAirenBookingApiRequest(
  request: AirenBookingApiRequest,
  deps: AirenBookingApiDependencies
): Promise<AirenBookingApiResult> {
  return dispatchLegacyBookingApiRequest(
    Object.freeze({ ...request, url: canonicalRequestToCompatibilityUrl(request.url) }),
    deps
  );
}
