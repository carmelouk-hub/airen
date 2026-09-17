import { createHash, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { AppError } from "../../../packages/shared-contracts/src/index.ts";

const TOKEN_TYPE = "AIRENOS-VPC";
const TOKEN_ALGORITHM = "EdDSA";

export type AirenOsVerticalTrustedContext = Readonly<{
  issuer: string;
  audience: string;
  subjectId: string;
  actorId: string;
  tenantId: string;
  locationId: string;
  platformRoles: readonly string[];
  platformPermissions: readonly string[];
  entitlements: readonly string[];
  correlationId: string;
  clientRequestId?: string;
  requestBinding: string;
  issuedAt: number;
  expiresAt: number;
  jti: string;
  sessionMetadata?: Readonly<Record<string, unknown>>;
}>;

type TrustedContextPayload = Readonly<Record<string, unknown>>;
type VerificationKey = KeyObject | string | Buffer;

function authenticationFailure(message: string): never {
  throw new AppError("AUTHENTICATION_REQUIRED", message);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") authenticationFailure(`Trusted context ${field} is invalid`);
  return value.trim();
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    authenticationFailure(`Trusted context ${field} is invalid`);
  }
  return Object.freeze([...new Set((value as string[]).map((entry) => entry.trim()))].sort());
}

function decodeJson(segment: string): TrustedContextPayload {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) authenticationFailure("Trusted context payload is invalid");
    return parsed as TrustedContextPayload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    return authenticationFailure("Trusted context is malformed");
  }
}

function canonicalObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalObject((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function buildRistoVerticalRequestBinding(input: Readonly<{ method: string; operation: string; idempotencyKey?: string | null }>): string {
  const normalized = Object.freeze({
    method: requiredString(input.method, "request method").toUpperCase(),
    operation: requiredString(input.operation, "operation"),
    idempotency_key: input.idempotencyKey == null ? null : requiredString(input.idempotencyKey, "idempotency key")
  });
  return createHash("sha256").update(JSON.stringify(canonicalObject(normalized))).digest("base64url");
}

export function verifyAirenOsVerticalTrustedContext(input: Readonly<{
  token: string;
  publicKey: VerificationKey;
  issuer: string;
  audience: string;
  expectedRequestBinding: string;
  now?: number;
  clockSkewSeconds?: number;
}>): AirenOsVerticalTrustedContext {
  const token = requiredString(input.token, "token");
  const parts = token.split(".");
  if (parts.length !== 3) authenticationFailure("Trusted context is malformed");

  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header.alg !== TOKEN_ALGORITHM || header.typ !== TOKEN_TYPE) authenticationFailure("Trusted context header is invalid");

  let signature: Buffer;
  try { signature = Buffer.from(parts[2], "base64url"); }
  catch { return authenticationFailure("Trusted context signature is malformed"); }
  const signingInput = `${parts[0]}.${parts[1]}`;
  if (!cryptoVerify(null, Buffer.from(signingInput), input.publicKey, signature)) authenticationFailure("Trusted context signature is invalid");

  const issuer = requiredString(payload.iss, "issuer");
  const audience = requiredString(payload.aud, "audience");
  if (issuer !== requiredString(input.issuer, "expected issuer")) authenticationFailure("Trusted context issuer mismatch");
  if (audience !== requiredString(input.audience, "expected audience")) authenticationFailure("Trusted context audience mismatch");

  const issuedAt = payload.iat;
  const expiresAt = payload.exp;
  if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt) || Number(expiresAt) <= Number(issuedAt)) authenticationFailure("Trusted context time window is invalid");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const skew = input.clockSkewSeconds ?? 5;
  if (!Number.isInteger(skew) || skew < 0 || skew > 60) authenticationFailure("Trusted context clock skew policy is invalid");
  if (Number(issuedAt) > now + skew) authenticationFailure("Trusted context is not yet valid");
  if (Number(expiresAt) <= now - skew) authenticationFailure("Trusted context is expired");

  const requestBinding = requiredString(payload.request_binding, "request binding");
  if (requestBinding !== requiredString(input.expectedRequestBinding, "expected request binding")) authenticationFailure("Trusted context request binding mismatch");

  const session = payload.session;
  if (session != null && (!session || typeof session !== "object" || Array.isArray(session))) authenticationFailure("Trusted context session metadata is invalid");

  return Object.freeze({
    issuer,
    audience,
    subjectId: requiredString(payload.sub, "subject"),
    actorId: requiredString(payload.actor, "actor"),
    tenantId: requiredString(payload.tenant_id, "tenant"),
    locationId: requiredString(payload.location_id, "location"),
    platformRoles: stringArray(payload.platform_roles, "platform roles"),
    platformPermissions: stringArray(payload.platform_permissions, "platform permissions"),
    entitlements: stringArray(payload.entitlements, "entitlements"),
    correlationId: requiredString(payload.correlation_id, "correlation id"),
    clientRequestId: payload.client_request_id == null ? undefined : requiredString(payload.client_request_id, "client request id"),
    requestBinding,
    issuedAt: Number(issuedAt),
    expiresAt: Number(expiresAt),
    jti: requiredString(payload.jti, "jti"),
    sessionMetadata: session == null ? undefined : Object.freeze({ ...(session as Record<string, unknown>) })
  });
}
