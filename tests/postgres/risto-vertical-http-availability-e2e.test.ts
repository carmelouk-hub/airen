import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { buildRistoVerticalRequestBinding } from "../../apps/api/src/risto-vertical-trusted-context.ts";
import { startGate093FixtureServer, SYNTHETIC } from "../integration/risto-vertical-http-fixture.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
let runtime: Awaited<ReturnType<typeof startGate093FixtureServer>>;
let baseUrl = "";

function canonicalObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalObject((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function encode(value: unknown): string { return Buffer.from(JSON.stringify(canonicalObject(value))).toString("base64url"); }

function issue(input: Readonly<{
  operation: "booking.create" | "availability.read";
  actorId?: string;
  tenantId?: string;
  locationId?: string;
  audience?: string;
  idempotencyKey?: string | null;
  platformPermissions?: readonly string[];
  entitlements?: readonly string[];
  correlationId?: string;
  bindingOperation?: string;
  issuedAt?: number;
  expiresAt?: number;
}>): string {
  const now = Math.floor(Date.now() / 1000);
  const binding = buildRistoVerticalRequestBinding({
    method: "POST",
    operation: input.bindingOperation ?? input.operation,
    idempotencyKey: input.operation === "booking.create" ? input.idempotencyKey : null,
  });
  const actor = input.actorId ?? SYNTHETIC.allowedActorId;
  const header = { alg: "EdDSA", typ: "AIRENOS-VPC" };
  const payload = {
    iss: "airenos-gate093",
    aud: input.audience ?? "ristoairen-gate093",
    sub: actor,
    actor,
    tenant_id: input.tenantId ?? SYNTHETIC.tenantId,
    location_id: input.locationId ?? SYNTHETIC.locationId,
    platform_roles: ["pilot_operator"],
    platform_permissions: input.platformPermissions ?? ["platform.vertical.use"],
    entitlements: input.entitlements ?? ["availability.enabled", "airen.booking"],
    correlation_id: input.correlationId ?? "gate099-correlation",
    request_binding: binding,
    iat: input.issuedAt ?? now - 5,
    exp: input.expiresAt ?? now + 60,
    jti: `gate099-${Math.random().toString(16).slice(2)}`,
  };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  return `${signingInput}.${cryptoSign(null, Buffer.from(signingInput), privateKey).toString("base64url")}`;
}

async function createBooking(input: { key: string; time: string; duration: number; partySize: number }) {
  const token = issue({ operation: "booking.create", idempotencyKey: input.key, correlationId: `gate099-booking-${input.key}` });
  return fetch(`${baseUrl}/v1/bookings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-airenos-trusted-context": token,
      "idempotency-key": input.key,
    },
    body: JSON.stringify({
      source: "VERTICAL_PILOT",
      partySize: input.partySize,
      bookingDate: "2026-09-27",
      bookingTimeLocal: input.time,
      expectedDurationMinutes: input.duration,
      customerNameSnapshot: "Gate099 Synthetic Occupancy",
    }),
  });
}

async function availability(token: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/v1/availability/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-airenos-trusted-context": token,
    },
    body: JSON.stringify(body),
  });
}

const query = Object.freeze({
  bookingDate: "2026-09-27",
  partySize: 2,
  expectedDurationMinutes: 60,
});

test.before(async () => {
  runtime = await startGate093FixtureServer({ databaseUrl: DATABASE_URL, publicKeyPem, port: 0 });
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("fixture address unavailable");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => { await runtime.close(); });

test("Gate099 Availability HTTP adapter is deterministic, occupancy-aware and side-effect-free", async () => {
  const created = await createBooking({ key: "gate099-overlap", time: "19:00", duration: 60, partySize: 5 });
  assert.equal(created.status, 201);

  const before = {
    bookings: Number((await runtime.pool.query("SELECT count(*)::int AS n FROM risto_bookings")).rows[0].n),
    audits: Number((await runtime.pool.query("SELECT count(*)::int AS n FROM audit.audit_events")).rows[0].n),
    outbox: Number((await runtime.pool.query("SELECT count(*)::int AS n FROM events.outbox_events")).rows[0].n),
  };

  const token = issue({ operation: "availability.read", correlationId: "gate099-availability-positive" });
  const first = await availability(token, query);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-correlation-id"), "gate099-availability-positive");
  const body = await first.json() as Record<string, any>;
  assert.equal(body.ok, true);
  assert.equal(body.correlation_id, "gate099-availability-positive");
  const candidates = body.data.candidates as Array<Record<string, string>>;
  assert.equal(candidates.some((candidate) => candidate.startsAtLocal === "18:00"), true);
  assert.equal(candidates.some((candidate) => candidate.startsAtLocal === "18:30"), false);
  assert.equal(candidates.some((candidate) => candidate.startsAtLocal === "19:00"), false);
  assert.equal(candidates.some((candidate) => candidate.startsAtLocal === "19:30"), false);
  assert.equal(candidates.some((candidate) => candidate.startsAtLocal === "20:00"), true);

  const replay = await availability(issue({ operation: "availability.read", correlationId: "gate099-availability-replay" }), query);
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json() as Record<string, any>).data.candidates, candidates);

  const after = {
    bookings: Number((await runtime.pool.query("SELECT count(*)::int AS n FROM risto_bookings")).rows[0].n),
    audits: Number((await runtime.pool.query("SELECT count(*)::int AS n FROM audit.audit_events")).rows[0].n),
    outbox: Number((await runtime.pool.query("SELECT count(*)::int AS n FROM events.outbox_events")).rows[0].n),
  };
  assert.deepEqual(after, before);
});

test("Gate099 Availability HTTP authorization and trust boundaries fail closed", async (t) => {
  await t.test("platform permission cannot replace availability.read", async () => {
    const token = issue({
      operation: "availability.read",
      actorId: SYNTHETIC.deniedActorId,
      platformPermissions: ["availability.read", "platform.vertical.use"],
    });
    assert.equal((await availability(token, query)).status, 403);
  });

  await t.test("missing entitlement is denied", async () => {
    const token = issue({ operation: "availability.read", entitlements: ["airen.booking"] });
    assert.equal((await availability(token, query)).status, 403);
  });

  await t.test("cross tenant and cross location remain denied", async () => {
    assert.equal((await availability(issue({ operation: "availability.read", tenantId: SYNTHETIC.crossTenantId }), query)).status, 404);
    assert.equal((await availability(issue({ operation: "availability.read", locationId: SYNTHETIC.otherLocationId }), query)).status, 403);
  });

  await t.test("wrong audience, expired token and request-binding mismatch are rejected", async () => {
    assert.equal((await availability(issue({ operation: "availability.read", audience: "wrong" }), query)).status, 401);
    const now = Math.floor(Date.now() / 1000);
    assert.equal((await availability(issue({ operation: "availability.read", issuedAt: now - 120, expiresAt: now - 60 }), query)).status, 401);
    assert.equal((await availability(issue({ operation: "availability.read", bindingOperation: "booking.create" }), query)).status, 401);
  });
});

test("Gate099 validates query body and never accepts client authority fields", async () => {
  const token = issue({ operation: "availability.read" });
  assert.equal((await availability(token, { ...query, expectedDurationMinutes: 7 })).status, 400);
  assert.equal((await availability(token, { ...query, tenantId: SYNTHETIC.tenantId })).status, 403);
});
