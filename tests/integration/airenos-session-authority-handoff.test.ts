import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySingleUseSessionHandoffStore } from "../../apps/api/src/session-authority-handoff.ts";

const payload = Object.freeze({
  accessToken: "test-only-token-not-a-secret",
  sessionId: "sid-test",
  issuedAtIso: "2026-09-13T14:00:00.000Z",
  expiresAtIso: "2026-09-13T14:05:00.000Z",
});

test("session handoff is opaque, bounded and single-use", () => {
  let now = Date.parse("2026-09-13T14:00:00.000Z");
  const store = new InMemorySingleUseSessionHandoffStore(90_000, () => now);
  const issued = store.issue(payload);

  assert.match(issued.handoff, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.handoff.includes(payload.accessToken), false);
  assert.equal(issued.expiresAtIso, "2026-09-13T14:01:30.000Z");
  assert.deepEqual(store.redeem(issued.handoff), payload);
  assert.equal(store.redeem(issued.handoff), null);
});

test("expired and malformed handoffs fail closed", () => {
  let now = Date.parse("2026-09-13T14:00:00.000Z");
  const store = new InMemorySingleUseSessionHandoffStore(1_000, () => now);
  const issued = store.issue(payload);

  assert.equal(store.redeem("not-a-valid-handoff"), null);
  now += 1_001;
  assert.equal(store.redeem(issued.handoff), null);
  assert.equal(store.redeem(issued.handoff), null);
});

test("handoff TTL rejects unsafe bounds", () => {
  assert.throws(() => new InMemorySingleUseSessionHandoffStore(999), /TTL/);
  assert.throws(() => new InMemorySingleUseSessionHandoffStore(300_001), /TTL/);
});
