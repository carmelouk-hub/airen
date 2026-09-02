import test from "node:test";
import assert from "node:assert/strict";
import {
  AIRenProductCodes,
  AIRenProductRegistry,
  findPlatformProductByEntitlement,
  getPlatformProduct,
  listPlatformProducts,
  productRegistryValidation,
  resolveProductAccessForEntitlements,
} from "../../packages/platform-core/src/index.ts";
import { AppError, type PlatformSecurityContext } from "../../packages/shared-contracts/src/index.ts";

const allowedContext: PlatformSecurityContext = Object.freeze({
  scopeKind: "platform",
  correlationId: "aos01-product-registry-contract",
  actorIdentityId: "platform-owner-test",
  platformRoles: Object.freeze(["platform_owner"]),
  platformPermissions: Object.freeze(["platform.products.read"]),
});

const deniedContext: PlatformSecurityContext = Object.freeze({
  ...allowedContext,
  platformPermissions: Object.freeze([]),
});

test("AOS-01 registry has exactly the governed initial product set and no production activation", () => {
  assert.deepEqual(productRegistryValidation, { state: "PASS", productCount: 3, entitlementCount: 3 });
  assert.deepEqual(AIRenProductRegistry.map((item) => item.productCode), [
    AIRenProductCodes.RISTOAIREN,
    AIRenProductCodes.BOOKING,
    AIRenProductCodes.PAY,
  ]);
  assert.ok(AIRenProductRegistry.every((item) => item.productionEnabled === false));
});

test("AOS-01 preserves product-neutral Booking and AIRenPay entitlements", () => {
  assert.equal(getPlatformProduct(AIRenProductCodes.BOOKING, allowedContext).entitlementKey, "airen.booking");
  assert.equal(getPlatformProduct(AIRenProductCodes.PAY, allowedContext).entitlementKey, "airen.pay");
  assert.equal(getPlatformProduct(AIRenProductCodes.RISTOAIREN, allowedContext).entitlementKey, "vertical.ristoairen");
});

test("AIRen Booking may depend on AIRenPay only as an optional shared capability", () => {
  const booking = getPlatformProduct(AIRenProductCodes.BOOKING, allowedContext);
  assert.deepEqual(booking.dependencies, [{ productCode: AIRenProductCodes.PAY, mode: "optional" }]);
});

test("Product Registry reads require explicit platform.products.read permission", () => {
  assert.throws(
    () => listPlatformProducts(deniedContext),
    (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED",
  );
});

test("Entitlement lookup and access projection are deterministic and remain non-production", () => {
  assert.equal(findPlatformProductByEntitlement("airen.booking", allowedContext)?.productCode, AIRenProductCodes.BOOKING);
  const access = resolveProductAccessForEntitlements(["vertical.ristoairen", "airen.booking"], allowedContext);
  assert.deepEqual(access.map((row) => [row.productCode, row.entitled]), [
    [AIRenProductCodes.RISTOAIREN, true],
    [AIRenProductCodes.BOOKING, true],
    [AIRenProductCodes.PAY, false],
  ]);
  assert.ok(access.every((row) => row.productionEnabled === false));
});
