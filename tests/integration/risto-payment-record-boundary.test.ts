import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import type { AuditRecord } from "../../packages/audit-events/src/index.ts";
import {
  recordPayment,
  type OrderForPayment,
  type PaymentForRecord,
  type PaymentRecordInput,
  type PaymentRecordTransaction
} from "../../packages/ristoairen/src/pos/payment-record.ts";

const context: SecurityContext = Object.freeze({
  correlationId: "mat012-correlation",
  actorIdentityId: "identity-1",
  platformRoles: [],
  platformPermissions: [],
  tenantId: "tenant-1",
  locationId: "location-1",
  tenantMembershipId: "tm-1",
  locationMembershipId: "lm-1",
  tenantRole: "responsabile",
  locationRole: "responsabile",
  permissions: ["pos.payment.record"],
  entitlements: ["vertical.ristoairen"]
});

const order: OrderForPayment = Object.freeze({
  id: "order-1",
  tenantId: "tenant-1",
  locationId: "location-1",
  currency: "EUR",
  total: "100.00",
  rowVersion: 7,
  environmentClass: "TEST_TEMPORARY"
});

function input(overrides: Partial<PaymentRecordInput> = {}): PaymentRecordInput {
  return {
    orderId: "order-1",
    paymentMethod: "CASH",
    amount: "30.00",
    currency: "EUR",
    idempotencyKey: "idem-1",
    ...overrides
  };
}

function payment(overrides: Partial<PaymentForRecord> = {}): PaymentForRecord {
  return {
    id: "payment-existing",
    tenantId: "tenant-1",
    locationId: "location-1",
    orderId: "order-1",
    paymentMethod: "CARD",
    amount: "20.00",
    currency: "EUR",
    status: "RECORDED",
    receivedAt: "2026-09-10T08:00:00.000Z",
    recordedBy: "identity-1",
    idempotencyKey: "old-idem",
    metadataSanitized: {},
    rowVersion: 1,
    environmentClass: "TEST_TEMPORARY",
    ...overrides
  };
}

function harness(options: {
  order?: OrderForPayment | null;
  existing?: readonly PaymentForRecord[];
  replay?: PaymentForRecord | null;
  auditFails?: boolean;
} = {}) {
  const inserted: PaymentForRecord[] = [];
  const audits: AuditRecord[] = [];
  let rolledBack = false;

  const unitOfWork = {
    async transaction<T>(fn: (tx: PaymentRecordTransaction) => Promise<T>): Promise<T> {
      const tx: PaymentRecordTransaction = {
        getOrderForPayment: async () => options.order === undefined ? order : options.order,
        findPaymentByIdempotencyKey: async () => options.replay ?? null,
        listEffectivePaymentsForOrder: async () => options.existing ?? [],
        insertPayment: async (draft) => {
          const created = Object.freeze({ id: `payment-${inserted.length + 1}`, ...draft });
          inserted.push(created);
          return created;
        },
        audit: async (record) => {
          if (options.auditFails) throw new Error("synthetic audit failure");
          audits.push(record);
        },
        outbox: async () => {}
      };
      try {
        return await fn(tx);
      } catch (error) {
        inserted.length = 0;
        audits.length = 0;
        rolledBack = true;
        throw error;
      }
    }
  };

  return {
    deps: { unitOfWork, now: () => "2026-09-10T08:30:00.000Z" },
    inserted,
    audits,
    get rolledBack() { return rolledBack; }
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

test("records Payment and PAYMENT_RECORDED audit in one UnitOfWork", async () => {
  const h = harness();
  const result = await recordPayment(context, input(), h.deps);
  assert.equal(result.replayed, false);
  assert.equal(result.payment.amount, "30.00");
  assert.equal(result.payment.recordedBy, context.actorIdentityId);
  assert.equal(h.inserted.length, 1);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].actionKey, "PAYMENT_RECORDED");
  assert.equal(h.audits[0].correlationId, context.correlationId);
});

test("calculates outstanding from canonical effective payments", async () => {
  const h = harness({ existing: [payment({ amount: "70.00" })] });
  const result = await recordPayment(context, input(), h.deps);
  assert.equal(result.payment.amount, "30.00");
  assert.equal(h.audits[0].metadata?.observedOutstandingMinor, 3000);
});

test("denies missing pos.payment.record permission", async () => {
  const h = harness();
  await expectCode(recordPayment({ ...context, permissions: [] }, input(), h.deps), "PERMISSION_DENIED");
  assert.equal(h.inserted.length, 0);
});

test("denies missing RISTOAIREN entitlement", async () => {
  const h = harness();
  await expectCode(recordPayment({ ...context, entitlements: [] }, input(), h.deps), "ENTITLEMENT_REQUIRED");
  assert.equal(h.inserted.length, 0);
});

test("denies cross-tenant Order", async () => {
  const h = harness({ order: { ...order, tenantId: "tenant-other" } });
  await expectCode(recordPayment(context, input(), h.deps), "TENANT_SCOPE_VIOLATION");
  assert.equal(h.inserted.length, 0);
});

test("denies cross-location Order", async () => {
  const h = harness({ order: { ...order, locationId: "location-other" } });
  await expectCode(recordPayment(context, input(), h.deps), "LOCATION_SCOPE_VIOLATION");
  assert.equal(h.inserted.length, 0);
});

test("denies currency mismatch", async () => {
  const h = harness();
  await expectCode(recordPayment(context, input({ currency: "USD" }), h.deps), "CONFLICT");
  assert.equal(h.inserted.length, 0);
});

test("denies overpayment from server-calculated outstanding", async () => {
  const h = harness({ existing: [payment({ amount: "80.00" })] });
  await expectCode(recordPayment(context, input({ amount: "30.00" }), h.deps), "CONFLICT");
  assert.equal(h.inserted.length, 0);
});

test("replays same semantic idempotent request without a second write", async () => {
  const replay = payment({ paymentMethod: "CASH", amount: "30.00", idempotencyKey: "idem-1" });
  const h = harness({ replay });
  const result = await recordPayment(context, input(), h.deps);
  assert.equal(result.replayed, true);
  assert.equal(result.payment.id, replay.id);
  assert.equal(h.inserted.length, 0);
  assert.equal(h.audits.length, 0);
});

test("conflicting idempotency key fails and audit failure rolls back payment", async () => {
  const replay = payment({ paymentMethod: "CASH", amount: "31.00", idempotencyKey: "idem-1" });
  const conflictHarness = harness({ replay });
  await expectCode(recordPayment(context, input(), conflictHarness.deps), "IDEMPOTENCY_CONFLICT");

  const auditHarness = harness({ auditFails: true });
  await assert.rejects(recordPayment(context, input(), auditHarness.deps), /synthetic audit failure/);
  assert.equal(auditHarness.rolledBack, true);
  assert.equal(auditHarness.inserted.length, 0);
  assert.equal(auditHarness.audits.length, 0);
});
