import test from "node:test";
import assert from "node:assert/strict";
import {
  DONOR_PRODUCTION_RECOVERY_RULES,
  assertNoDonorAuthority,
  mapDonorPriority,
  mapDonorProductionStatus,
  recoverPortableProductionIntent,
} from "../../packages/ristoairen/src/production/donor-recovery.ts";
import {
  assertFreshProductionVersion,
  assertProductionTransition,
} from "../../packages/ristoairen/src/production/policy.ts";

test("REC-002 recovers portable kitchen/bar workflow semantics only", () => {
  const kitchen = recoverPortableProductionIntent("KITCHEN", {
    status: "NUOVO",
    priority: "VIP",
    customer_name: "Synthetic Guest",
    table_label: "T12",
    items: [
      { name: "Synthetic Dish", qty: 2, category: "PRIMI" },
    ],
  });

  assert.equal(kitchen.stationType, "KITCHEN");
  assert.equal(kitchen.status, "NEW");
  assert.equal(kitchen.priority, "VIP");
  assert.equal(kitchen.lines[0]?.label, "Synthetic Dish");
  assert.equal(kitchen.lines[0]?.quantity, 2);
  assert.equal("tenant_id" in kitchen, false);
  assert.equal("location_id" in kitchen, false);
  assert.deepEqual(DONOR_PRODUCTION_RECOVERY_RULES.acceptance, ["GJ2-017", "GJ2-033", "GJ2-039"]);
});

test("REC-002 normalizes donor KDS and Bar lifecycle without preserving legacy authority", () => {
  assert.equal(mapDonorProductionStatus("NUOVO"), "NEW");
  assert.equal(mapDonorProductionStatus("IN_PREPARAZIONE"), "IN_PREPARATION");
  assert.equal(mapDonorProductionStatus("PRONTO"), "READY");
  assert.equal(mapDonorProductionStatus("SERVITO"), "SERVED");
  assert.equal(mapDonorPriority("ALTA"), "HIGH");
  assert.equal(mapDonorPriority("NORMALE"), "NORMAL");
  assert.throws(() => mapDonorProductionStatus("UNKNOWN"), /UNSUPPORTED_DONOR_PRODUCTION_STATUS/);
});

test("REC-002 rejects donor tenant/location/order/provider identity as canonical authority", () => {
  for (const field of ["id", "fast_order_id", "tenant_id", "location_id", "created_by_id", "stripe_payment_intent"] as const) {
    assert.throws(
      () => assertNoDonorAuthority({ [field]: "legacy-authority" }),
      new RegExp(`DONOR_AUTHORITY_REJECTED:${field}`),
    );
  }
});

test("REC-002 enforces monotonic production lifecycle and row-version concurrency", () => {
  assert.doesNotThrow(() => assertProductionTransition("NEW", "IN_PREPARATION"));
  assert.doesNotThrow(() => assertProductionTransition("IN_PREPARATION", "READY"));
  assert.doesNotThrow(() => assertProductionTransition("READY", "SERVED"));
  assert.throws(() => assertProductionTransition("NEW", "SERVED"), /INVALID_PRODUCTION_TRANSITION/);
  assert.doesNotThrow(() => assertFreshProductionVersion(4, 4));
  assert.throws(() => assertFreshProductionVersion(4, 3), /STALE_PRODUCTION_TICKET_VERSION/);
});
