import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  AIREN_PAY_ENTITLEMENT,
  assertAirenPayRuntimeAccess,
  resolveAirenPayRuntimeReadiness
} from "../../packages/airenpay/src/index.ts";

function context(entitlements: readonly string[] = []): SecurityContext {
  return Object.freeze({
    correlationId: "airenpay-runtime-034",
    actorIdentityId: "actor-034",
    platformRoles: [],
    platformPermissions: [],
    tenantId: "tenant-034",
    locationId: "location-034",
    permissions: [],
    entitlements
  });
}

test("AIRenPay is default-OFF even for an entitled tenant", () => {
  const readiness = resolveAirenPayRuntimeReadiness(context([AIREN_PAY_ENTITLEMENT]));
  assert.equal(readiness.enabled, false);
  assert.equal(readiness.entitled, true);
  assert.equal(readiness.providerMode, "TEST");
  assert.equal(readiness.ready, false);
  assert.throws(
    () => assertAirenPayRuntimeAccess(context([AIREN_PAY_ENTITLEMENT])),
    (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED"
  );
});

test("AIRenPay denies enabled runtime when airen.pay entitlement is absent", () => {
  const readiness = resolveAirenPayRuntimeReadiness(context(), { enabled: true, providerMode: "TEST" });
  assert.equal(readiness.enabled, true);
  assert.equal(readiness.entitled, false);
  assert.equal(readiness.ready, false);
  assert.throws(
    () => assertAirenPayRuntimeAccess(context(), { enabled: true, providerMode: "TEST" }),
    (error: unknown) => error instanceof AppError && error.code === "ENTITLEMENT_REQUIRED"
  );
});

test("AIRenPay becomes ready only when explicitly enabled and entitled", () => {
  const readiness = assertAirenPayRuntimeAccess(
    context([AIREN_PAY_ENTITLEMENT]),
    { enabled: true, providerMode: "TEST" }
  );
  assert.deepEqual(readiness, {
    capability: "airen.pay",
    enabled: true,
    entitled: true,
    providerMode: "TEST",
    ready: true
  });
});

test("AIRenPay Gate 034 rejects LIVE provider mode fail-closed", () => {
  assert.throws(
    () => resolveAirenPayRuntimeReadiness(context([AIREN_PAY_ENTITLEMENT]), { enabled: true, providerMode: "LIVE" }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID"
  );
});
