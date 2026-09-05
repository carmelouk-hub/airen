import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const { Pool } = pg;
const adminUrl = process.env.ADMIN_DATABASE_URL;
const runtimeUrl = process.env.RUNTIME_DATABASE_URL;

if (!adminUrl || !runtimeUrl) {
  throw new Error("ADMIN_DATABASE_URL and RUNTIME_DATABASE_URL are required for F2.5E runtime proof");
}

const admin = new Pool({ connectionString: adminUrl });
const runtime = new Pool({ connectionString: runtimeUrl });

test.after(async () => {
  await Promise.all([admin.end(), runtime.end()]);
});

test("F2.5E new runtime connection has no effective or inherited provider-owner authority", async () => {
  const role = await runtime.query(`
    SELECT
      session_user,
      current_user,
      current_setting('role') AS effective_role_setting,
      r.rolsuper,
      r.rolbypassrls,
      r.rolcreaterole,
      r.rolcreatedb,
      r.rolcanlogin,
      r.rolinherit,
      r.rolreplication,
      pg_has_role(session_user, 'airen_auth', 'member') AS airen_auth_member,
      has_database_privilege(session_user, current_database(), 'CREATE') AS database_create,
      has_schema_privilege(session_user, 'identity', 'CREATE') AS identity_create,
      has_schema_privilege(session_user, 'authz', 'CREATE') AS authz_create,
      has_schema_privilege(session_user, 'security', 'CREATE') AS security_create
    FROM pg_roles r
    WHERE r.rolname = session_user
  `);

  assert.equal(role.rowCount, 1);
  assert.equal(role.rows[0].session_user, "airenos_identity_runtime_test");
  assert.equal(role.rows[0].current_user, "airenos_identity_runtime_test");
  assert.equal(role.rows[0].effective_role_setting, "none");
  assert.equal(role.rows[0].rolsuper, false);
  assert.equal(role.rows[0].rolbypassrls, false);
  assert.equal(role.rows[0].rolcreaterole, false);
  assert.equal(role.rows[0].rolcreatedb, false);
  assert.equal(role.rows[0].rolcanlogin, true);
  assert.equal(role.rows[0].rolinherit, false);
  assert.equal(role.rows[0].rolreplication, false);
  assert.equal(role.rows[0].airen_auth_member, true);
  assert.equal(role.rows[0].database_create, false);
  assert.equal(role.rows[0].identity_create, false);
  assert.equal(role.rows[0].authz_create, false);
  assert.equal(role.rows[0].security_create, false);

  const memberships = await runtime.query(`
    SELECT granted_role.rolname, m.admin_option, m.inherit_option, m.set_option
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
    WHERE member_role.rolname = session_user
    ORDER BY granted_role.rolname
  `);
  assert.deepEqual(memberships.rows, [{
    rolname: "airen_auth",
    admin_option: false,
    inherit_option: false,
    set_option: true,
  }]);

  const roleOverrides = await runtime.query(`
    SELECT count(*)::int AS override_count
    FROM pg_db_role_setting s
    JOIN pg_roles r ON r.oid = s.setrole
    CROSS JOIN LATERAL unnest(s.setconfig) AS config(value)
    WHERE r.rolname = session_user
      AND config.value LIKE 'role=%'
  `);
  assert.equal(roleOverrides.rows[0].override_count, 0);

  const ownership = await runtime.query(`
    SELECT count(*)::int AS owned_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE r.rolname = session_user
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
      [identityId, "F2.5E CI Identity", `f25e-${identityId}@example.invalid`],
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

      const effective = await client.query("SELECT session_user, current_user");
      assert.equal(effective.rows[0].session_user, "airenos_identity_runtime_test");
      assert.equal(effective.rows[0].current_user, "airen_auth");

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
        [sessionId, identityId, "F2.5E CI revocation proof"],
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
