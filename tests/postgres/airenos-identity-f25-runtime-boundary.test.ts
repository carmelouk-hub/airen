import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const { Pool } = pg;
const adminUrl = process.env.ADMIN_DATABASE_URL;
const runtimeUrl = process.env.RUNTIME_DATABASE_URL;

if (!adminUrl || !runtimeUrl) {
  throw new Error("ADMIN_DATABASE_URL and RUNTIME_DATABASE_URL are required for F2.5C runtime proof");
}

const admin = new Pool({ connectionString: adminUrl });
const runtime = new Pool({ connectionString: runtimeUrl });

test.after(async () => {
  await Promise.all([admin.end(), runtime.end()]);
});

test("F2.5C runtime principal is least-privilege and can use only the airen_auth function boundary", async () => {
  const role = await runtime.query(`
    SELECT
      current_user,
      r.rolsuper,
      r.rolbypassrls,
      r.rolcreaterole,
      r.rolcreatedb,
      r.rolcanlogin,
      pg_has_role(current_user, 'airen_auth', 'member') AS airen_auth_member
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);

  assert.equal(role.rowCount, 1);
  assert.equal(role.rows[0].rolsuper, false);
  assert.equal(role.rows[0].rolbypassrls, false);
  assert.equal(role.rows[0].rolcreaterole, false);
  assert.equal(role.rows[0].rolcreatedb, false);
  assert.equal(role.rows[0].rolcanlogin, true);
  assert.equal(role.rows[0].airen_auth_member, true);

  const ownership = await runtime.query(`
    SELECT count(*)::int AS owned_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE r.rolname = current_user
      AND n.nspname IN ('identity','authz','security')
  `);
  assert.equal(ownership.rows[0].owned_count, 0);

  await assert.rejects(
    runtime.query("SELECT id FROM identity.identities LIMIT 1"),
    (error: any) => error?.code === "42501",
  );

  const identityId = randomUUID();
  const sessionId = randomUUID();
  const providerSubject = `ci-${randomUUID()}`;

  try {
    await admin.query(
      "INSERT INTO identity.identities(id, display_name, primary_email, status) VALUES ($1, $2, $3, 'active')",
      [identityId, "F2.5C CI Identity", `f25-${identityId}@example.invalid`],
    );
    await admin.query(
      "INSERT INTO identity.provider_subject_links(identity_id, provider_key, provider_subject) VALUES ($1, 'keycloak-staging', $2)",
      [identityId, providerSubject],
    );
    await admin.query(
      "INSERT INTO authz.platform_role_assignments(identity_id, role_key, status) VALUES ($1, 'platform_test', 'active')",
      [identityId],
    );

    const client = await runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE airen_auth");

      const resolved = await client.query(
        "SELECT * FROM security.resolve_authentication_identity($1, $2)",
        ["keycloak-staging", providerSubject],
      );
      assert.equal(resolved.rowCount, 1);
      assert.equal(resolved.rows[0].identity_id, identityId);
      assert.equal(resolved.rows[0].identity_status, "active");
      assert.deepEqual(resolved.rows[0].platform_roles, ["platform_test"]);

      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 120_000);
      await client.query(
        "SELECT security.register_airenos_session($1, $2, $3, $4)",
        [sessionId, identityId, issuedAt, expiresAt],
      );

      const active = await client.query(
        "SELECT * FROM security.resolve_active_airenos_session($1, $2)",
        [sessionId, identityId],
      );
      assert.equal(active.rowCount, 1);

      const revoked = await client.query(
        "SELECT security.revoke_airenos_session($1, $2, $3) AS revoked",
        [sessionId, identityId, "F2.5C CI revocation proof"],
      );
      assert.equal(revoked.rows[0].revoked, true);

      const afterRevoke = await client.query(
        "SELECT * FROM security.resolve_active_airenos_session($1, $2)",
        [sessionId, identityId],
      );
      assert.equal(afterRevoke.rowCount, 0);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await admin.query("DELETE FROM identity.airenos_sessions WHERE identity_id = $1", [identityId]).catch(() => undefined);
    await admin.query("DELETE FROM authz.platform_role_assignments WHERE identity_id = $1", [identityId]).catch(() => undefined);
    await admin.query("DELETE FROM identity.provider_subject_links WHERE identity_id = $1", [identityId]).catch(() => undefined);
    await admin.query("DELETE FROM identity.identities WHERE id = $1", [identityId]).catch(() => undefined);
  }
});
