import type { MembershipRepository } from "../../authorization/src/index.ts";
import type { CurrentTenantEffectiveEntitlementResolver } from "../../entitlements/src/index.ts";
import type { SecurityContext } from "../../shared-contracts/src/index.ts";
import type { OrganizationContextRepository } from "./organization-control-plane.ts";
import { AIRenProductAttachmentRegistry } from "./product-attachments.ts";
import { requireProductAccess, type CurrentProductSubscriptionResolver, type ProductAccessProjection } from "./product-access.ts";
import { AIRenProductCodes, AIRenProductRegistry } from "./product-registry.ts";

export const RISTOAIREN_ATTACHMENT_PERMISSION = "ristoairen.access" as const;
export const RISTOAIREN_ATTACHMENT_ENTRYPOINT = "/v1/products/ristoairen/attachment" as const;

export type RistoairenProductAttachmentGate = Readonly<{
  gateId: "RA-01";
  gateState: "implementation_open";
  productCode: "ristoairen";
  entitlementKey: "vertical.ristoairen";
  permissionKey: typeof RISTOAIREN_ATTACHMENT_PERMISSION;
  authorityOwner: "RISTOAIREN";
  sourceBranch: string;
  sourceSha: string;
  registeredAttachmentState: "registered";
  registeredRuntimeAttachmentState: "not_attached";
  foundationEntrypointMethod: "GET";
  foundationEntrypointPath: typeof RISTOAIREN_ATTACHMENT_ENTRYPOINT;
  foundationEntrypointState: "wired_runtime_proven";
  experienceAttachmentState: "not_attached";
  experienceTarget: "replaceable_client";
  dependencyProductCodes: readonly string[];
  realAirenosSessionRequired: true;
  productAccessRequired: true;
  owningCoreAuthorityPreserved: true;
  experienceBusinessAuthority: false;
  base44MayAuthorizeProduct: false;
  productionEnabled: false;
}>;

const product = AIRenProductRegistry.find((item) => item.productCode === AIRenProductCodes.RISTOAIREN);
const registeredAttachment = AIRenProductAttachmentRegistry.find((item) => item.productCode === AIRenProductCodes.RISTOAIREN);

if (!product || !registeredAttachment) throw new Error("RA-01 requires the certified RISTOAIREN Product Registry and AOS-05 attachment contract");
if (product.entitlementKey !== "vertical.ristoairen") throw new Error("RA-01 RISTOAIREN entitlement authority mismatch");
if (product.authorityOwner !== "RISTOAIREN") throw new Error("RA-01 RISTOAIREN owning authority mismatch");
if (registeredAttachment.runtimeAttachmentState !== "not_attached" || registeredAttachment.entrypointState !== "not_assigned") {
  throw new Error("RA-01 cannot rewrite AOS-05 certified attachment history");
}
if (registeredAttachment.experienceBusinessAuthority !== false || registeredAttachment.productionEnabled !== false) {
  throw new Error("RA-01 requires a replaceable non-authoritative experience and non-production state");
}
if (product.dependencies.length !== 0) {
  throw new Error("RA-01 cannot make AIRen Booking or AIRenPay an owning dependency of the RISTOAIREN vertical");
}

export const RISTOAIREN_PRODUCT_ATTACHMENT_GATE: RistoairenProductAttachmentGate = Object.freeze({
  gateId: "RA-01",
  gateState: "implementation_open",
  productCode: AIRenProductCodes.RISTOAIREN,
  entitlementKey: "vertical.ristoairen",
  permissionKey: RISTOAIREN_ATTACHMENT_PERMISSION,
  authorityOwner: "RISTOAIREN",
  sourceBranch: product.sourceBranch,
  sourceSha: product.sourceSha,
  registeredAttachmentState: "registered",
  registeredRuntimeAttachmentState: "not_attached",
  foundationEntrypointMethod: "GET",
  foundationEntrypointPath: RISTOAIREN_ATTACHMENT_ENTRYPOINT,
  foundationEntrypointState: "wired_runtime_proven",
  experienceAttachmentState: "not_attached",
  experienceTarget: "replaceable_client",
  dependencyProductCodes: Object.freeze(product.dependencies.map((dependency) => dependency.productCode)),
  realAirenosSessionRequired: true,
  productAccessRequired: true,
  owningCoreAuthorityPreserved: true,
  experienceBusinessAuthority: false,
  base44MayAuthorizeProduct: false,
  productionEnabled: false,
});

export function requireRistoairenProductAttachmentAccess(deps: Readonly<{
  context: SecurityContext;
  organizations: OrganizationContextRepository;
  memberships: Pick<MembershipRepository, "findTenantMembership">;
  productSubscriptions: CurrentProductSubscriptionResolver;
  entitlements: CurrentTenantEffectiveEntitlementResolver;
}>): Promise<ProductAccessProjection> {
  return requireProductAccess(
    {
      productCode: AIRenProductCodes.RISTOAIREN,
      permissionKey: RISTOAIREN_ATTACHMENT_PERMISSION,
      resourceScope: { tenantId: deps.context.tenantId, locationId: deps.context.locationId },
    },
    deps,
  );
}
