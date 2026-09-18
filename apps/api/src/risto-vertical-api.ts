import { AppError, type AppErrorCode } from "../../../packages/shared-contracts/src/index.ts";
import type { BookingCreateInputV1 } from "../../../packages/booking-core/src/contracts.ts";
import { BookingApplicationService } from "../../../packages/booking-core/src/application-service.ts";
import type { MembershipRepository, RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import type { LocationRepository, TenantRepository } from "../../../packages/tenant/src/index.ts";
import { buildRistoVerticalSecurityContext } from "./risto-vertical-security-context.ts";
import { buildRistoVerticalRequestBinding, verifyAirenOsVerticalTrustedContext } from "./risto-vertical-trusted-context.ts";

export type RistoVerticalApiRequest = Readonly<{
  method: string;
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
  body?: unknown;
}>;

export type RistoVerticalApiResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
}>;

type VerificationKey = Parameters<typeof verifyAirenOsVerticalTrustedContext>[0]["publicKey"];

function response(status: number, body: Readonly<Record<string, unknown>>, correlationId?: string): RistoVerticalApiResponse {
  return Object.freeze({
    status,
    body,
    headers: Object.freeze({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(correlationId ? { "x-correlation-id": correlationId } : {}),
    }),
  });
}

function errorStatus(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_FAILED": return 400;
    case "AUTHENTICATION_REQUIRED": return 401;
    case "TENANT_RESOLUTION_FAILED":
    case "NOT_FOUND": return 404;
    case "MEMBERSHIP_REQUIRED":
    case "LOCATION_MEMBERSHIP_REQUIRED":
    case "PERMISSION_DENIED":
    case "ENTITLEMENT_REQUIRED":
    case "TENANT_SCOPE_VIOLATION":
    case "LOCATION_SCOPE_VIOLATION": return 403;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT": return 409;
    default: return 500;
  }
}

function mapError(error: unknown): RistoVerticalApiResponse {
  if (error instanceof AppError) {
    const status = errorStatus(error.code);
    return response(status, Object.freeze({
      ok: false,
      code: status >= 500 ? "INTERNAL_ERROR" : error.code,
      message: status >= 500 ? "Vertical request failed" : error.message,
    }));
  }
  return response(500, Object.freeze({ ok: false, code: "INTERNAL_ERROR", message: "Vertical request failed" }));
}

function requiredHeader(request: RistoVerticalApiRequest, name: string): string {
  const direct = request.headers[name];
  const lower = request.headers[name.toLowerCase()];
  const value = (direct ?? lower)?.trim();
  if (!value) throw new AppError("VALIDATION_FAILED", `MISSING_${name.toUpperCase().replaceAll("-", "_")}`);
  return value;
}

function bookingCreateInput(body: unknown): BookingCreateInputV1 {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("VALIDATION_FAILED", "INVALID_BOOKING_BODY");
  }
  const value = body as Record<string, unknown>;
  for (const key of ["tenantId", "tenant_id", "locationId", "location_id", "actorId", "actor_id", "permissions", "entitlements"]) {
    if (Object.hasOwn(value, key)) throw new AppError("TENANT_SCOPE_VIOLATION", "CLIENT_AUTHORITY_FIELD_FORBIDDEN");
  }
  return Object.freeze({
    source: (value.source ?? "VERTICAL_PILOT") as string,
    partySize: value.partySize as number,
    bookingDate: value.bookingDate as string,
    bookingTimeLocal: value.bookingTimeLocal as string,
    expectedDurationMinutes: value.expectedDurationMinutes as number,
    customerNameSnapshot: value.customerNameSnapshot as string,
    ...(value.customerProfileId === undefined ? {} : { customerProfileId: value.customerProfileId as string }),
    ...(value.eventId === undefined ? {} : { eventId: value.eventId as string }),
    ...(value.zoneId === undefined ? {} : { zoneId: value.zoneId as string }),
    ...(value.tableId === undefined ? {} : { tableId: value.tableId as string }),
    ...(value.externalReference === undefined ? {} : { externalReference: value.externalReference as string }),
    ...(value.phoneSnapshot === undefined ? {} : { phoneSnapshot: value.phoneSnapshot as string }),
    ...(value.emailSnapshot === undefined ? {} : { emailSnapshot: value.emailSnapshot as string }),
    ...(value.notes === undefined ? {} : { notes: value.notes as string }),
    ...(value.specialRequests === undefined ? {} : { specialRequests: value.specialRequests as string }),
  });
}

export function createRistoVerticalApi(input: Readonly<{
  publicKey: VerificationKey;
  issuer: string;
  audience: string;
  tenants: TenantRepository;
  locations: LocationRepository;
  memberships: MembershipRepository;
  roles: RolePermissionResolver;
  booking: BookingApplicationService;
  now?: () => number;
}>): (request: RistoVerticalApiRequest) => Promise<RistoVerticalApiResponse> {
  return async (request) => {
    try {
      const url = new URL(request.url, "http://ristoairen.local");
      const method = request.method.toUpperCase();

      if (method === "GET" && url.pathname === "/health/ready") {
        return response(200, Object.freeze({ ok: true, service: "ristoairen-vertical-fixture" }));
      }

      if (method !== "POST" || url.pathname !== "/v1/bookings") {
        return response(404, Object.freeze({ ok: false, code: "VERTICAL_ROUTE_NOT_ALLOWED" }));
      }

      const idempotencyKey = requiredHeader(request, "idempotency-key");
      const token = requiredHeader(request, "x-airenos-trusted-context");
      const expectedRequestBinding = buildRistoVerticalRequestBinding({
        method,
        operation: "booking.create",
        idempotencyKey,
      });
      const trusted = verifyAirenOsVerticalTrustedContext({
        token,
        publicKey: input.publicKey,
        issuer: input.issuer,
        audience: input.audience,
        expectedRequestBinding,
        ...(input.now ? { now: input.now() } : {}),
      });

      const context = await buildRistoVerticalSecurityContext({
        trusted,
        tenants: input.tenants,
        locations: input.locations,
        memberships: input.memberships,
        roles: input.roles,
      });

      const result = await input.booking.create(context, bookingCreateInput(request.body), idempotencyKey);
      return response(result.replayed ? 200 : 201, Object.freeze({
        ok: true,
        data: result.booking,
        replayed: result.replayed,
        correlation_id: context.correlationId,
      }), context.correlationId);
    } catch (error) {
      return mapError(error);
    }
  };
}
