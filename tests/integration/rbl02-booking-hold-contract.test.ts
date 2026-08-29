import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { BOOKING_STATUSES } from "../../packages/ristoairen/src/booking/contracts.ts";
import {
  BOOKING_GUARANTEE_MODES,
  BOOKING_HOLD_ALLOWED_TRANSITIONS,
  BOOKING_HOLD_STATUSES,
  BookingHoldApplicationService,
  assertBookingHoldConvertible,
  initialBookingHoldStatus,
  selectBookingGuaranteePolicy,
  validateBookingHoldCreate,
  validateBookingHoldTransition
} from "../../packages/ristoairen/src/booking/index.ts";
import type {
  BookingGuaranteePolicyProjectionV1,
  BookingHoldIdempotencyClaim,
  BookingHoldIdempotencyResultV1,
  BookingHoldIdempotencyScope,
  BookingHoldMutationTransaction,
  BookingHoldPrivateProjectionV1,
  BookingHoldUnitOfWork
} from "../../packages/ristoairen/src/booking/hold-contracts.ts";

const context = (permissions: readonly string[]): SecurityContext => Object.freeze({
  correlationId: "gate-b-contract",
  actorIdentityId: "actor-a",
  platformRoles: [],
  platformPermissions: [],
  tenantId: "tenant-a",
  locationId: "location-a1",
  tenantRole: "manager",
  locationRole: "manager",
  permissions,
  entitlements: []
});

const baseInput = Object.freeze({
  sourceChannel: "DIRECT_WEB",
  resourceKey: "DINNER",
  partySize: 2,
  bookingDate: "2026-09-01",
  bookingTimeLocal: "20:00",
  expectedDurationMinutes: 120,
  customerNameSnapshot: "Synthetic Guest"
});

const policy = (overrides: Partial<BookingGuaranteePolicyProjectionV1> = {}): BookingGuaranteePolicyProjectionV1 => Object.freeze({
  id: "policy-none",
  status: "active",
  guaranteeMode: "NONE",
  holdDurationSeconds: 600,
  priority: 100,
  ...overrides
});

const hold = (overrides: Partial<BookingHoldPrivateProjectionV1> = {}): BookingHoldPrivateProjectionV1 => Object.freeze({
  id: "hold-1",
  status: "CREATED",
  sourceChannel: "DIRECT_WEB",
  resourceKey: "DINNER",
  partySize: 2,
  capacityClaim: 2,
  bookingDate: "2026-09-01",
  bookingTimeLocal: "20:00",
  startsAt: "2026-09-01T18:00:00.000Z",
  expectedDurationMinutes: 120,
  expiresAt: "2026-09-01T17:50:00.000Z",
  guaranteePolicyId: "policy-none",
  guaranteeMode: "NONE",
  customerNameSnapshot: "Synthetic Guest",
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
  rowVersion: 1,
  ...overrides
});

class FakeTx implements BookingHoldMutationTransaction {
  claim: BookingHoldIdempotencyClaim = { kind: "NEW" };
  current: BookingHoldPrivateProjectionV1 | null = hold();
  policies: readonly BookingGuaranteePolicyProjectionV1[] = [policy()];
  audits: unknown[] = [];
  outbox: unknown[] = [];
  completed: BookingHoldIdempotencyResultV1[] = [];
  transitions: Array<{ from: string; to: string }> = [];

  findVisibleHoldById = async () => this.current;
  listGuaranteePolicies = async () => this.policies;
  claimHoldIdempotency = async (_scope: BookingHoldIdempotencyScope) => this.claim;
  completeHoldIdempotency = async (_scope: BookingHoldIdempotencyScope, result: BookingHoldIdempotencyResultV1) => { this.completed.push(result); };
  insertHold = async () => hold();
  transitionHoldStatus = async (
    _holdId: string,
    fromStatus: BookingHoldPrivateProjectionV1["status"],
    toStatus: BookingHoldPrivateProjectionV1["status"],
    rowVersion: number
  ) => {
    this.transitions.push({ from: fromStatus, to: toStatus });
    return hold({ status: toStatus, rowVersion: rowVersion + 1 });
  };
  appendHoldAudit = async (event: unknown) => { this.audits.push(event); };
  appendHoldOutbox = async (event: unknown) => { this.outbox.push(event); };
}

