import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "../../authorization/src/index.ts";

export type AIRenProductType = "vertical" | "shared_capability";
export type AIRenProductLifecycle = "governed_reference" | "closed_pass" | "completed_frozen";
export type AIRenProductRuntimeState = "governed_non_production" | "frozen_non_production";
export type AIRenProductDependencyMode = "required" | "optional";

export type AIRenProductDependency = Readonly<{
  productCode: string;
  mode: AIRenProductDependencyMode;
}>;

export type AIRenProductDefinition = Readonly<{
  productCode: string;
  name: string;
  type: AIRenProductType;
  entitlementKey: string;
  lifecycle: AIRenProductLifecycle;
  runtimeState: AIRenProductRuntimeState;
  productionEnabled: false;
  authorityOwner: "AIRenOS" | "RISTOAIREN" | "AIRen Booking" | "AIRenPay";
  sourceBranch: string;
  sourceSha: string;
  certifiedScope: string;
  dependencies: readonly AIRenProductDependency[];
  description: string;
}>;

export const AIRenProductCodes = Object.freeze({
  RISTOAIREN: "ristoairen",
  BOOKING: "airen.booking",
  PAY: "airen.pay",
} as const);

export const AIRenProductRegistry: readonly AIRenProductDefinition[] = Object.freeze([
  Object.freeze({
    productCode: AIRenProductCodes.RISTOAIREN,
    name: "RISTOAIREN",
    type: "vertical",
    entitlementKey: "vertical.ristoairen",
    lifecycle: "governed_reference",
    runtimeState: "governed_non_production",
    productionEnabled: false,
    authorityOwner: "RISTOAIREN",
    sourceBranch: "rbl/ristoairen-real-baseline-01-20260827",
    sourceSha: "d055fba86d938aa38cee648171425046c7d972a4",
    certifiedScope: "RISTOAIREN governed reference baseline",
    dependencies: Object.freeze([]),
    description: "Hospitality SaaS vertical. It consumes shared AIRenOS capabilities through governed interfaces and does not own AIRen Booking or AIRenPay.",
  }),
  Object.freeze({
    productCode: AIRenProductCodes.BOOKING,
    name: "AIRen Booking",
    type: "shared_capability",
    entitlementKey: "airen.booking",
    lifecycle: "closed_pass",
    runtimeState: "governed_non_production",
    productionEnabled: false,
    authorityOwner: "AIRen Booking",
    sourceBranch: "rbl/airen-booking-gate-e-direct-e2e-20260902",
    sourceSha: "ac1e0baff774542d1eada41b78eb4b24bb161221",
    certifiedScope: "GOVERNED_NON_PRODUCTION_DIRECT_BOOKING_E2E",
    dependencies: Object.freeze([
      Object.freeze({ productCode: AIRenProductCodes.PAY, mode: "optional" as const }),
    ]),
    description: "Shared booking capability. Booking Core remains the final confirmation and lifecycle authority; AIRenPay is optional guarantee evidence.",
  }),
  Object.freeze({
    productCode: AIRenProductCodes.PAY,
    name: "AIRenPay",
    type: "shared_capability",
    entitlementKey: "airen.pay",
    lifecycle: "completed_frozen",
    runtimeState: "frozen_non_production",
    productionEnabled: false,
    authorityOwner: "AIRenPay",
    sourceBranch: "rbl/airenpay-ap01-product-neutral-extraction-20260902",
    sourceSha: "932c474723dfd4debda72d29a989c61f36bbbd5e",
    certifiedScope: "Product-neutral AIRenPay extraction; provider TEST evidence only; no real-money movement",
    dependencies: Object.freeze([]),
    description: "Shared payment/financial-evidence capability. AIRenPay Core is completed/frozen and does not own Booking state.",
  }),
]);

const PRODUCT_CODE = /^[a-z][a-z0-9._-]{2,63}$/;
const ENTITLEMENT_KEY = /^[a-z][a-z0-9._:-]{2,127}$/;

function normalizeKey(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PRODUCT_CODE.test(normalized)) throw new AppError("VALIDATION_FAILED", `Invalid ${label}`);
  return normalized;
}

function validateRegistry(registry: readonly AIRenProductDefinition[]): Readonly<{ state: "PASS"; productCount: number; entitlementCount: number }> {
  const codes = new Set<string>();
  const entitlements = new Set<string>();
  for (const product of registry) {
    if (!PRODUCT_CODE.test(product.productCode)) throw new Error(`Invalid product code: ${product.productCode}`);
    if (!ENTITLEMENT_KEY.test(product.entitlementKey)) throw new Error(`Invalid entitlement key: ${product.entitlementKey}`);
    if (codes.has(product.productCode)) throw new Error(`Duplicate product code: ${product.productCode}`);
    if (entitlements.has(product.entitlementKey)) throw new Error(`Duplicate product entitlement: ${product.entitlementKey}`);
    if (product.productionEnabled !== false) throw new Error(`AOS-01 cannot enable production: ${product.productCode}`);
    codes.add(product.productCode);
    entitlements.add(product.entitlementKey);
  }
  for (const product of registry) {
    for (const dependency of product.dependencies) {
      if (dependency.productCode === product.productCode) throw new Error(`Self dependency: ${product.productCode}`);
      if (!codes.has(dependency.productCode)) throw new Error(`Unknown dependency ${dependency.productCode} for ${product.productCode}`);
    }
  }
  return Object.freeze({ state: "PASS", productCount: codes.size, entitlementCount: entitlements.size });
}

export const productRegistryValidation = validateRegistry(AIRenProductRegistry);

export function listPlatformProducts(context: PlatformSecurityContext): readonly AIRenProductDefinition[] {
  requirePlatformPermission(context, "platform.products.read");
  return AIRenProductRegistry;
}

export function getPlatformProduct(productCode: string, context: PlatformSecurityContext): AIRenProductDefinition {
  requirePlatformPermission(context, "platform.products.read");
  const normalized = normalizeKey(productCode, "productCode");
  const product = AIRenProductRegistry.find((item) => item.productCode === normalized);
  if (!product) throw new AppError("NOT_FOUND", `Unknown AIRenOS product: ${normalized}`);
  return product;
}

export function findPlatformProductByEntitlement(entitlementKey: string, context: PlatformSecurityContext): AIRenProductDefinition | null {
  requirePlatformPermission(context, "platform.products.read");
  const normalized = entitlementKey.trim().toLowerCase();
  if (!ENTITLEMENT_KEY.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid entitlementKey");
  return AIRenProductRegistry.find((item) => item.entitlementKey === normalized) ?? null;
}

export function resolveProductAccessForEntitlements(entitlementKeys: readonly string[], context: PlatformSecurityContext) {
  requirePlatformPermission(context, "platform.products.read");
  const effective = new Set(entitlementKeys.map((key) => key.trim().toLowerCase()));
  return AIRenProductRegistry.map((product) => Object.freeze({
    productCode: product.productCode,
    entitlementKey: product.entitlementKey,
    entitled: effective.has(product.entitlementKey),
    productionEnabled: product.productionEnabled,
  }));
}
