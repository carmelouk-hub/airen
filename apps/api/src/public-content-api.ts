import { AppError, type AppErrorCode } from "../../../packages/shared-contracts/src/index.ts";
import {
  resolveTenantRoute,
  type LocationRepository,
  type PublicRouteLookup,
  type TenantDomainRepository,
  type TenantRepository,
} from "../../../packages/tenant/src/index.ts";
import {
  PUBLIC_CONTENT_LOCALES,
  type PublicContentLocale,
  type PublicTenantResolverPort,
  type ResolvedPublicTenantV1,
} from "../../../packages/ristoairen/src/public-content/contracts.ts";
import { RistoAirenPublicContentService } from "../../../packages/ristoairen/src/public-content/application-service.ts";

export const PUBLIC_CONTENT_API_PREFIX = "/api/public/v1";

export type PublicContentApiRequest = Readonly<{
  method: string;
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
}>;

export type PublicContentApiResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
  headers: Readonly<Record<string, string>>;
}>;

export type AirenOsPublicTenantResolverDependencies = Readonly<{
  trustedBaseDomain: string;
  tenants: TenantRepository;
  locations: LocationRepository;
  domains: TenantDomainRepository;
  publicRoutes: PublicRouteLookup;
}>;

function publicResponse(status: number, body: Readonly<Record<string, unknown>>): PublicContentApiResponse {
  return Object.freeze({
    status,
    body,
    headers: Object.freeze({
      "cache-control": status < 400 ? "public, max-age=60, stale-while-revalidate=300" : "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    }),
  });
}

function publicErrorStatus(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "TENANT_RESOLUTION_FAILED":
    case "NOT_FOUND":
      return 404;
    case "AUTHENTICATION_REQUIRED":
    case "MEMBERSHIP_REQUIRED":
    case "LOCATION_MEMBERSHIP_REQUIRED":
    case "PERMISSION_DENIED":
    case "ENTITLEMENT_REQUIRED":
    case "TENANT_SCOPE_VIOLATION":
    case "LOCATION_SCOPE_VIOLATION":
      return 403;
    case "CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "RUNTIME_CONFIGURATION_INVALID":
    case "SECRET_RESOLUTION_FAILED":
    case "INTERNAL_ERROR":
      return 500;
  }
}

export function mapPublicContentApiError(error: unknown): PublicContentApiResponse {
  if (error instanceof AppError) {
    const status = publicErrorStatus(error.code);
    return publicResponse(status, Object.freeze({
      error: status >= 500 ? "INTERNAL_ERROR" : error.code,
      message: status === 404
        ? "Public content not found"
        : status >= 500
          ? "Public content request failed"
          : error.message,
    }));
  }
  return publicResponse(500, Object.freeze({
    error: "INTERNAL_ERROR",
    message: "Public content request failed",
  }));
}

function hostname(request: PublicContentApiRequest): string {
  const value = request.headers.host?.trim();
  if (!value) throw new AppError("TENANT_RESOLUTION_FAILED", "PUBLIC_HOST_REQUIRED");
  return value;
}

function locale(url: URL): PublicContentLocale {
  const candidate = url.searchParams.get("locale")?.trim().toLowerCase();
  if (!candidate || !PUBLIC_CONTENT_LOCALES.includes(candidate as PublicContentLocale)) {
    throw new AppError("VALIDATION_FAILED", "INVALID_PUBLIC_CONTENT_LOCALE");
  }
  return candidate as PublicContentLocale;
}

function optionalLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw === "") return 50;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new AppError("VALIDATION_FAILED", "INVALID_PUBLIC_CONTENT_LIMIT");
  }
  return parsed;
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AppError("VALIDATION_FAILED", "INVALID_PUBLIC_ROUTE_ENCODING");
  }
}

export class AirenOsPublicTenantResolver implements PublicTenantResolverPort {
  private readonly dependencies: AirenOsPublicTenantResolverDependencies;

  constructor(dependencies: AirenOsPublicTenantResolverDependencies) {
    this.dependencies = dependencies;
  }

  async resolveFromHostname(hostname: string): Promise<ResolvedPublicTenantV1 | null> {
    try {
      const route = await resolveTenantRoute({
        hostname,
        trustedBaseDomain: this.dependencies.trustedBaseDomain,
        tenants: this.dependencies.tenants,
        locations: this.dependencies.locations,
        domains: this.dependencies.domains,
        publicRoutes: this.dependencies.publicRoutes,
      });
      return Object.freeze({
        tenantId: route.tenant.id,
        locationId: route.location.id,
        hostname: route.hostname,
        canonicalOrigin: `https://${route.hostname}`,
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "TENANT_RESOLUTION_FAILED") return null;
      throw error;
    }
  }
}

export function isPublicContentApiRequest(url: string | undefined): boolean {
  if (!url) return false;
  let pathname: string;
  try {
    pathname = new URL(url, "http://airenos.local").pathname;
  } catch {
    return false;
  }
  return pathname === PUBLIC_CONTENT_API_PREFIX || pathname.startsWith(`${PUBLIC_CONTENT_API_PREFIX}/`);
}

export async function dispatchPublicContentApiRequest(
  request: PublicContentApiRequest,
  service: RistoAirenPublicContentService,
): Promise<PublicContentApiResponse> {
  try {
    if (request.method.toUpperCase() !== "GET") {
      throw new AppError("NOT_FOUND", "PUBLIC_CONTENT_ROUTE_NOT_FOUND");
    }

    const url = new URL(request.url, "http://airenos.local");
    const requestHostname = hostname(request);
    const suffix = url.pathname.slice(PUBLIC_CONTENT_API_PREFIX.length);

    if (suffix === "/seo") {
      const pagePath = url.searchParams.get("path");
      if (!pagePath) throw new AppError("VALIDATION_FAILED", "PUBLIC_PAGE_PATH_REQUIRED");
      const projection = await service.getSeoProjection({
        hostname: requestHostname,
        pagePath,
        locale: locale(url),
      });
      if (!projection) throw new AppError("NOT_FOUND", "PUBLIC_SEO_PROJECTION_NOT_FOUND");
      return publicResponse(200, Object.freeze({ data: projection }));
    }

    if (suffix === "/journal") {
      const items = await service.listPublishedJournal(
        requestHostname,
        locale(url),
        optionalLimit(url),
      );
      return publicResponse(200, Object.freeze({ items }));
    }

    if (suffix.startsWith("/journal/")) {
      const encodedSlug = suffix.slice("/journal/".length);
      if (!encodedSlug || encodedSlug.includes("/")) {
        throw new AppError("NOT_FOUND", "PUBLIC_CONTENT_ROUTE_NOT_FOUND");
      }
      const article = await service.getPublishedJournalArticle(
        requestHostname,
        decodeRouteSegment(encodedSlug),
        locale(url),
      );
      if (!article) throw new AppError("NOT_FOUND", "PUBLIC_JOURNAL_ARTICLE_NOT_FOUND");
      return publicResponse(200, Object.freeze({ data: article }));
    }

    if (suffix === "/sitemap") {
      const sitemap = await service.getSitemap(requestHostname);
      return publicResponse(200, Object.freeze({
        canonicalOrigin: sitemap.canonicalOrigin,
        entries: sitemap.entries,
      }));
    }

    throw new AppError("NOT_FOUND", "PUBLIC_CONTENT_ROUTE_NOT_FOUND");
  } catch (error) {
    return mapPublicContentApiError(error);
  }
}
