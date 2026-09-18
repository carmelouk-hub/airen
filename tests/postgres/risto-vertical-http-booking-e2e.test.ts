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
  actorId?: string;
  tenantId?: string;
  locationId?: string;
  audience?: string;
  idempotencyKey?: string;
  platformPermissions?: readonly string[];
  entitlements?: readonly string[];
  correlationId?: string;
  bindingMethod?: string;
  bindingOperation?: string;
  issuedAt?: number;
  expiresAt?: number;
}> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const idempotencyKey = input.idempotencyKey ?? "gate093-idem-1";
  const binding = buildRistoVerticalRequestBinding({
    method: input.bindingMethod ?? "POST",
    operation: input.bindingOperation ?? "booking.create",
    idempotencyKey,
  });
  const header = { alg: "EdDSA", typ: "AIRENOS-VPC" };
  const actor = input.actorId ?? SYNTHETIC.allowedActorId;
  const payload = {
    iss: "airenos-gate093",
    aud: input.audience ?? "ristoairen-gate093",
    sub: actor,
    actor,
    tenant_id: input.tenantId ?? SYNTHETIC.tenantId,
    location_id: input.locationId ?? SYNTHETIC.locationId,
    platform_roles: ["pilot_operator"],
    platform_permissions: input.platformPermissions ?? ["platform.vertical.use"],
    entitlements: input.entitlements ?? ["airen.booking"],
    correlation_id: input.correlationId ?? "gate093-correlation-1",
    request_binding: binding,
    iat: input.issuedAt ?? now - 5,
    exp: input.expiresAt ?? now + 60,
    jti: `gate093-${Math.random().toString(16).slice(2)}`,
  };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  return `${signingInput}.${cryptoSign(null, Buffer.from(signingInput), privateKey).toString("base64url")}`;
}

async function post(token: string, idempotencyKey: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/v1/bookings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-airenos-trusted-context": token,
      "idempotency-key": idempotencyKey,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const bookingBody = Object.freeze({
  source: "VERTICAL_PILOT",
  partySize: 2,
  bookingDate: "2026-09-25",
  bookingTimeLocal: "20:00",
  expectedDurationMinutes: 120,
  customerNameSnapshot: "Gate093 Synthetic Guest",
});

test.before(async () => {
  runtime = await startGate093FixtureServer({ databaseUrl: DATABASE_URL, publicKeyPem, port: 0 });
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("fixture address unavailable");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => { await runtime.close(); });

test("Gate093 HTTP adapter creates one canonical Booking and preserves correlation/idempotency", async () => {
  const idempotencyKey = "gate093-positive";
  const correlationId = "gate093-corr-positive";
  const token = issue({ idempotencyKey, correlationId });

  const first = await post(token, idempotencyKey, bookingBody);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("x-correlation-id"), correlationId);
  const firstBody = await first.json() as Record<string, any>;
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.replayed, false);
  assert.equal(firstBody.correlation_id, correlationId);

  const replay = await post(token, idempotencyKey, bookingBody);
  assert.equal(replay.status, 200);
  const replayBody = await replay.json() as Record<string, any>;
  assert.equal(replayBody.replayed, true);
  assert.equal(replayBody.data.id, firstBody.data.id);

  const audit = await runtime.pool.query(
    "SELECT tenant_id::text AS tenant, location_id::text AS location, correlation_id FROM audit.audit_events WHERE action_key='BOOKING_CREATED' AND correlation_id=$1",
    [correlationId],
  );
  assert.deepEqual(audit.rows[0], { tenant: SYNTHETIC.tenantId, location: SYNTHETIC.locationId, correlation_id: correlationId });
});

test("Gate093 idempotency conflict fails without additional mutation", async () => {
  const idempotencyKey = "gate093-conflict";
  const token = issue({ idempotencyKey, correlationId: "gate093-corr-conflict" });
  const first = await post(token, idempotencyKey, bookingBody);
  assert.equal(first.status, 201);

  const conflict = await post(token, idempotencyKey, { ...bookingBody, partySize: 5 });
  assert.equal(conflict.status, 409);
  const body = await conflict.json() as Record<string, any>;
  assert.equal(body.code, "IDEMPOTENCY_CONFLICT");
});

test("Gate093 trusted context negatives fail closed", async (t) => {
  const idem = "gate093-negative";

  await t.test("tampered token", async () => {
    const token = issue({ idempotencyKey: idem });
    const [header, payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.tenant_id = SYNTHETIC.crossTenantId;
    const tampered = `${header}.${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
    assert.equal((await post(tampered, idem, bookingBody)).status, 401);
  });

  await t.test("wrong audience", async () => {
    assert.equal((await post(issue({ idempotencyKey: idem, audience: "wrong" }), idem, bookingBody)).status, 401);
  });

  await t.test("expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal((await post(issue({ idempotencyKey: idem, issuedAt: now - 120, expiresAt: now - 60 }), idem, bookingBody)).status, 401);
  });

  await t.test("request binding mismatch", async () => {
    const token = issue({ idempotencyKey: idem, bindingMethod: "PATCH", bindingOperation: "booking.update" });
    assert.equal((await post(token, idem, bookingBody)).status, 401);
  });
});

test("Gate093 preserves RISTOAIREN domain authorization and tenant/location isolation", async (t) => {
  await t.test("platform permission cannot replace Hospitality permission", async () => {
    const idem = "gate093-domain-denied";
    const token = issue({
      actorId: SYNTHETIC.deniedActorId,
      idempotencyKey: idem,
      platformPermissions: ["booking.create", "platform.vertical.use"],
    });
    assert.equal((await post(token, idem, bookingBody)).status, 403);
  });

  await t.test("cross tenant fails closed", async () => {
    const idem = "gate093-cross-tenant";
    const token = issue({ tenantId: SYNTHETIC.crossTenantId, idempotencyKey: idem });
    assert.equal((await post(token, idem, bookingBody)).status, 404);
  });

  await t.test("cross location fails closed", async () => {
    const idem = "gate093-cross-location";
    const token = issue({ locationId: SYNTHETIC.otherLocationId, idempotencyKey: idem });
    assert.equal((await post(token, idem, bookingBody)).status, 403);
  });
});
