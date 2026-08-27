import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign as signData } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { startFoundationHttpServer } from "../../apps/api/src/server.ts";
import { T20, cleanupT20BookingData, seedT20BookingTopology } from "../helpers/t20-booking-fixtures.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const RUNTIME_ROLE = "airen_runtime_ci";
const ENTITLEMENT = "rbl01b.booking.runtime";
const PROVIDER = "rbl01b-auth";
const AUDIENCE = "airenos-foundation";
const SERVICE_KID = "rbl01b-k1";
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");
const AUTH_KEY = randomBytes(32).toString("hex");
const CURSOR_KEY = randomBytes(32).toString("hex");
const { publicKey: SERVICE_PUBLIC_KEY, privateKey: SERVICE_PRIVATE_KEY } = generateKeyPairSync("ed25519");

type Json = Record<string, any>;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Unable to allocate test port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function provisionRuntimeLogin(): void {
  const result = spawnSync("psql", [DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-v", `runtime_password=${RUNTIME_PASSWORD}`, "-f", "tests/deployment/provision_runtime_login.sql"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Runtime login provisioning failed: ${result.stderr || result.stdout}`);
}

function runtimeDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = RUNTIME_ROLE;
  parsed.password = RUNTIME_PASSWORD;
  return parsed.toString();
}

function responseCorrelation(headers: Record<string, string | string[] | undefined>): string {
  const value = headers["x-correlation-id"];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function userToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: PROVIDER,
    aud: AUDIENCE,
    sub: "manager-a",
    sid: `rbl01b-${randomUUID()}`,
    iat: now - 5,
    exp: now + 300
  })).toString("base64url");
  return `${payload}.${createHmac("sha256", AUTH_KEY).update(payload).digest("base64url")}`;
}

function serviceAssertion(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: SERVICE_KID })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "ristoairen-rbl01b-experience",
    sub: "synthetic-booking-live-http-proof",
    aud: AUDIENCE,
    iat: now - 5,
    exp: now + 120,
    jti: randomUUID()
  })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = signData(null, Buffer.from(signingInput), SERVICE_PRIVATE_KEY).toString("base64url");
  return `${signingInput}.${signature}`;
}

async function requestJson(port: number, method: string, path: string, headers: Readonly<Record<string, string>>, body?: unknown) {
  return new Promise<{ status: number; body: Json; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        host: "t20-a.ristoairen.test",
        ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
        ...headers
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: Json = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        resolve({ status: response.statusCode ?? 0, body: parsed, headers: response.headers });
      });
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

