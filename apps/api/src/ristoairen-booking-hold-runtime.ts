import type { Pool } from "pg";
import { AppError, type SecurityContext, type UUID } from "../../../packages/shared-contracts/src/index.ts";
import { requirePermission } from "../../../packages/authorization/src/index.ts";
import { requireEntitlement } from "../../../packages/entitlements/src/index.ts";
import {
  PostgresRistoBookingHoldLifecycle
} from "../../../packages/persistence-postgres/src/risto-booking-hold-lifecycle.ts";
import {
  PostgresRistoBookingHoldUnitOfWork
} from "../../../packages/persistence-postgres/src/risto-booking-hold-repository.ts";
import {
  BookingHoldApplicationService,
  BOOKING_PERMISSIONS,
  requireBookingHoldConvert,
  type BookingHoldCancelInputV1,
  type BookingHoldConversionResultV1,
  type BookingHoldConvertInputV1,
  type BookingHoldCreateInputV1,
  type BookingHoldMutationResultV1,
  type BookingHoldPrivateProjectionV1,
  type RistoProductAccessGuard
} from "../../../packages/ristoairen/src/booking/index.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export type RistoBookingHoldRuntimeSwitches = Readonly<{
  runtimeEnabled: boolean;
  expiryWorkerEnabled: boolean;
}>;

export interface BookingHoldLifecyclePort {
  convert(
    context: SecurityContext,
    holdId: UUID,
    rowVersion: number,
    idempotencyKey: string
  ): Promise<BookingHoldConversionResultV1>;
  expireDue(
    context: SecurityContext,
    now?: Date,
    limit?: number
  ): Promise<readonly BookingHoldPrivateProjectionV1[]>;
}

export type BookingHoldExpiryScopeProvider = () => Promise<readonly SecurityContext[]>;

export type RistoBookingHoldInternalRuntime = Readonly<{
  enabled: boolean;
  switches: RistoBookingHoldRuntimeSwitches;
  create(context: SecurityContext, input: BookingHoldCreateInputV1, idempotencyKey: string): Promise<BookingHoldMutationResultV1>;
  cancel(context: SecurityContext, holdId: UUID, input: BookingHoldCancelInputV1, idempotencyKey: string): Promise<BookingHoldMutationResultV1>;
  convert(context: SecurityContext, holdId: UUID, input: BookingHoldConvertInputV1, idempotencyKey: string): Promise<BookingHoldConversionResultV1>;
  runExpirySweep(context: SecurityContext, now?: Date, limit?: number): Promise<readonly BookingHoldPrivateProjectionV1[]>;
  startExpiryWorker(): void;
  stop(): void;
}>;

function fail(message: string, field?: string): never {
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", message, field ? { field } : undefined);
}

function optionalBoolean(environment: EnvironmentInput, key: string): boolean {
  const raw = environment[key]?.trim().toLowerCase();
  if (!raw) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fail(`${key} must be true or false`, key);
}

function optionalInteger(environment: EnvironmentInput, key: string, fallback: number, min: number, max: number): number {
  const raw = environment[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) return fail(`${key} must be an integer`, key);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) return fail(`${key} is outside the permitted range`, key);
  return value;
}

export function loadRistoBookingHoldRuntimeSwitches(environment: EnvironmentInput): RistoBookingHoldRuntimeSwitches {
  const switches = Object.freeze({
    runtimeEnabled: optionalBoolean(environment, "RISTOAIREN_BOOKING_HOLD_RUNTIME_ENABLED"),
    expiryWorkerEnabled: optionalBoolean(environment, "RISTOAIREN_BOOKING_HOLD_EXPIRY_WORKER_ENABLED")
  });
  if (!switches.runtimeEnabled && switches.expiryWorkerEnabled) {
    fail("BookingHold expiry worker cannot be enabled while BookingHold runtime is disabled", "RISTOAIREN_BOOKING_HOLD_RUNTIME_ENABLED");
  }
  return switches;
}

function assertConvertInput(input: BookingHoldConvertInputV1): BookingHoldConvertInputV1 {
  for (const key of Object.keys(input as object)) {
    if (["tenantId", "tenant_id", "locationId", "location_id"].includes(key)) {
      throw new AppError("TENANT_SCOPE_VIOLATION", "Client Tenant/Location scope is not authoritative");
    }
  }
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1 || input.rowVersion > Number.MAX_SAFE_INTEGER) {
    throw new AppError("VALIDATION_FAILED", "row_version must be a positive integer");
  }
  return Object.freeze({ rowVersion: input.rowVersion });
}

function assertEnabled(enabled: boolean): void {
  if (!enabled) throw new AppError("PERMISSION_DENIED", "BookingHold runtime is disabled");
}

class RequiredEntitlementGuard implements RistoProductAccessGuard {
  private readonly entitlementKey: string;
  constructor(entitlementKey: string) { this.entitlementKey = entitlementKey; }
  assertRistoAirenAccess(context: SecurityContext): void { requireEntitlement(context, this.entitlementKey); }
}

export class BookingHoldOrchestrationBoundary {
  private readonly enabled: boolean;
  private readonly service: BookingHoldApplicationService;
  private readonly lifecycle: BookingHoldLifecyclePort;
  private readonly entitlementKey: string;

