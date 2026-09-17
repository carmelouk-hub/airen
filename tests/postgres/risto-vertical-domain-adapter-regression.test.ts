import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { AIREN_BOOKING_ENTITLEMENT, type BookingReadRepository } from "../../packages/booking-core/src/contracts.ts";
import { BookingApplicationService } from "../../packages/booking-core/src/application-service.ts";
import { PostgresFoundationReadStore, PostgresLocationRepositoryAdapter, PostgresTenantRepositoryAdapter } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-repository.ts";
import { buildRistoVerticalRequestBinding, verifyAirenOsVerticalTrustedContext } from "../../apps/api/src/risto-vertical-trusted-context.ts";
import { buildRistoVerticalSecurityContext } from "../../apps/api/src/risto-vertical-security-context.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

const TENANT = "e0010000-0000-4000-8000-000000000001";
const LOCATION = "e0010000-0000-4000-8000-000000000002";
const OTHER_LOCATION = "e0010000-0000-4000-8000-000000000003";
const ALLOWED_IDENTITY = "e0010000-0000-4000-8000-000000000010";
const DENIED_IDENTITY = "e0010000-0000-4000-8000-000000000011";
const ALLOWED_MEMBERSHIP = "e0010000-0000-4000-8000-000000000020";
const DENIED_MEMBERSHIP = "e0010000-0000-4000-8000-000000000021";
const ALLOWED_LOCATION_MEMBERSHIP = "e0010000-0000-4000-8000-000000000030";
const DENIED_LOCATION_MEMBERSHIP = "e0010000-0000-4000-8000-000000000031";

function canonicalObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalObject((value as Record<string, unknown>)[key])]));
  return value;
}
function encode(value: unknown): string { return Buffer.from(JSON.stringify(canonicalObject(value))).toString("base64url"); }
function issue(actor: string, correlationId: string, locationId = LOCATION, platformPermissions: readonly string[] = ["booking.create"]): string {
  const binding = buildRistoVerticalRequestBinding({ method: "POST", operation: "booking.create", idempotencyKey: `${correlationId}-idem` });
  const header = { alg: "EdDSA", typ: "AIRENOS-VPC" };
  const payload = {
    iss: "airenos-pilot", aud: "ristoairen-pilot", sub: actor, actor, tenant_id: TENANT, location_id: locationId,
    platform_roles: ["pilot_operator"], platform_permissions: platformPermissions, entitlements: [AIREN_BOOKING_ENTITLEMENT],
    correlation_id: correlationId, request_binding: binding, iat: 1000, exp: 1060, jti: `${correlationId}-jti`
  };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  return `${signingInput}.${cryptoSign(null, Buffer.from(signingInput), privateKey).toString("base64url")}`;
}
function hasCode(code: string) { return (error: unknown) => error instanceof AppError && error.code === code; }