test("RBL-01B real HTTP socket traverses governed Booking stack to PostgreSQL/RLS/audit/outbox", async () => {
  const root = new Pool({ connectionString: DATABASE_URL });
  let service: Awaited<ReturnType<typeof startFoundationHttpServer>> | undefined;
  let bookingId: string | undefined;

  try {
    await seedT20BookingTopology(root);
    await cleanupT20BookingData(root);

    await root.query(`INSERT INTO identity.provider_subject_links(identity_id,provider_key,provider_subject)
      VALUES($1,$2,'manager-a') ON CONFLICT(provider_key,provider_subject) DO UPDATE SET identity_id=EXCLUDED.identity_id`, [T20.managerA, PROVIDER]);

    await root.query(`INSERT INTO billing.entitlement_catalog(entitlement_key,description,status)
      VALUES($1,'Synthetic RBL-01B Booking runtime proof','active')
      ON CONFLICT(entitlement_key) DO UPDATE SET status='active',description=EXCLUDED.description,retired_at=NULL,updated_at=now()`, [ENTITLEMENT]);
    await root.query(`INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,source_ref,enabled,valid_from,config)
      VALUES($1,$2,'rbl01b_test','synthetic_live_http',true,now(),'{}'::jsonb)
      ON CONFLICT(tenant_id,entitlement_key) DO UPDATE SET enabled=true,source_kind=EXCLUDED.source_kind,source_ref=EXCLUDED.source_ref,valid_from=EXCLUDED.valid_from,valid_until=NULL,revoked_at=NULL,expired_at=NULL,updated_at=now()`, [T20.tenantA, ENTITLEMENT]);

    provisionRuntimeLogin();

    const port = await freePort();
    const runtimeUrl = runtimeDatabaseUrl(DATABASE_URL);
    const publicJwk = SERVICE_PUBLIC_KEY.export({ format: "jwk" });
    service = await startFoundationHttpServer({
      NODE_ENV: "test",
      APP_BASE_DOMAIN: "ristoairen.test",
      AUTH_ADAPTER: "signed-session",
      AUTH_PROVIDER_KEY: PROVIDER,
      AUTH_AUDIENCE: AUDIENCE,
      SECRET_MANAGER_ADAPTER: "env",
      DATABASE_URL_SECRET_REF: "secret://env/RBL01B_DATABASE_URL",
      AUTH_SESSION_KEY_SECRET_REF: "secret://env/RBL01B_AUTH_KEY",
      RBL01B_DATABASE_URL: runtimeUrl,
      RBL01B_AUTH_KEY: AUTH_KEY,
      HOST: "127.0.0.1",
      PORT: String(port),
      RELEASE_REVISION: process.env.GITHUB_SHA ?? "rbl01b-local",
      SHUTDOWN_TIMEOUT_MS: "5000",
      RISTOAIREN_BOOKING_ADAPTER_ENABLED: "true",
      RISTOAIREN_BOOKING_PROJECTION_ENABLED: "true",
      RISTOAIREN_BOOKING_MUTATION_ENABLED: "true",
      RISTOAIREN_BOOKING_REQUIRED_ENTITLEMENT: ENTITLEMENT,
      RISTOAIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF: "secret://env/RBL01B_CURSOR_KEY",
      RBL01B_CURSOR_KEY: CURSOR_KEY,
      RISTOAIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON: JSON.stringify({ [SERVICE_KID]: { key: publicJwk, enabled: true } })
    });

    const auth = `Bearer ${userToken()}`;

    const contextPreflight = await requestJson(port, "GET", "/v1/ristoairen/bookings?limit=1", {
      authorization: auth,
      "x-airen-service-assertion": serviceAssertion(),
      "x-airen-correlation-id": `untrusted-client-${randomUUID()}`
    });
    assert.equal(contextPreflight.status, 200, `context preflight failed: ${JSON.stringify(contextPreflight.body)}`);
    assert.ok(Array.isArray(contextPreflight.body.data?.items));
    const preflightCorrelation = responseCorrelation(contextPreflight.headers);
    assert.ok(preflightCorrelation);
    assert.equal(contextPreflight.body.correlation_id, preflightCorrelation);

    const create = await requestJson(port, "POST", "/v1/ristoairen/bookings", {
      authorization: auth,
      "x-airen-service-assertion": serviceAssertion(),
      "x-airen-correlation-id": `untrusted-client-${randomUUID()}`,
      "idempotency-key": "rbl01b-booking-create-0001"
    }, {
      source: "RBL01B_SYNTHETIC",
      partySize: 2,
      bookingDate: "2026-09-08",
      bookingTimeLocal: "19:30",
      expectedDurationMinutes: 90,
      customerNameSnapshot: "Synthetic Live HTTP Proof"
    });

    assert.equal(create.status, 201, `create failed: ${JSON.stringify(create.body)}`);
    bookingId = create.body.data?.booking?.id;
    assert.ok(bookingId);
    assert.equal(create.body.data?.replayed, false);
    const createCorrelation = responseCorrelation(create.headers);
    assert.ok(createCorrelation);
    assert.equal(create.body.correlation_id, createCorrelation);

    const read = await requestJson(port, "GET", `/v1/ristoairen/bookings/${bookingId}`, {
      authorization: auth,
      "x-airen-service-assertion": serviceAssertion(),
      "x-airen-correlation-id": `untrusted-client-${randomUUID()}`
    });
    assert.equal(read.status, 200);
    assert.equal(read.body.data?.id, bookingId);
    assert.equal(read.body.data?.customerNameSnapshot, "Synthetic Live HTTP Proof");
    assert.equal(read.body.correlation_id, responseCorrelation(read.headers));

    const noServiceAssertion = await requestJson(port, "POST", "/v1/ristoairen/bookings", {
      authorization: auth,
      "x-airen-correlation-id": `untrusted-client-${randomUUID()}`,
      "idempotency-key": "rbl01b-booking-denied-0001"
    }, {
      source: "RBL01B_SYNTHETIC",
      partySize: 3,
      bookingDate: "2026-09-08",
      bookingTimeLocal: "20:30",
      expectedDurationMinutes: 90,
      customerNameSnapshot: "Must Not Persist"
    });
    assert.equal(noServiceAssertion.status, 401);

    const booking = (await root.query(`SELECT tenant_id,location_id,environment_class FROM risto_bookings WHERE id=$1`, [bookingId])).rows[0];
    assert.equal(booking.tenant_id, T20.tenantA);
    assert.equal(booking.location_id, T20.locationA1);
    assert.equal(booking.environment_class, "TEST_TEMPORARY");
    assert.equal(Number((await root.query(`SELECT count(*)::int c FROM risto_bookings WHERE tenant_id=$1`, [T20.tenantA])).rows[0].c), 1);

    const audit = (await root.query(`SELECT action_key,correlation_id,outcome FROM audit.audit_events WHERE tenant_id=$1 AND resource_id=$2 ORDER BY created_at DESC LIMIT 1`, [T20.tenantA, bookingId])).rows[0];
    assert.equal(audit.action_key, "BOOKING_CREATED");
    assert.equal(audit.correlation_id, createCorrelation);
    assert.equal(audit.outcome, "success");

    const outbox = (await root.query(`SELECT event_type,correlation_id,payload FROM events.outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 ORDER BY created_at DESC LIMIT 1`, [T20.tenantA, bookingId])).rows[0];
    assert.equal(outbox.event_type, "booking.created.v1");
    assert.equal(outbox.correlation_id, createCorrelation);
    assert.equal(outbox.payload.booking_id, bookingId);
    assert.equal(outbox.payload.party_size, 2);
  } finally {
    if (service) await service.stop("rbl01b-test-complete");
    await cleanupT20BookingData(root);
    await root.query(`DELETE FROM billing.tenant_entitlements WHERE tenant_id=$1 AND entitlement_key=$2`, [T20.tenantA, ENTITLEMENT]);
    await root.query(`DELETE FROM billing.entitlement_catalog WHERE entitlement_key=$1`, [ENTITLEMENT]);
    await root.query(`DELETE FROM identity.provider_subject_links WHERE provider_key=$1 AND provider_subject='manager-a'`, [PROVIDER]);
    await root.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
    await root.end();
  }
});
