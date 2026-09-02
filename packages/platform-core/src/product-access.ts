import { AppError, assertResourceScope, hasPermission, type PlatformSecurityContext, type ResourceScope, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import type { MembershipRepository } from "../../authorization/src/index.ts";
import type { CurrentTenantEffectiveEntitlementResolver } from "../../entitlements/src/index.ts";
import type { SubscriptionStatus } from "../../billing/src/index.ts";
import { AIRenProductRegistry, type AIRenProductDefinition } from "./product-registry.ts";
import { resolveOrganizationTenantContext, type OrganizationContextRepository } from "./organization-control-plane.ts";

export type ProductAccessDenialReason =
  | "PRODUCT_SUBSCRIPTION_REQUIRED"
  | "PRODUCT_SUBSCRIPTION_ORGANIZATION_MISMATCH"
  | "PRODUCT_SUBSCRIPTION_TENANT_MISMATCH"
  | "PRODUCT_SUBSCRIPTION_PRODUCT_MISMATCH"
  | "PRODUCT_SUBSCRIPTION_ENTITLEMENT_MISMATCH"
  | "SUBSCRIPTION_NOT_SERVICE_GRANTING"
  | "ENTITLEMENT_REQUIRED"
  | "PERMISSION_REQUIRED";

export type ProductSubscriptionBindingProjection = Readonly<{
  bindingId: UUID;
  organizationId: UUID;
  tenantId: UUID;
  productCode: string;
  entitlementKey: string;
  subscriptionId: UUID;
  subscriptionStatus: SubscriptionStatus;
  startsAt: string;
  trialEndsAt?: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelEffectiveAt?: string;
  createdAt: string;
}>;

export type ProductSubscriptionBindingResult = Readonly<{
  binding: ProductSubscriptionBindingProjection;
  replayed: boolean;
}>;

export interface ProductAccessControlPlaneTransaction {
  bindProductSubscription(input: Readonly<{
    idempotencyKey: string;
    organizationId: UUID;
    tenantId: UUID;
    productCode: string;
    entitlementKey: string;
    subscriptionId: UUID;
  }>): Promise<ProductSubscriptionBindingResult>;
}

export interface ProductAccessControlPlaneUnitOfWork {
  transaction<T>(fn: (tx: ProductAccessControlPlaneTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>;
}

export interface CurrentProductSubscriptionResolver {
  resolveCurrentProductSubscription(productCode: string, context: SecurityContext): Promise<ProductSubscriptionBindingProjection | null>;
}

export type ProductAccessProjection = Readonly<{
  productCode: string;
  entitlementKey: string;
  organizationId: UUID;
  tenantId: UUID;
  locationId: UUID;
  subscriptionId?: UUID;
  subscriptionStatus?: SubscriptionStatus;
  permissionKey: string;
  permissionGranted: boolean;
  entitlementEffective: boolean;
  subscriptionServiceGranting: boolean;
  membershipValidated: true;
  productionEnabled: false;
  allowed: boolean;
  denialReasons: readonly ProductAccessDenialReason[];
}>;

const PRODUCT_CODE = /^[a-z][a-z0-9._-]{2,63}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_GRANTING_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(["trialing", "active", "cancel_pending"]);

function productCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PRODUCT_CODE.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid productCode");
  return normalized;
}

function product(value: string): AIRenProductDefinition {
  const normalized = productCode(value);
  const found = AIRenProductRegistry.find((item) => item.productCode === normalized);
  if (!found) throw new AppError("NOT_FOUND", `Unknown AIRenOS product: ${normalized}`);
  return found;
}

function uuid(value: UUID, label: string): UUID {
  const normalized = value.trim();
  if (!UUID_VALUE.test(normalized)) throw new AppError("VALIDATION_FAILED", `${label} must be a UUID`);
  return normalized;
}

function idempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized !== value || !IDEMPOTENCY_KEY.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid ProductSubscription idempotency key");
  return normalized;
}

export async function bindProductSubscription(input: Readonly<{
  idempotencyKey: string;
  organizationId: UUID;
  tenantId: UUID;
  productCode: string;
  subscriptionId: UUID;
}>, deps: Readonly<{
  context: PlatformSecurityContext;
  unitOfWork: ProductAccessControlPlaneUnitOfWork;
}>): Promise<ProductSubscriptionBindingResult> {
  if (!deps.context.platformPermissions.includes("platform.product_access.bind_subscription")) {
    throw new AppError("PERMISSION_DENIED", "Missing platform permission: platform.product_access.bind_subscription");
  }
  const definition = product(input.productCode);
  const request = {
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    organizationId: uuid(input.organizationId, "organizationId"),
    tenantId: uuid(input.tenantId, "tenantId"),
    productCode: definition.productCode,
    entitlementKey: definition.entitlementKey,
    subscriptionId: uuid(input.subscriptionId, "subscriptionId"),
  };
  return deps.unitOfWork.transaction((tx) => tx.bindProductSubscription(request), deps.context);
}

export async function resolveProductAccess(input: Readonly<{
  productCode: string;
  permissionKey: string;
  resourceScope: ResourceScope;
}>, deps: Readonly<{
  context: SecurityContext;
  organizations: OrganizationContextRepository;
  memberships: Pick<MembershipRepository, "findTenantMembership">;
  productSubscriptions: CurrentProductSubscriptionResolver;
  entitlements: CurrentTenantEffectiveEntitlementResolver;
}>): Promise<ProductAccessProjection> {
  const definition = product(input.productCode);
  const permissionKey = input.permissionKey.trim();
  if (!permissionKey) throw new AppError("VALIDATION_FAILED", "permissionKey is required for ProductAccess evaluation");
  assertResourceScope(deps.context, input.resourceScope);

  const organizationContext = await resolveOrganizationTenantContext(
    { identityId: deps.context.actorIdentityId, tenantId: deps.context.tenantId },
    { organizations: deps.organizations, memberships: deps.memberships },
  );
  const binding = await deps.productSubscriptions.resolveCurrentProductSubscription(definition.productCode, deps.context);
  const effectiveEntitlements = await deps.entitlements.resolveCurrentTenantEntitlements(deps.context);
  const entitlementEffective = effectiveEntitlements.some((item) => item.entitlementKey === definition.entitlementKey);
  const permissionGranted = hasPermission(deps.context, permissionKey);
  const subscriptionServiceGranting = binding != null && SERVICE_GRANTING_SUBSCRIPTION_STATUSES.has(binding.subscriptionStatus);

  const denialReasons: ProductAccessDenialReason[] = [];
  if (!binding) denialReasons.push("PRODUCT_SUBSCRIPTION_REQUIRED");
  if (binding && binding.organizationId !== organizationContext.organization.id) denialReasons.push("PRODUCT_SUBSCRIPTION_ORGANIZATION_MISMATCH");
  if (binding && binding.tenantId !== deps.context.tenantId) denialReasons.push("PRODUCT_SUBSCRIPTION_TENANT_MISMATCH");
  if (binding && binding.productCode !== definition.productCode) denialReasons.push("PRODUCT_SUBSCRIPTION_PRODUCT_MISMATCH");
  if (binding && binding.entitlementKey !== definition.entitlementKey) denialReasons.push("PRODUCT_SUBSCRIPTION_ENTITLEMENT_MISMATCH");
  if (binding && !subscriptionServiceGranting) denialReasons.push("SUBSCRIPTION_NOT_SERVICE_GRANTING");
  if (!entitlementEffective) denialReasons.push("ENTITLEMENT_REQUIRED");
  if (!permissionGranted) denialReasons.push("PERMISSION_REQUIRED");

  return Object.freeze({
    productCode: definition.productCode,
    entitlementKey: definition.entitlementKey,
    organizationId: organizationContext.organization.id,
    tenantId: deps.context.tenantId,
    locationId: deps.context.locationId,
    subscriptionId: binding?.subscriptionId,
    subscriptionStatus: binding?.subscriptionStatus,
    permissionKey,
    permissionGranted,
    entitlementEffective,
    subscriptionServiceGranting,
    membershipValidated: true,
    productionEnabled: false,
    allowed: denialReasons.length === 0,
    denialReasons: Object.freeze(denialReasons),
  });
}

export async function requireProductAccess(input: Parameters<typeof resolveProductAccess>[0], deps: Parameters<typeof resolveProductAccess>[1]): Promise<ProductAccessProjection> {
  const access = await resolveProductAccess(input, deps);
  if (access.allowed) return access;
  if (access.denialReasons.includes("ENTITLEMENT_REQUIRED")) {
    throw new AppError("ENTITLEMENT_REQUIRED", `Missing effective entitlement: ${access.entitlementKey}`);
  }
  throw new AppError("PERMISSION_DENIED", `AIRenOS ProductAccess denied for ${access.productCode}`, { denialReasons: access.denialReasons });
}