const reads: BookingReadRepository = Object.freeze({ async query() { throw new Error("not used"); }, async findVisibleById() { return null; } });
const guard = Object.freeze({ assertBookingAccess(context: SecurityContext): void { if (!context.entitlements.includes(AIREN_BOOKING_ENTITLEMENT)) throw new AppError("ENTITLEMENT_REQUIRED", "airen.booking required"); } });
const booking = new BookingApplicationService(reads, new PostgresRistoBookingUnitOfWork(pool, "airen_app", "user"), guard);
const foundation = new PostgresFoundationReadStore(pool);
const tenants = new PostgresTenantRepositoryAdapter(foundation);
const locations = new PostgresLocationRepositoryAdapter(foundation);

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES ('${TENANT}','vertical-trust','Vertical Trust Synthetic');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,is_primary,status) VALUES
      ('${LOCATION}','${TENANT}','main','Main','Europe/Rome',true,'active'),
      ('${OTHER_LOCATION}','${TENANT}','other','Other','Europe/Rome',false,'active');
    INSERT INTO identity.identities (id,display_name,status) VALUES
      ('${ALLOWED_IDENTITY}','Allowed Operator','active'),
      ('${DENIED_IDENTITY}','Denied Operator','active');
    INSERT INTO authz.tenant_memberships (id,tenant_id,identity_id,role_key,status) VALUES
      ('${ALLOWED_MEMBERSHIP}','${TENANT}','${ALLOWED_IDENTITY}','vertical_booking_operator','active'),
      ('${DENIED_MEMBERSHIP}','${TENANT}','${DENIED_IDENTITY}','vertical_booking_viewer','active');
    INSERT INTO authz.location_memberships (id,tenant_id,tenant_membership_id,location_id,role_key,status) VALUES
      ('${ALLOWED_LOCATION_MEMBERSHIP}','${TENANT}','${ALLOWED_MEMBERSHIP}','${LOCATION}','vertical_location','active'),
      ('${DENIED_LOCATION_MEMBERSHIP}','${TENANT}','${DENIED_MEMBERSHIP}','${LOCATION}','vertical_location','active');
    INSERT INTO authz.permission_registry (permission_key,description) VALUES
      ('booking.create','Create Booking') ON CONFLICT (permission_key) DO NOTHING;
    INSERT INTO authz.role_permission_grants (scope_kind,role_key,permission_key,effect) VALUES
      ('tenant','vertical_booking_operator','booking.create','allow') ON CONFLICT DO NOTHING;
  `);
}

async function contextFor(actor: string, correlationId: string, locationId = LOCATION, platformPermissions: readonly string[] = ["booking.create"]): Promise<SecurityContext> {
  const idempotencyKey = `${correlationId}-idem`;
  const trusted = verifyAirenOsVerticalTrustedContext({
    token: issue(actor, correlationId, locationId, platformPermissions), publicKey, issuer: "airenos-pilot", audience: "ristoairen-pilot",
    expectedRequestBinding: buildRistoVerticalRequestBinding({ method: "POST", operation: "booking.create", idempotencyKey }), now: 1020
  });
  return buildRistoVerticalSecurityContext({ trusted, tenants, locations, memberships: foundation, roles: foundation });
}

test.after(async () => { await pool.end(); });

test("RISTO-R1-VERTICAL-TRUST-001 preserves RISTOAIREN final Booking authorization", async (t) => {
  await seed();

  await t.test("domain permission allows Booking create and trusted correlation reaches audit", async () => {
    const context = await contextFor(ALLOWED_IDENTITY, "trust-allowed", LOCATION, ["booking.create", "platform.tenants.read"]);
    assert.deepEqual(context.platformPermissions, ["platform.tenants.read"]);
    assert.equal(context.permissions.includes("booking.create"), true);
    const result = await booking.create(context, {
      source: "VERTICAL_PILOT", partySize: 2, bookingDate: "2026-09-25", bookingTimeLocal: "20:00", expectedDurationMinutes: 120, customerNameSnapshot: "Synthetic Pilot Guest"
    }, "trust-allowed-idem");
    assert.equal(result.booking.status, "REQUESTED");
    const audit = await pool.query("SELECT actor_identity_id::text AS actor, tenant_id::text AS tenant, location_id::text AS location, correlation_id FROM audit.audit_events WHERE action_key='BOOKING_CREATED' AND correlation_id='trust-allowed'");
    assert.deepEqual(audit.rows[0], { actor: ALLOWED_IDENTITY, tenant: TENANT, location: LOCATION, correlation_id: "trust-allowed" });
  });

  await t.test("AIRenOS booking-like platform permission alone cannot grant Hospitality create", async () => {
    const context = await contextFor(DENIED_IDENTITY, "trust-denied", LOCATION, ["booking.create"]);
    assert.deepEqual(context.platformPermissions, []);
    assert.equal(context.permissions.includes("booking.create"), false);
    await assert.rejects(booking.create(context, {
      source: "VERTICAL_PILOT", partySize: 2, bookingDate: "2026-09-25", bookingTimeLocal: "21:00", expectedDurationMinutes: 120, customerNameSnapshot: "Denied Synthetic Guest"
    }, "trust-denied-idem"), hasCode("PERMISSION_DENIED"));
  });

  await t.test("trusted Location with no matching membership fails closed", async () => {
    await assert.rejects(contextFor(ALLOWED_IDENTITY, "trust-other-location", OTHER_LOCATION, []), hasCode("LOCATION_MEMBERSHIP_REQUIRED"));
  });

  await t.test("Booking idempotency semantics remain unchanged", async () => {
    const context = await contextFor(ALLOWED_IDENTITY, "trust-replay", LOCATION, []);
    const input = { source: "VERTICAL_PILOT", partySize: 3, bookingDate: "2026-09-26", bookingTimeLocal: "20:30", expectedDurationMinutes: 90, customerNameSnapshot: "Replay Synthetic Guest" };
    const first = await booking.create(context, input, "trust-replay-idem");
    const replay = await booking.create(context, input, "trust-replay-idem");
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    await assert.rejects(booking.create(context, { ...input, partySize: 4 }, "trust-replay-idem"), hasCode("IDEMPOTENCY_CONFLICT"));
  });
});
