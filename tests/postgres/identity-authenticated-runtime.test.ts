import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { authenticateAndResolveRequestSecurityContext } from "../../apps/api/src/security-context.ts";
import { ProviderNeutralAuthenticationAdapter } from "../../packages/identity/src/index.ts";
import { HmacSignedSessionVerifier } from "../../packages/integrations/src/index.ts";
import { createLocation } from "../../packages/tenant/src/commands/create-location.ts";
import { PostgresAuthenticationIdentityDirectory, PostgresFoundationReadStore, PostgresLocationRepositoryAdapter, PostgresLocationUnitOfWork, PostgresTenantRepositoryAdapter, createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const reads = new PostgresFoundationReadStore(pool);
const identityDirectory = new PostgresAuthenticationIdentityDirectory(pool, "airen_auth");
const tenants = new PostgresTenantRepositoryAdapter(reads);
const locations = new PostgresLocationRepositoryAdapter(reads);
const uow = new PostgresLocationUnitOfWork(pool, "airen_app");
const ALPHA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const providerKey = "synthetic-auth";
const audience = "airenos-foundation";
const signingKey = randomBytes(32);
const verifier = new HmacSignedSessionVerifier({ providerKey, audience, verificationKey: signingKey, clockSkewSeconds: 0 });
const authentication = new ProviderNeutralAuthenticationAdapter(verifier, identityDirectory);

function issueToken(subject: string, sessionId: string, lifetimeSeconds = 300): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: providerKey, aud: audience, sub: subject, sid: sessionId, iat: now - 1, exp: now + lifetimeSeconds })).toString("base64url");
  const signature = createHmac("sha256", signingKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function seedAuthority() {
  await pool.query("INSERT INTO identity.provider_subject_links(identity_id,provider_key,provider_subject) VALUES ($1,$2,$3) ON CONFLICT (provider_key,provider_subject) DO UPDATE SET identity_id=EXCLUDED.identity_id", [ALICE, providerKey, "alice-subject"]);
  await pool.query("INSERT INTO authz.permission_registry(permission_key,description) VALUES ('tenant.locations.manage','Manage tenant locations') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('tenant','owner','tenant.locations.manage','allow') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO billing.entitlement_catalog(entitlement_key,description) VALUES ('tenant.multi_location','Multi-location capability') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,enabled) VALUES ($1,'tenant.multi_location','test',true) ON CONFLICT (tenant_id,entitlement_key) DO UPDATE SET enabled=true", [ALPHA]);
}

async function authenticatedContext(correlationId: string, token: string) {
  return authenticateAndResolveRequestSecurityContext({
    request: { authorization: `Bearer ${token}`, tenant_id: "untrusted-body-tenant", role: "platform_super_admin" },
    authentication,
    hostname: "alpha.example.test",
    trustedBaseDomain: "ristoairen.test",
    correlationId,
    tenants,
    locations,
    domains: reads,
    memberships: reads,
    roles: reads,
    entitlements: reads
  });
}

test.before(seedAuthority);
test.after(async () => { await pool.end(); });

test("airen_auth cannot SELECT identity tables directly", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_auth");
    await assert.rejects(() => client.query("SELECT id FROM identity.identities LIMIT 1"), /permission denied/);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("verified credential resolves provider subject to Identity and executes governed command", async () => {
  const token = issueToken("alice-subject", "session-b44-fx-011");
  const { principal, context } = await authenticatedContext("b44-fx-011-auth-create-location", token);
  assert.equal(principal.identityId, ALICE);
  assert.equal(principal.providerKey, providerKey);
  assert.equal(principal.providerSubject, "alice-subject");
  assert.equal(principal.sessionId, "session-b44-fx-011");
  assert.equal(context.actorIdentityId, ALICE);
  assert.equal(context.tenantId, ALPHA);

  const location = await createLocation({ slug: "auth-annex", name: "Authenticated Annex", timezone: "Europe/Rome" }, { context, unitOfWork: uow });
  assert.equal(location.tenantId, ALPHA);

  const locationRows = await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE id=$1 AND tenant_id=$2", [location.id, ALPHA]);
  const auditRows = await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='b44-fx-011-auth-create-location' AND actor_identity_id=$1 AND resource_id=$2", [ALICE, location.id]);
  const outboxRows = await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='b44-fx-011-auth-create-location' AND aggregate_id=$1", [location.id]);
  assert.equal(locationRows.rows[0].c, 1);
  assert.equal(auditRows.rows[0].c, 1);
  assert.equal(outboxRows.rows[0].c, 1);
});

test("tampered or unknown credential is rejected before Tenant context or mutation", async () => {
  const valid = issueToken("alice-subject", "session-tamper");
  const tampered = valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A");
  await assert.rejects(() => authenticatedContext("b44-fx-011-tampered", tampered), (e: unknown) => e instanceof AppError && e.code === "AUTHENTICATION_REQUIRED");

  const unknown = issueToken("unknown-subject", "session-unknown");
  await assert.rejects(() => authenticatedContext("b44-fx-011-unknown", unknown), (e: unknown) => e instanceof AppError && e.code === "AUTHENTICATION_REQUIRED");

  const mutationRows = await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE tenant_id=$1 AND slug='auth-forbidden'", [ALPHA]);
  const auditRows = await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id IN ('b44-fx-011-tampered','b44-fx-011-unknown')");
  const outboxRows = await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id IN ('b44-fx-011-tampered','b44-fx-011-unknown')");
  assert.equal(mutationRows.rows[0].c, 0);
  assert.equal(auditRows.rows[0].c, 0);
  assert.equal(outboxRows.rows[0].c, 0);
});
