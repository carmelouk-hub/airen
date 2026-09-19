import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import { requirePlatformPermission } from "../../authorization/src/index.ts";
import { AIRenProductRegistry, type AIRenProductDefinition, type AIRenProductType } from "./product-registry.ts";

export type AIRenProductAttachmentClass = "vertical_experience" | "shared_capability_experience";
export type AIRenProductAttachmentContractState = "registered";
export type AIRenProductRuntimeAttachmentState = "not_attached";
export type AIRenProductEntrypointState = "not_assigned";
export type AIRenProductExperienceTarget = "replaceable_client";
export type AIRenProductDependencyPolicy = "inherit_product_registry";
export type AIRenProductAttachmentRequirement =
  | "real_airenos_session"
  | "product_access_allowed"
  | "effective_entitlement"
  | "route_manifest"
  | "health_readiness_contract"
  | "test_contract"
  | "cleanup_deprovision_contract"
  | "owning_core_authority_preserved";

export type AIRenProductAttachmentDefinition = Readonly<{
  contractVersion: 1;
  productCode: string;
  name: string;
  productType: AIRenProductType;
  entitlementKey: string;
  authorityOwner: AIRenProductDefinition["authorityOwner"];
  sourceBranch: string;
  sourceSha: string;
  attachmentClass: AIRenProductAttachmentClass;
  contractState: AIRenProductAttachmentContractState;
  runtimeAttachmentState: AIRenProductRuntimeAttachmentState;
  entrypointState: AIRenProductEntrypointState;
  experienceTarget: AIRenProductExperienceTarget;
  realAirenosSessionRequired: true;
  productAccessRequired: true;
  owningCoreAuthorityPreserved: true;
  experienceBusinessAuthority: false;
  productionEnabled: false;
  dependencyPolicy: AIRenProductDependencyPolicy;
  requirements: readonly AIRenProductAttachmentRequirement[];
}>;

const PRODUCT_CODE = /^[a-z][a-z0-9._-]{2,63}$/;

export const AOS05_ATTACHMENT_REQUIREMENTS: readonly AIRenProductAttachmentRequirement[] = Object.freeze([
  "real_airenos_session",
  "product_access_allowed",
  "effective_entitlement",
  "route_manifest",
  "health_readiness_contract",
  "test_contract",
  "cleanup_deprovision_contract",
  "owning_core_authority_preserved",
]);

function attachmentClass(productType: AIRenProductType): AIRenProductAttachmentClass {
  return productType === "vertical" ? "vertical_experience" : "shared_capability_experience";
}

function buildAttachmentContract(product: AIRenProductDefinition): AIRenProductAttachmentDefinition {
  return Object.freeze({
    contractVersion: 1 as const,
    productCode: product.productCode,
    name: product.name,
    productType: product.type,
    entitlementKey: product.entitlementKey,
    authorityOwner: product.authorityOwner,
    sourceBranch: product.sourceBranch,
    sourceSha: product.sourceSha,
    attachmentClass: attachmentClass(product.type),
    contractState: "registered" as const,
    runtimeAttachmentState: "not_attached" as const,
    entrypointState: "not_assigned" as const,
    experienceTarget: "replaceable_client" as const,
    realAirenosSessionRequired: true as const,
    productAccessRequired: true as const,
    owningCoreAuthorityPreserved: true as const,
    experienceBusinessAuthority: false as const,
    productionEnabled: false as const,
    dependencyPolicy: "inherit_product_registry" as const,
    requirements: AOS05_ATTACHMENT_REQUIREMENTS,
  });
}

export const AIRenProductAttachmentRegistry: readonly AIRenProductAttachmentDefinition[] = Object.freeze(
  AIRenProductRegistry.map(buildAttachmentContract),
);

function validateAttachmentRegistry(): Readonly<{ state: "PASS"; attachmentCount: number; attachedCount: 0 }> {
  if (AIRenProductAttachmentRegistry.length !== AIRenProductRegistry.length) {
    throw new Error("AOS-05 Product Attachment Registry must remain one-to-one with the Product Registry");
  }

  const productByCode = new Map(AIRenProductRegistry.map((product) => [product.productCode, product] as const));
  const seen = new Set<string>();

  for (const attachment of AIRenProductAttachmentRegistry) {
    if (!PRODUCT_CODE.test(attachment.productCode)) throw new Error(`Invalid attachment productCode: ${attachment.productCode}`);
    if (seen.has(attachment.productCode)) throw new Error(`Duplicate attachment contract: ${attachment.productCode}`);
    seen.add(attachment.productCode);

    const product = productByCode.get(attachment.productCode);
    if (!product) throw new Error(`Unknown Product Registry reference: ${attachment.productCode}`);
    if (attachment.productType !== product.type) throw new Error(`Product type mismatch: ${attachment.productCode}`);
    if (attachment.entitlementKey !== product.entitlementKey) throw new Error(`Entitlement mismatch: ${attachment.productCode}`);
    if (attachment.authorityOwner !== product.authorityOwner) throw new Error(`Authority owner mismatch: ${attachment.productCode}`);
    if (attachment.sourceSha !== product.sourceSha) throw new Error(`Source SHA mismatch: ${attachment.productCode}`);
    if (attachment.runtimeAttachmentState !== "not_attached") throw new Error(`AOS-05 cannot attach a product: ${attachment.productCode}`);
    if (attachment.entrypointState !== "not_assigned") throw new Error(`AOS-05 cannot assign an entrypoint: ${attachment.productCode}`);
    if (attachment.experienceBusinessAuthority !== false) throw new Error(`Experience authority forbidden: ${attachment.productCode}`);
    if (attachment.productionEnabled !== false) throw new Error(`AOS-05 cannot enable production: ${attachment.productCode}`);
  }

  return Object.freeze({ state: "PASS", attachmentCount: AIRenProductAttachmentRegistry.length, attachedCount: 0 as const });
}

export const productAttachmentRegistryValidation = validateAttachmentRegistry();

export function listProductAttachmentContracts(context: PlatformSecurityContext): readonly AIRenProductAttachmentDefinition[] {
  requirePlatformPermission(context, "platform.products.read");
  return AIRenProductAttachmentRegistry;
}

export function getProductAttachmentContract(productCode: string, context: PlatformSecurityContext): AIRenProductAttachmentDefinition {
  requirePlatformPermission(context, "platform.products.read");
  const normalized = productCode.trim().toLowerCase();
  if (!PRODUCT_CODE.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid productCode");
  const attachment = AIRenProductAttachmentRegistry.find((item) => item.productCode === normalized);
  if (!attachment) throw new AppError("NOT_FOUND", `Unknown AIRenOS product attachment contract: ${normalized}`);
  return attachment;
}
