import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresAirenOSSessionLifecycleStore } from "../../packages/persistence-postgres/src/airenos-session-lifecycle.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = createPostgresPool(connectionString);
const sessions = new PostgresAirenOSSessionLifecycleStore(pool, "airen_auth");
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000001";

function record(sessionId: string, identityId = ALICE, offsetSeconds = 0) {
  const issued = new Date(Date.now() + offsetSeconds * 1_000);
  const expires = new Date(issued.getTime() + 120_000);
  return { sessionId, identityId, issuedAtIso: issued.toISOString(), expiresAtIso: expires.toISOString() };
}

test.after(async () => { await pool.end(); });

test("airen_auth has no direct session-table read or write authority", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_auth");
    await assert.rejects(() => client.query("SELECT session_id FROM identity.airenos_sessions LIMIT 1"), /permission denied/);
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_auth");
    await assert.rejects(
      () => client.query(
        "INSERT INTO identity.airenos_sessions(session_id,identity_id,issued_at,expires_at) VALUES ('10000000-0000-4000-8000-000000000001',$1,now(),now()+interval '2 minutes')",
        [ALICE]
      ),
      /permission denied/
    );
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});

test("canonical AIRenOS Identity can be resolved by identityId without direct table grants", async () => {
  const alice = await sessions.resolveIdentity(ALICE);
  assert.ok(alice);
  assert.equal(alice.identityId, ALICE);
  assert.equal(alice.status, "active");
  assert.deepEqual(alice.platformRoles, []);
  assert.equal(await sessions.resolveIdentity("cccccccc-0000-4000-8000-000000000001"), null);
});

test("registered session is active only for its bound Identity and no bearer/token column exists", async () => {
  const session = record("11111111-aaaa-4111-8111-111111111111");
  await sessions.register(session);
  const active = await sessions.resolveActive(session.sessionId, ALICE);
  assert.ok(active);
  assert.equal(active.identityId, ALICE);
  assert.equal(active.issuedAtIso, session.issuedAtIso);
  assert.equal(active.expiresAtIso, session.expiresAtIso);
  assert.equal(await sessions.resolveActive(session.sessionId, BOB), null);

  const columns = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='identity' AND table_name='airenos_sessions' ORDER BY ordinal_position"
  );
  const names = columns.rows.map((row) => String(row.column_name));
  assert.equal(names.some((name) => /token|bearer|secret|role|tenant/i.test(name)), false);
});

test("revocation invalidates an active session immediately and is idempotently closed", async () => {
  const session = record("22222222-aaaa-4222-8222-222222222222");
  await sessions.register(session);
  assert.ok(await sessions.resolveActive(session.sessionId, ALICE));
  assert.equal(await sessions.revoke(session.sessionId, ALICE, "user_logout"), true);
  assert.equal(await sessions.resolveActive(session.sessionId, ALICE), null);
  assert.equal(await sessions.revoke(session.sessionId, ALICE, "repeat_logout"), false);

  const stored = await pool.query(
    "SELECT status, revoked_at IS NOT NULL AS revoked, revocation_reason FROM identity.airenos_sessions WHERE session_id=$1",
    [session.sessionId]
  );
  assert.equal(stored.rows[0].status, "revoked");
  assert.equal(stored.rows[0].revoked, true);
  assert.equal(stored.rows[0].revocation_reason, "user_logout");
});

test("revoke-all is Identity-scoped and suspended Identity fails active-session resolution", async () => {
  const aliceOne = record("33333333-aaaa-4333-8333-333333333333");
  const aliceTwo = record("44444444-aaaa-4444-8444-444444444444");
  const bobOne = record("55555555-bbbb-4555-8555-555555555555", BOB);
  await sessions.register(aliceOne);
  await sessions.register(aliceTwo);
  await sessions.register(bobOne);

  const activeAlice = await pool.query(
    "SELECT count(*)::int AS count FROM identity.airenos_sessions WHERE identity_id=$1 AND status='active'",
    [ALICE]
  );
  const expectedRevoked = Number(activeAlice.rows[0]?.count ?? 0);
  assert.ok(expectedRevoked >= 2);
  assert.equal(await sessions.revokeAllForIdentity(ALICE, "security_reset"), expectedRevoked);
  assert.equal(await sessions.resolveActive(aliceOne.sessionId, ALICE), null);
  assert.equal(await sessions.resolveActive(aliceTwo.sessionId, ALICE), null);
  assert.ok(await sessions.resolveActive(bobOne.sessionId, BOB));

  await pool.query("UPDATE identity.identities SET status='suspended' WHERE id=$1", [BOB]);
  try {
    assert.equal(await sessions.resolveActive(bobOne.sessionId, BOB), null);
    const bob = await sessions.resolveIdentity(BOB);
    assert.ok(bob);
    assert.equal(bob.status, "suspended");
  } finally {
    await pool.query("UPDATE identity.identities SET status='active' WHERE id=$1", [BOB]);
  }
});

test("database authority rejects overlong sessions and invalid revocation reasons", async () => {
  const issued = new Date();
  const overlong = { sessionId: "66666666-aaaa-4666-8666-666666666666", identityId: ALICE, issuedAtIso: issued.toISOString(), expiresAtIso: new Date(issued.getTime() + 301_000).toISOString() };
  await assert.rejects(() => sessions.register(overlong), /outside the permitted window/);
  await assert.rejects(() => sessions.revokeAllForIdentity(ALICE, ""), /revocation reason is invalid/);
});
