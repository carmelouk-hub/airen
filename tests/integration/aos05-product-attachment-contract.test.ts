import test from "node:test";
import assert from "node:assert/strict";
import {
  AOS05_ATTACHMENT_REQUIREMENTS,
  AIRenProductAttachmentRegistry,
  AIRenProductCodes,
  AIRenProductRegistry,
  getProductAttachmentContract,
  listProductAttachmentContracts,
  productAttachmentRegistryValidation,
} from "../../packages/platform-core/src/index.ts";
import { AppError, type PlatformSecurityContext } from "../../packages/shared-contracts/src/index.ts";

const allowedContext: PlatformSecurityContext = Object.freeze({
  scopeKind: "platform",
  correlationId: "aos05-product-attachment-contract",
  actorIdentityId: "platform-owner-test",
  platformRoles: Object.freeze(["platform_owner"]),
  platformPermissions: Object.freeze(["platform.products.read"]),
});

const deniedContext: PlatformSecurityContext = Object.freeze({
  ...allowedContext,
  platformPermissions: Object.freeze([]),
});

test("AOS-05 attachment registry is exactly one-to-one with the certified Product Registry", () => {
  assert.deepEqual(productAttachmentRegistryValidation, { state: "PASS", attachmentCount: AIRenProductRegistry.length, attachedCount: 0 });
  assert.deepEqual(
    AIRenProductAttachmentRegistry.map((item) => item.productCode),
    AIRenProductRegistry.map((item) => item.productCode),
  );

  for (const attachment of AIRenProductAttachmentRegistry) {
    const product = AIRenProductRegistry.find((item) => item.productCode === attachment.productCode);
    assert.ok(product);
    assert.equal(attachment.productType, product.type);
    assert.equal(attachment.entitlementKey, product.entitlementKey);
    assert.equal(attachment.authorityOwner, product.authorityOwner);
    assert.equal(attachment.sourceSha, product.sourceSha);
  }
});

test("AOS-05 registers contracts but attaches no product, assigns no entrypoint and enables no production", () => {
  for (const attachment of AIRenProductAttachmentRegistry) {
    assert.equal(attachment.contractState, "registered");
    assert.equal(attachment.runtimeAttachmentState, "not_attached");
    assert.equal(attachment.entrypointState, "not_assigned");
    assert.equal(attachment.experienceTarget, "replaceable_client");
    assert.equal(attachment.experienceBusinessAuthority, false);
    assert.equal(attachment.productionEnabled, false);
    assert.equal("base44AppId" in attachment, false);
    assert.equal("entrypoint" in attachment, false);
    assert.equal("url" in attachment, false);
  }
});

test("AOS-05 requires real AIRenOS session, ProductAccess and owning-Core preservation before every future attachment", () => {
  assert.deepEqual(AOS05_ATTACHMENT_REQUIREMENTS, [
    "real_airenos_session",
    "product_access_allowed",
    "effective_entitlement",
    "route_manifest",
    "health_readiness_contract",
    "test_contract",
    "cleanup_deprovision_contract",
    "owning_core_authority_preserved",
  ]);
  assert.ok(AIRenProductAttachmentRegistry.every((item) => item.realAirenosSessionRequired));
  assert.ok(AIRenProductAttachmentRegistry.every((item) => item.productAccessRequired));
  assert.ok(AIRenProductAttachmentRegistry.every((item) => item.owningCoreAuthorityPreserved));
});

test("RISTOAIREN remains a vertical while AIRen Booking and AIRenPay remain shared capability attachment classes", () => {
  assert.equal(getProductAttachmentContract(AIRenProductCodes.RISTOAIREN, allowedContext).attachmentClass, "vertical_experience");
  assert.equal(getProductAttachmentContract(AIRenProductCodes.BOOKING, allowedContext).attachmentClass, "shared_capability_experience");
  assert.equal(getProductAttachmentContract(AIRenProductCodes.PAY, allowedContext).attachmentClass, "shared_capability_experience");
});

test("AOS-05 attachment registry reads remain governed by platform.products.read", () => {
  assert.equal(listProductAttachmentContracts(allowedContext).length, AIRenProductRegistry.length);
  assert.throws(
    () => listProductAttachmentContracts(deniedContext),
    (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED",
  );
});
