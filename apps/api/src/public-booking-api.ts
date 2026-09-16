import { AppError, type AppErrorCode } from "../../../packages/shared-contracts/src/index.ts";
import type {
  PublicBookingCancelInputV1,
  PublicBookingCreateInputV1,
  PublicBookingUpdateInputV1,
} from "../../../packages/ristoairen/src/public-self-service/contracts.ts";
import { RistoPublicSelfServiceApplicationService } from "../../../packages/ristoairen/src/public-self-service/application-service.ts";

export const PUBLIC_SELF_SERVICE_API_PREFIX = "/api/public/v1/self-service";

export type PublicBookingApiRequest = Readonly<{
  method: string;
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
  body?: unknown;
}>;

export type PublicBookingApiResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
}>;

function response(status: number, body: Readonly<Record<string, unknown>>): PublicBookingApiResponse {
  return Object.freeze({
    status,
    body,
    headers: Object.freeze({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    }),
  });
}

function errorStatus(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_FAILED": return 400;
    case "NOT_FOUND": case "TENANT_RESOLUTION_FAILED": return 404;
    case "AUTHENTICATION_REQUIRED": case "MEMBERSHIP_REQUIRED": case "LOCATION_MEMBERSHIP_REQUIRED":
    case "PERMISSION_DENIED": case "ENTITLEMENT_REQUIRED": case "TENANT_SCOPE_VIOLATION": case "LOCATION_SCOPE_VIOLATION": return 403;
    case "CONFLICT": case "IDEMPOTENCY_CONFLICT": return 409;
    default: return 500;
  }
}

function mapError(error: unknown): PublicBookingApiResponse {
  if (error instanceof AppError) {
    const status = errorStatus(error.code);
    return response(status, Object.freeze({
      error: status >= 500 ? "INTERNAL_ERROR" : error.code,
      message: status === 404 ? "Self-service resource not found" : status >= 500 ? "Self-service request failed" : error.message,
    }));
  }
  return response(500, Object.freeze({ error: "INTERNAL_ERROR", message: "Self-service request failed" }));
}

function requiredHeader(request: PublicBookingApiRequest, name: string): string {
  const value = request.headers[name]?.trim();
  if (!value) throw new AppError("VALIDATION_FAILED", `MISSING_${name.toUpperCase().replaceAll("-", "_")}`);
  return value;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("VALIDATION_FAILED", "INVALID_SELF_SERVICE_BODY");
  const input = body as Record<string, unknown>;
  for (const key of ["tenantId", "tenant_id", "locationId", "location_id", "source", "externalReference", "external_reference", "requestedStatus"]) {
    if (Object.hasOwn(input, key)) throw new AppError("TENANT_SCOPE_VIOLATION", "CLIENT_SCOPE_OR_AUTHORITY_FIELD_FORBIDDEN");
  }
  return input;
}

function createInput(body: unknown): PublicBookingCreateInputV1 {
  const value = objectBody(body);
  return Object.freeze({
    partySize: value.partySize as number,
    bookingDate: value.bookingDate as string,
    bookingTimeLocal: value.bookingTimeLocal as string,
    expectedDurationMinutes: value.expectedDurationMinutes as number,
    customerNameSnapshot: value.customerNameSnapshot as string,
    ...(value.phoneSnapshot === undefined ? {} : { phoneSnapshot: value.phoneSnapshot as string }),
    ...(value.emailSnapshot === undefined ? {} : { emailSnapshot: value.emailSnapshot as string }),
    ...(value.notes === undefined ? {} : { notes: value.notes as string }),
    ...(value.specialRequests === undefined ? {} : { specialRequests: value.specialRequests as string }),
  });
}

function updateInput(body: unknown): PublicBookingUpdateInputV1 {
  const value = objectBody(body);
  return Object.freeze({
    rowVersion: value.rowVersion as number,
    ...(value.partySize === undefined ? {} : { partySize: value.partySize as number }),
    ...(value.bookingDate === undefined ? {} : { bookingDate: value.bookingDate as string }),
    ...(value.bookingTimeLocal === undefined ? {} : { bookingTimeLocal: value.bookingTimeLocal as string }),
    ...(value.expectedDurationMinutes === undefined ? {} : { expectedDurationMinutes: value.expectedDurationMinutes as number }),
    ...(value.customerNameSnapshot === undefined ? {} : { customerNameSnapshot: value.customerNameSnapshot as string }),
    ...(value.phoneSnapshot === undefined ? {} : { phoneSnapshot: value.phoneSnapshot as string | null }),
    ...(value.emailSnapshot === undefined ? {} : { emailSnapshot: value.emailSnapshot as string | null }),
    ...(value.notes === undefined ? {} : { notes: value.notes as string | null }),
    ...(value.specialRequests === undefined ? {} : { specialRequests: value.specialRequests as string | null }),
  });
}

function cancelInput(body: unknown): PublicBookingCancelInputV1 {
  const value = objectBody(body);
  return Object.freeze({ rowVersion: value.rowVersion as number, ...(value.reason === undefined ? {} : { reason: value.reason as string }) });
}

export function isPublicBookingApiRequest(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const pathname = new URL(url, "http://airenos.local").pathname;
    return pathname === PUBLIC_SELF_SERVICE_API_PREFIX || pathname.startsWith(`${PUBLIC_SELF_SERVICE_API_PREFIX}/`);
  } catch {
    return false;
  }
}

export async function dispatchPublicBookingApiRequest(
  request: PublicBookingApiRequest,
  service: RistoPublicSelfServiceApplicationService,
): Promise<PublicBookingApiResponse> {
  try {
    const url = new URL(request.url, "http://airenos.local");
    const suffix = url.pathname.slice(PUBLIC_SELF_SERVICE_API_PREFIX.length);
    const hostname = requiredHeader(request, "host");
    const credential = requiredHeader(request, "x-self-service-credential");
    const correlationId = requiredHeader(request, "x-correlation-id");
    const method = request.method.toUpperCase();

    if (suffix === "/booking" && method === "POST") {
      const result = await service.createBooking({ hostname, credential, correlationId, idempotencyKey: requiredHeader(request, "idempotency-key"), booking: createInput(request.body) });
      return response(result.replayed ? 200 : 201, Object.freeze({ data: result.booking, replayed: result.replayed }));
    }
    if (suffix === "/booking" && method === "GET") {
      return response(200, Object.freeze({ data: await service.getBooking({ hostname, credential, correlationId }) }));
    }
    if (suffix === "/booking" && method === "PATCH") {
      const result = await service.updateBooking({ hostname, credential, correlationId, idempotencyKey: requiredHeader(request, "idempotency-key"), update: updateInput(request.body) });
      return response(200, Object.freeze({ data: result.booking, replayed: result.replayed }));
    }
    if (suffix === "/booking/cancel" && method === "POST") {
      const result = await service.cancelBooking({ hostname, credential, correlationId, idempotencyKey: requiredHeader(request, "idempotency-key"), cancel: cancelInput(request.body) });
      return response(200, Object.freeze({ data: result.booking, replayed: result.replayed }));
    }
    if (suffix === "/queue" && method === "GET") {
      return response(200, Object.freeze({ data: await service.getQueue({ hostname, credential, correlationId }) }));
    }

    throw new AppError("NOT_FOUND", "PUBLIC_SELF_SERVICE_ROUTE_NOT_FOUND");
  } catch (error) {
    return mapError(error);
  }
}
