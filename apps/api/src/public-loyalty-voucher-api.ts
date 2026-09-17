import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import type { LoyaltyVoucherApplicationService } from "../../../packages/ristoairen/src/loyalty-voucher/application-service.ts";

export type PublicLoyaltyVoucherApiRequest = Readonly<{
  method: string;
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
}>;
export type PublicLoyaltyVoucherApiResponse = Readonly<{ status: number; body: Readonly<Record<string, unknown>>; headers?: Readonly<Record<string,string>> }>;

function hostname(value?: string): string {
  const raw = value?.trim().toLowerCase();
  if (!raw) throw new AppError("TENANT_RESOLUTION_FAILED", "Host header is required");
  return raw.replace(/:\d+$/, "");
}
function correlationId(value?: string): string { return value?.trim() || crypto.randomUUID(); }
function credential(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError("AUTHENTICATION_REQUIRED", "Self-service credential is required");
  return normalized;
}
function status(error: unknown): number {
  if (!(error instanceof AppError)) return 500;
  if (error.code === "AUTHENTICATION_REQUIRED") return 401;
  if (error.code === "VALIDATION_FAILED" || error.code === "TENANT_RESOLUTION_FAILED") return 400;
  if (error.code === "NOT_FOUND" || error.code === "TENANT_SCOPE_VIOLATION" || error.code === "LOCATION_SCOPE_VIOLATION") return 404;
  if (error.code === "PERMISSION_DENIED") return 403;
  if (error.code === "CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT") return 409;
  return 500;
}

export function isPublicLoyaltyVoucherApiRequest(url?: string): boolean {
  if (!url) return false;
  try { return new URL(url, "http://airenos.local").pathname.startsWith("/api/public/v1/self-service/loyalty-voucher"); }
  catch { return false; }
}

export async function dispatchPublicLoyaltyVoucherApiRequest(request: PublicLoyaltyVoucherApiRequest, service: LoyaltyVoucherApplicationService): Promise<PublicLoyaltyVoucherApiResponse> {
  const correlation = correlationId(request.headers["x-correlation-id"]);
  try {
    const path = new URL(request.url, "http://airenos.local").pathname;
    if (request.method !== "GET" || path !== "/api/public/v1/self-service/loyalty-voucher") return Object.freeze({ status:404, body:Object.freeze({ error:"not_found", correlationId:correlation }) });
    const projection = await service.readOwn({ hostname:hostname(request.headers.host), credential:credential(request.headers["x-self-service-credential"]), correlationId:correlation });
    return Object.freeze({ status:200, body:Object.freeze({ ...projection, correlationId:correlation }), headers:Object.freeze({ "cache-control":"no-store" }) });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    return Object.freeze({ status:status(error), body:Object.freeze({ error:code === "NOT_FOUND" ? "not_found" : code.toLowerCase(), correlationId:correlation }) });
  }
}
