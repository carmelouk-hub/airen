import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { buildRistoVerticalRequestBinding, verifyAirenOsVerticalTrustedContext } from "../../apps/api/src/risto-vertical-trusted-context.ts";
import { buildRistoVerticalSecurityContext } from "../../apps/api/src/risto-vertical-security-context.ts";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

function canonicalObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonicalObject((value as Record<string, unknown>)[key])]));
  return value;
}
function encode(value: unknown): string { return Buffer.from(JSON.stringify(canonicalObject(value))).toString("base64url"); }
function issue(overrides: Record<string, unknown> = {}): string {
  const header = { alg: "EdDSA", typ: "AIRENOS-VPC" };
  const payload = {
    iss: "airenos-test", aud: "ristoairen-test", sub: "aaaaaaaa-0000-4000-8000-000000000001", actor: "aaaaaaaa-0000-4000-8000-000000000001",
    tenant_id: "bbbbbbbb-0000-4000-8000-000000000001", location_id: "bbbbbbbb-0000-4000-8000-000000000002",
    platform_roles: ["operator"], platform_permissions: ["booking.create", "platform.tenants.read"], entitlements: ["airen.booking"],
    correlation_id: "trusted-correlation-1", request_binding: buildRistoVerticalRequestBinding({ method: "POST", operation: "booking.create", idempotencyKey: "idem-1" }),
    iat: 1000, exp: 1060, jti: "jti-1", ...overrides
  };
  const signingInput = `${encode(header)}.${encode(payload)}`;
  return `${signingInput}.${cryptoSign(null, Buffer.from(signingInput), privateKey).toString("base64url")}`;
}
function authFailure(error: unknown): boolean { return error instanceof AppError && error.code === "AUTHENTICATION_REQUIRED"; }

const expectedBinding = buildRistoVerticalRequestBinding({ method: "POST", operation: "booking.create", idempotencyKey: "idem-1" });

test("AIRenOS trusted context verifies signature, audience, lifetime and request binding", () => {
  const verified = verifyAirenOsVerticalTrustedContext({ token: issue(), publicKey, issuer: "airenos-test", audience: "ristoairen-test", expectedRequestBinding: expectedBinding, now: 1020 });
  assert.equal(verified.tenantId, "bbbbbbbb-0000-4000-8000-000000000001");
  assert.equal(verified.locationId, "bbbbbbbb-0000-4000-8000-000000000002");
  assert.equal(verified.correlationId, "trusted-correlation-1");
  assert.deepEqual(verified.entitlements, ["airen.booking"]);
  assert.rejects;
});

test("trusted context fails closed on tamper, expiry, wrong audience and request mismatch", () => {
  const token = issue();
  const [header, payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  decoded.tenant_id = "cccccccc-0000-4000-8000-000000000001";
  const tampered = `${header}.${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
  assert.throws(() => verifyAirenOsVerticalTrustedContext({ token: tampered, publicKey, issuer: "airenos-test", audience: "ristoairen-test", expectedRequestBinding: expectedBinding, now: 1020 }), authFailure);
  assert.throws(() => verifyAirenOsVerticalTrustedContext({ token, publicKey, issuer: "airenos-test", audience: "ristoairen-test", expectedRequestBinding: expectedBinding, now: 1100, clockSkewSeconds: 0 }), authFailure);
  assert.throws(() => verifyAirenOsVerticalTrustedContext({ token, publicKey, issuer: "airenos-test", audience: "wrong", expectedRequestBinding: expectedBinding, now: 1020 }), authFailure);
  assert.throws(() => verifyAirenOsVerticalTrustedContext({ token, publicKey, issuer: "airenos-test", audience: "ristoairen-test", expectedRequestBinding: buildRistoVerticalRequestBinding({ method: "PATCH", operation: "booking.update", idempotencyKey: "idem-1" }), now: 1020 }), authFailure);
});

test("domain adapter does not promote AIRenOS booking-like platform claims into Hospitality permissions", async () => {
  const trusted = verifyAirenOsVerticalTrustedContext({ token: issue(), publicKey, issuer: "airenos-test", audience: "ristoairen-test", expectedRequestBinding: expectedBinding, now: 1020 });
  const context = await buildRistoVerticalSecurityContext({
    trusted,
    tenants: { findById: async () => ({ id: trusted.tenantId, slug: "tenant", name: "Tenant", status: "active" }), findBySlug: async () => null },
    locations: { findById: async () => ({ id: trusted.locationId, tenantId: trusted.tenantId, slug: "main", name: "Main", status: "active" }), findPrimaryForTenant: async () => null },
    memberships: {
      findTenantMembership: async () => ({ id: "dddddddd-0000-4000-8000-000000000001", tenantId: trusted.tenantId, identityId: trusted.actorId, roleKey: "viewer", status: "active" }),
      findLocationMembership: async () => ({ id: "dddddddd-0000-4000-8000-000000000002", tenantMembershipId: "dddddddd-0000-4000-8000-000000000001", tenantId: trusted.tenantId, locationId: trusted.locationId, roleKey: "viewer", status: "active" })
    },
    roles: { platformPermissions: async () => [], tenantPermissions: async () => ["booking.read"], locationPermissions: async () => [] }
  });
  assert.deepEqual(context.platformPermissions, ["platform.tenants.read"]);
  assert.deepEqual(context.permissions, ["booking.read"]);
  assert.equal(context.permissions.includes("booking.create"), false);
});