class FakeUow implements BookingHoldUnitOfWork {
  readonly tx: FakeTx;
  constructor(tx = new FakeTx()) { this.tx = tx; }
  transaction = async <T>(_context: SecurityContext, fn: (tx: BookingHoldMutationTransaction) => Promise<T>) => fn(this.tx);
}

function service(uow = new FakeUow()) {
  return {
    uow,
    service: new BookingHoldApplicationService(uow, { assertRistoAirenAccess: () => undefined })
  };
}

test("RBL02-C01 BookingHold states are exact and remain separate from Booking statuses", () => {
  assert.deepEqual(BOOKING_HOLD_STATUSES, ["CREATED","GUARANTEE_REQUIRED","GUARANTEE_PENDING","GUARANTEED","CONVERTED","EXPIRED","CANCELLED","FAILED"]);
  assert.deepEqual(BOOKING_STATUSES, ["REQUESTED","PENDING","CONFIRMED","ARRIVED","SEATED","COMPLETED","CANCELLED","NO_SHOW"]);
  assert.equal((BOOKING_STATUSES as readonly string[]).includes("HOLD"), false);
});

test("RBL02-C02 guarantee modes are frozen exactly", () => {
  assert.deepEqual(BOOKING_GUARANTEE_MODES, ["NONE","PAYMENT_METHOD_GUARANTEE","DEPOSIT","FULL_PREPAYMENT","AUTHORIZATION_HOLD"]);
});

test("RBL02-C03 guarantee NONE reaches GUARANTEED while financial modes require guarantee", () => {
  assert.equal(initialBookingHoldStatus("NONE"), "GUARANTEED");
  assert.equal(initialBookingHoldStatus("DEPOSIT"), "GUARANTEE_REQUIRED");
});

test("RBL02-C04 client Tenant/Location spoof is rejected and capacity defaults to party size", () => {
  assert.throws(() => validateBookingHoldCreate({ ...baseInput, tenant_id: "spoof" } as any), (error: any) => error instanceof AppError && error.code === "TENANT_SCOPE_VIOLATION");
  assert.deepEqual(validateBookingHoldCreate(baseInput).capacityClaim, 2);
});

test("RBL02-C05 capacity claim smaller than party size is rejected", () => {
  assert.throws(() => validateBookingHoldCreate({ ...baseInput, capacityClaim: 1 }), (error: any) => error instanceof AppError && error.code === "VALIDATION_FAILED");
});

test("RBL02-C06 policy selection uses highest priority and fails closed on ambiguity", () => {
  const selected = selectBookingGuaranteePolicy([policy({ id: "low", priority: 10 }), policy({ id: "high", priority: 20, guaranteeMode: "DEPOSIT" })], baseInput);
  assert.equal(selected.id, "high");
  assert.throws(
    () => selectBookingGuaranteePolicy([policy({ id: "a", priority: 20 }), policy({ id: "b", priority: 20 })], baseInput),
    (error: any) => error instanceof AppError && error.code === "CONFLICT" && error.message === "BOOKING_GUARANTEE_POLICY_AMBIGUOUS"
  );
});

test("RBL02-C07 missing applicable guarantee policy fails closed", () => {
  assert.throws(
    () => selectBookingGuaranteePolicy([policy({ status: "disabled" })], baseInput),
    (error: any) => error instanceof AppError && error.code === "CONFLICT" && error.message === "BOOKING_GUARANTEE_POLICY_NOT_CONFIGURED"
  );
});

test("RBL02-C08 allowed transition matrix preserves terminal states", () => {
  assert.deepEqual(BOOKING_HOLD_ALLOWED_TRANSITIONS.CREATED, ["GUARANTEE_REQUIRED","GUARANTEED","CANCELLED","EXPIRED","FAILED"]);
  assert.deepEqual(BOOKING_HOLD_ALLOWED_TRANSITIONS.CONVERTED, []);
  assert.deepEqual(BOOKING_HOLD_ALLOWED_TRANSITIONS.EXPIRED, []);
  assert.deepEqual(BOOKING_HOLD_ALLOWED_TRANSITIONS.CANCELLED, []);
  assert.deepEqual(BOOKING_HOLD_ALLOWED_TRANSITIONS.FAILED, []);
  assert.throws(() => validateBookingHoldTransition("GUARANTEED", "GUARANTEE_PENDING"), (error: any) => error instanceof AppError && error.code === "CONFLICT");
});

