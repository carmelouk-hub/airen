import type { Pool } from "pg";
import { AppError, type SecurityContext } from "../../../packages/shared-contracts/src/index.ts";
import { parseSecretRef } from "../../../packages/platform-core/src/index.ts";
import { requireEntitlement } from "../../../packages/entitlements/src/index.ts";
import type { AuthenticationAdapter } from "../../../packages/identity/src/index.ts";
import type { SecretProvider } from "../../../packages/integrations/src/index.ts";
import { PostgresFoundationReadStore, PostgresLocationRepositoryAdapter, PostgresTenantRepositoryAdapter } from "../../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingReadRepository, PostgresRistoBookingUnitOfWork } from "../../../packages/persistence-postgres/src/risto-booking-repository.ts";
import { BookingApplicationService } from "../../../packages/ristoairen/src/booking/index.ts";
import {
  dispatchRistoBookingApiRequest,
  EdDsaServiceAssertionVerifier,
  InMemoryBookingRateLimiter,
  type BookingApiRequest,
  type BookingApiResult,
  type BookingApiDependencies,
  type ServicePublicKeyRegistry
} from "./ristoairen-booking-api.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export type RistoBookingRuntimeSwitches = Readonly<{
  adapterEnabled: boolean;
  projectionEnabled: boolean;
  mutationEnabled: boolean;
}>;

export type RistoBookingRuntime = Readonly<{
  enabled: boolean;
  switches: RistoBookingRuntimeSwitches;
  dispatch(request: BookingApiRequest): Promise<BookingApiResult>;
}>;

type RuntimeInput = Readonly<{
  environment: EnvironmentInput;
  pool: Pool;
  authentication: AuthenticationAdapter;
  foundationReads: PostgresFoundationReadStore;
  tenantRepository: PostgresTenantRepositoryAdapter;
  locationRepository: PostgresLocationRepositoryAdapter;
  secretProvider: SecretProvider;
  appBaseDomain: string;
}>;

function fail(message: string, field?: string): never {
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", message, field ? { field } : undefined);
}

function required(environment: EnvironmentInput, key: string): string {
  const value = environment[key]?.trim();
  if (!value) fail(`Missing required RISTOAIREN Booking runtime field: ${key}`, key);
  return value;
}

function optionalBoolean(environment: EnvironmentInput, key: string): boolean {
  const raw = environment[key]?.trim().toLowerCase();
  if (!raw) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fail(`${key} must be true or false`, key);
}

export function loadRistoBookingRuntimeSwitches(environment: EnvironmentInput): RistoBookingRuntimeSwitches {
  const switches = Object.freeze({
    adapterEnabled: optionalBoolean(environment, "RISTOAIREN_BOOKING_ADAPTER_ENABLED"),
    projectionEnabled: optionalBoolean(environment, "RISTOAIREN_BOOKING_PROJECTION_ENABLED"),
    mutationEnabled: optionalBoolean(environment, "RISTOAIREN_BOOKING_MUTATION_ENABLED")
  });
  if (!switches.adapterEnabled && (switches.projectionEnabled || switches.mutationEnabled)) {
    fail("Booking projection/mutation cannot be enabled while the adapter is disabled", "RISTOAIREN_BOOKING_ADAPTER_ENABLED");
  }
  return switches;
}

class StaticServicePublicKeyRegistry implements ServicePublicKeyRegistry {
  private readonly records: ReadonlyMap<string, Readonly<{ key: string | JsonWebKey; enabled: boolean }>>;

  constructor(raw: string) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { fail("RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON must be valid JSON", "RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("Booking service public key registry must be a JSON object", "RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON");
    const records = new Map<string, Readonly<{ key: string | JsonWebKey; enabled: boolean }>>();
    for (const [kid, record] of Object.entries(parsed as Record<string, unknown>)) {
      if (!kid.trim() || !record || typeof record !== "object" || Array.isArray(record)) fail("Invalid Booking service public key registry entry", "RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON");
      const candidate = record as Record<string, unknown>;
      const key = candidate.key;
      if (!(typeof key === "string" || (key && typeof key === "object" && !Array.isArray(key)))) fail("Booking public key must be PEM text or JWK", "RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON");
      if (typeof candidate.enabled !== "boolean") fail("Booking public key enabled flag must be boolean", "RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON");
      records.set(kid, Object.freeze({ key: key as string | JsonWebKey, enabled: candidate.enabled }));
    }
    if (!records.size) fail("Booking service public key registry must contain at least one key", "RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON");
    this.records = records;
  }

  async resolve(kid: string) { return this.records.get(kid) ?? null; }
}

function requiredEntitlementGuard(entitlementKey: string) {
  return Object.freeze({
    assertRistoAirenAccess(context: SecurityContext): void { requireEntitlement(context, entitlementKey); }
  });
}

function disabledRuntime(switches: RistoBookingRuntimeSwitches): RistoBookingRuntime {
  return Object.freeze({
    enabled: false,
    switches,
    dispatch: async () => Object.freeze({ status: 403, body: Object.freeze({ error: "PERMISSION_DENIED" }) })
  });
}

export async function createRistoBookingRuntime(input: RuntimeInput): Promise<RistoBookingRuntime> {
  const switches = loadRistoBookingRuntimeSwitches(input.environment);
  if (!switches.adapterEnabled) return disabledRuntime(switches);

  if (input.environment.NODE_ENV?.trim() === "production") {
    fail("RBL-01 Booking runtime cannot be enabled in production", "RISTOAIREN_BOOKING_ADAPTER_ENABLED");
  }

  const requiredEntitlement = required(input.environment, "RISTOAIREN_BOOKING_REQUIRED_ENTITLEMENT");
  const cursorRefRaw = required(input.environment, "RISTOAIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF");
  const cursorRef = parseSecretRef(cursorRefRaw, "RISTOAIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF");
  const publicKeyRegistry = new StaticServicePublicKeyRegistry(required(input.environment, "RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON"));
  const cursorMaterial = await input.secretProvider.resolve(cursorRef);

  const reads = cursorMaterial.use((key) => new PostgresRistoBookingReadRepository(input.pool, key));
  const unitOfWork = new PostgresRistoBookingUnitOfWork(input.pool);
  const service = new BookingApplicationService(reads, unitOfWork, requiredEntitlementGuard(requiredEntitlement));

  const dependencies: BookingApiDependencies = Object.freeze({
    authentication: input.authentication,
    serviceAssertions: new EdDsaServiceAssertionVerifier(publicKeyRegistry),
    rateLimiter: new InMemoryBookingRateLimiter(),
    roles: input.foundationReads,
    trustedBaseDomain: input.appBaseDomain,
    tenants: input.tenantRepository,
    locations: input.locationRepository,
    domains: input.foundationReads,
    memberships: input.foundationReads,
    entitlements: input.foundationReads,
    service,
    switches
  });

  return Object.freeze({
    enabled: true,
    switches,
    dispatch: (request: BookingApiRequest) => dispatchRistoBookingApiRequest(request, dependencies)
  });
}