  constructor(input: Readonly<{
    enabled: boolean;
    service: BookingHoldApplicationService;
    lifecycle: BookingHoldLifecyclePort;
    entitlementKey: string;
  }>) {
    this.enabled = input.enabled;
    this.service = input.service;
    this.lifecycle = input.lifecycle;
    this.entitlementKey = input.entitlementKey;
  }

  async create(context: SecurityContext, input: BookingHoldCreateInputV1, idempotencyKey: string): Promise<BookingHoldMutationResultV1> {
    assertEnabled(this.enabled);
    return this.service.create(context, input, idempotencyKey);
  }

  async cancel(context: SecurityContext, holdId: UUID, input: BookingHoldCancelInputV1, idempotencyKey: string): Promise<BookingHoldMutationResultV1> {
    assertEnabled(this.enabled);
    return this.service.cancel(context, holdId, input, idempotencyKey);
  }

  async convert(context: SecurityContext, holdId: UUID, input: BookingHoldConvertInputV1, idempotencyKey: string): Promise<BookingHoldConversionResultV1> {
    assertEnabled(this.enabled);
    requireBookingHoldConvert(context);
    requireEntitlement(context, this.entitlementKey);
    const validated = assertConvertInput(input);
    return this.lifecycle.convert(context, holdId, validated.rowVersion, idempotencyKey);
  }

  async runExpirySweep(context: SecurityContext, now = new Date(), limit = 100): Promise<readonly BookingHoldPrivateProjectionV1[]> {
    assertEnabled(this.enabled);
    requirePermission(context, BOOKING_PERMISSIONS.statusUpdate);
    requireEntitlement(context, this.entitlementKey);
    return this.lifecycle.expireDue(context, now, limit);
  }
}

function disabledRuntime(switches: RistoBookingHoldRuntimeSwitches): RistoBookingHoldInternalRuntime {
  const deny = async (): Promise<never> => { throw new AppError("PERMISSION_DENIED", "BookingHold runtime is disabled"); };
  return Object.freeze({
    enabled: false,
    switches,
    create: deny,
    cancel: deny,
    convert: deny,
    runExpirySweep: deny,
    startExpiryWorker: () => undefined,
    stop: () => undefined
  }) as RistoBookingHoldInternalRuntime;
}

export function createRistoBookingHoldRuntime(input: Readonly<{
  environment: EnvironmentInput;
  pool: Pool;
  requiredEntitlement: string;
  expiryScopeProvider?: BookingHoldExpiryScopeProvider;
  now?: () => Date;
}>): RistoBookingHoldInternalRuntime {
  const switches = loadRistoBookingHoldRuntimeSwitches(input.environment);
  if (!switches.runtimeEnabled) return disabledRuntime(switches);
  if (input.environment.NODE_ENV?.trim() === "production") {
    fail("RBL-02 BookingHold runtime cannot be enabled in production", "RISTOAIREN_BOOKING_HOLD_RUNTIME_ENABLED");
  }
  if (switches.expiryWorkerEnabled && !input.expiryScopeProvider) {
    fail("BookingHold expiry worker requires a trusted scope provider", "RISTOAIREN_BOOKING_HOLD_EXPIRY_WORKER_ENABLED");
  }

  const uow = new PostgresRistoBookingHoldUnitOfWork(input.pool);
  const lifecycle = new PostgresRistoBookingHoldLifecycle(input.pool);
  const service = new BookingHoldApplicationService(uow, new RequiredEntitlementGuard(input.requiredEntitlement));
  const boundary = new BookingHoldOrchestrationBoundary({
    enabled: true,
    service,
    lifecycle,
    entitlementKey: input.requiredEntitlement
  });

  const intervalSeconds = optionalInteger(input.environment, "RISTOAIREN_BOOKING_HOLD_EXPIRY_INTERVAL_SECONDS", 30, 5, 3600);
  const batchLimit = optionalInteger(input.environment, "RISTOAIREN_BOOKING_HOLD_EXPIRY_BATCH_LIMIT", 100, 1, 500);
  let timer: NodeJS.Timeout | undefined;
  let sweepRunning = false;

  const sweepAll = async (): Promise<void> => {
    if (!switches.expiryWorkerEnabled || !input.expiryScopeProvider || sweepRunning) return;
    sweepRunning = true;
    try {
      const scopes = await input.expiryScopeProvider();
      for (const context of scopes) {
        await boundary.runExpirySweep(context, input.now?.() ?? new Date(), batchLimit);
      }
    } finally {
      sweepRunning = false;
    }
  };

  return Object.freeze({
    enabled: true,
    switches,
    create: (context, request, key) => boundary.create(context, request, key),
    cancel: (context, holdId, request, key) => boundary.cancel(context, holdId, request, key),
    convert: (context, holdId, request, key) => boundary.convert(context, holdId, request, key),
    runExpirySweep: (context, now, limit) => boundary.runExpirySweep(context, now, limit),
    startExpiryWorker(): void {
      if (!switches.expiryWorkerEnabled || timer) return;
      void sweepAll();
      timer = setInterval(() => { void sweepAll(); }, intervalSeconds * 1000);
      timer.unref();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
    }
  });
}
