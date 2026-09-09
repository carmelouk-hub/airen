import test from "node:test";
import assert from "node:assert/strict";
import {
  POS_DONOR_FORBIDDEN_FIELDS,
  REC003_POS_RECOVERY_EVIDENCE,
  mapDonorSettlementMethod,
  recoverPortableSettlementIntent,
} from "../../packages/ristoairen/src/pos/donor-recovery.ts";

test("REC-003 recovers portable cash settlement intent", () => {
  const recovered = recoverPortableSettlementIntent({ order_total: "48.50", payment_method: "cash" });
  assert.equal(recovered.method, "CASH");
  assert.equal(recovered.allocations[0].amount.amountMinor, 4850);
  assert.equal(recovered.allocations[0].amount.currency, "EUR");
});

test("REC-003 recovers mixed split without provider authority", () => {
  const recovered = recoverPortableSettlementIntent({ payment_method: "split", cash_amount: 20, card_amount: 30 });
  assert.equal(recovered.method, "MIXED");
  assert.deepEqual(recovered.allocations.map((a) => a.method), ["CASH", "CARD"]);
  assert.equal(recovered.allocations.reduce((sum, a) => sum + a.amount.amountMinor, 0), 5000);
});

test("REC-003 rejects donor tenant and payment-provider authority", () => {
  for (const field of POS_DONOR_FORBIDDEN_FIELDS) {
    assert.throws(
      () => recoverPortableSettlementIntent({ order_total: 10, payment_method: "cash", [field]: "legacy-authority" }),
      new RegExp(`REC003_FORBIDDEN_DONOR_AUTHORITY:${field}`),
    );
  }
});

test("REC-003 maps legacy payment labels to canonical settlement methods", () => {
  assert.equal(mapDonorSettlementMethod("contanti"), "CASH");
  assert.equal(mapDonorSettlementMethod("stripe"), "CARD");
  assert.equal(mapDonorSettlementMethod("misto"), "MIXED");
});

test("REC-003 acceptance obligations remain runtime-pending", () => {
  assert.deepEqual(REC003_POS_RECOVERY_EVIDENCE.acceptanceTests, ["GJ2-018", "GJ2-019", "GJ2-035"]);
});