test("RBL02-C09 conversion guard requires GUARANTEED, unexpired and not already converted", () => {
  assert.doesNotThrow(() => assertBookingHoldConvertible(hold({ status: "GUARANTEED", expiresAt: "2026-09-01T18:00:00.000Z" }), new Date("2026-09-01T17:00:00.000Z")));
  assert.throws(() => assertBookingHoldConvertible(hold({ status: "GUARANTEE_REQUIRED" }), new Date("2026-09-01T17:00:00.000Z")), AppError);
  assert.throws(() => assertBookingHoldConvertible(hold({ status: "GUARANTEED", expiresAt: "2026-09-01T16:00:00.000Z" }), new Date("2026-09-01T17:00:00.000Z")), AppError);
  assert.throws(() => assertBookingHoldConvertible(hold({ status: "GUARANTEED", conversionBookingId: "booking-1" }), new Date("2026-09-01T17:00:00.000Z")), AppError);
});

test("RBL02-C10 create reuses booking.create least-privilege authority", async () => {
  const { service: subject } = service();
  await assert.rejects(() => subject.create(context([]), baseInput, "hold-key"), (error: any) => error instanceof AppError && error.code === "PERMISSION_DENIED");
});

test("RBL02-C11 create with NONE policy transitions CREATED to GUARANTEED and emits minimized evidence", async () => {
  const { service: subject, uow } = service();
  const result = await subject.create(context(["booking.create"]), { ...baseInput, phoneSnapshot: "secret-phone" }, "hold-key-none");
  assert.equal(result.replayed, false);
  assert.equal(result.hold.status, "GUARANTEED");
  assert.deepEqual(uow.tx.transitions, [{ from: "CREATED", to: "GUARANTEED" }]);
  assert.equal(uow.tx.audits.length, 1);
  assert.equal(uow.tx.outbox.length, 1);
  assert.doesNotMatch(JSON.stringify(uow.tx.outbox), /secret-phone|email|notes|special/i);
});

test("RBL02-C12 create with deposit policy reaches GUARANTEE_REQUIRED", async () => {
  const uow = new FakeUow();
  uow.tx.policies = [policy({ id: "deposit", guaranteeMode: "DEPOSIT" })];
  const subject = new BookingHoldApplicationService(uow, { assertRistoAirenAccess: () => undefined });
  const result = await subject.create(context(["booking.create"]), baseInput, "hold-key-deposit");
  assert.equal(result.hold.status, "GUARANTEE_REQUIRED");
});

test("RBL02-C13 idempotent create replay emits no duplicate audit or outbox", async () => {
  const uow = new FakeUow();
  uow.tx.claim = { kind: "REPLAY", result: { hold: hold({ status: "GUARANTEED" }), replayed: false } };
  const subject = new BookingHoldApplicationService(uow, { assertRistoAirenAccess: () => undefined });
  const result = await subject.create(context(["booking.create"]), baseInput, "hold-key-replay");
  assert.equal(result.replayed, true);
  assert.equal(uow.tx.audits.length, 0);
  assert.equal(uow.tx.outbox.length, 0);
});

test("RBL02-C14 cancel reuses booking.update and emits status-only evidence", async () => {
  const uow = new FakeUow();
  uow.tx.current = hold({ status: "GUARANTEED", rowVersion: 2 });
  const subject = new BookingHoldApplicationService(uow, { assertRistoAirenAccess: () => undefined });
  const result = await subject.cancel(context(["booking.update"]), "hold-1", { rowVersion: 2, reason: "guest_cancelled" }, "hold-cancel");
  assert.equal(result.hold.status, "CANCELLED");
  assert.equal(uow.tx.audits.length, 1);
  assert.equal(uow.tx.outbox.length, 1);
  assert.doesNotMatch(JSON.stringify(uow.tx.outbox), /phone|email|notes|special/i);
});

test("RBL02-C15 product entitlement guard remains mandatory", async () => {
  const uow = new FakeUow();
  const subject = new BookingHoldApplicationService(uow, {
    assertRistoAirenAccess: () => { throw new AppError("ENTITLEMENT_REQUIRED", "no product access"); }
  });
  await assert.rejects(() => subject.create(context(["booking.create"]), baseInput, "hold-key"), (error: any) => error instanceof AppError && error.code === "ENTITLEMENT_REQUIRED");
});
