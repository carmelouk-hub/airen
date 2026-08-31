import { AppError } from "../../../shared-contracts/src/index.ts";

export type AirenPayAuthorizationWindowDecisionV1 = Readonly<{
  authorizationExpiresAt: string;
  serviceStartsAt: string;
  compatible: true;
}>;

function parseIsoInstant(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new AppError("VALIDATION_FAILED", `${field} must be a valid ISO timestamp`);
  return parsed;
}

export function assertAirenPayAuthorizationWindowCompatible(
  authorizationExpiresAt: string | undefined,
  serviceStartsAt: string
): AirenPayAuthorizationWindowDecisionV1 {
  if (!authorizationExpiresAt) {
    throw new AppError("CONFLICT", "AUTHORIZATION_EXPIRY_UNAVAILABLE");
  }
  const expiresAtMs = parseIsoInstant(authorizationExpiresAt, "authorization_expires_at");
  const serviceStartsAtMs = parseIsoInstant(serviceStartsAt, "service_starts_at");
  if (expiresAtMs <= serviceStartsAtMs) {
    throw new AppError("CONFLICT", "AUTHORIZATION_EXPIRES_BEFORE_SERVICE");
  }
  return Object.freeze({ authorizationExpiresAt, serviceStartsAt, compatible: true });
}
