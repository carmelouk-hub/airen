import fs from "node:fs";

const migration = fs.readFileSync("db/migrations/0031_aos03_product_subscription_access_runtime.sql", "utf8");
const access = fs.readFileSync("packages/platform-core/src/product-access.ts", "utf8");
const registry = fs.readFileSync("packages/platform-core/src/product-registry.ts", "utf8");

const mustContain = [
  "platform.product_subscription_bindings",
  "platform.product_subscription_binding_idempotency",
  "platform.product_access.bind_subscription",
  "security.platform_bind_product_subscription",
  "security.resolve_current_product_subscription",
  "billing.subscriptions",
  "billing.entitlement_catalog",
  "platform.organization_tenants",
  "authz.organization_memberships",
  "authz.tenant_memberships",
  "authz.location_memberships",
];
for (const token of mustContain) {
  if (!migration.includes(token)) throw new Error(`AOS-03 migration missing required boundary: ${token}`);
}

for (const forbidden of [
  /DROP\s+(TABLE|SCHEMA)\s+billing\./i,
  /ALTER\s+TABLE\s+billing\.subscriptions/i,
  /ALTER\s+TABLE\s+billing\.tenant_entitlements/i,
  /DELETE\s+FROM\s+billing\.subscriptions/i,
  /DELETE\s+FROM\s+billing\.tenant_entitlements/i,
  /UPDATE\s+billing\.subscriptions/i,
  /UPDATE\s+billing\.tenant_entitlements/i,
  /INSERT\s+INTO\s+billing\.subscriptions/i,
  /INSERT\s+INTO\s+billing\.tenant_entitlements/i,
]) {
  if (forbidden.test(migration)) throw new Error(`AOS-03 must not mutate certified R3-E/R3-F authority: ${forbidden}`);
}

if (!access.includes("resolveCurrentTenantEntitlements")) throw new Error("AOS-03 ProductAccess must resolve effective entitlements server-side");
if (!access.includes("resolveOrganizationTenantContext")) throw new Error("AOS-03 ProductAccess must preserve Organization/Tenant membership authority");
if (!access.includes("assertResourceScope")) throw new Error("AOS-03 ProductAccess must preserve Tenant/Location scope checks");
if (!access.includes("hasPermission")) throw new Error("AOS-03 ProductAccess must include action permission in effective access");
if (/deps\.context\.entitlements\.(includes|some)/.test(access)) throw new Error("AOS-03 must not trust client-carried SecurityContext entitlements for effective ProductAccess");
if (!access.includes('new Set<SubscriptionStatus>(["trialing", "active", "cancel_pending"])')) throw new Error("AOS-03 service-granting Subscription states changed unexpectedly");

for (const invariant of [
  'RISTOAIREN: "ristoairen"',
  'BOOKING: "airen.booking"',
  'PAY: "airen.pay"',
  'entitlementKey: "vertical.ristoairen"',
  'entitlementKey: "airen.booking"',
  'entitlementKey: "airen.pay"',
  'productionEnabled: false',
]) {
  if (!registry.includes(invariant)) throw new Error(`AOS-03 detected Product Registry authority drift: ${invariant}`);
}

console.log("AOS-03 ProductAccess static contract PASS");
