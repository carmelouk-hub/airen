import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Gate153 bootstrap keeps every canonical runtime role NOBYPASSRLS", async () => {
  const bootstrap = await readFile(new URL("../../db/bootstrap/0000_runtime_roles.sql", import.meta.url), "utf8");
  assert.match(
    bootstrap,
    /CREATE ROLE airen_control_plane_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;/,
  );
  assert.doesNotMatch(bootstrap, /airen_control_plane_owner[^;]*\bBYPASSRLS;/);
});

test("Gate153 runner verifies managed-provider-safe owner attributes", async () => {
  const source = await readFile(new URL("../../deploy/migrate.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /rolname: "airen_control_plane_owner"[\s\S]*?rolbypassrls: false/,
  );
  assert.match(source, /assertCanonicalRuntimeRoles\(client, "bootstrap"\)/);
  assert.match(source, /assertCanonicalRuntimeRoles\(client, "external"\)/);
});

test("Gate153 migration maps existing SQL privileges to command-scoped FORCE-RLS policies", async () => {
  const source = await readFile(
    new URL("../../db/migrations/0040_render_managed_control_plane_owner_rls_compat.sql", import.meta.url),
    "utf8",
  );
  assert.match(source, /c\.relforcerowsecurity/);
  assert.match(source, /has_table_privilege\('airen_control_plane_owner'/);
  assert.match(source, /airen_cp_owner_select/);
  assert.match(source, /airen_cp_owner_insert/);
  assert.match(source, /airen_cp_owner_update/);
  assert.match(source, /airen_cp_owner_delete/);
  assert.match(source, /FOR SELECT TO airen_control_plane_owner USING \(true\)/);
  assert.match(source, /FOR INSERT TO airen_control_plane_owner WITH CHECK \(true\)/);
  assert.match(source, /FOR UPDATE TO airen_control_plane_owner USING \(true\) WITH CHECK \(true\)/);
  assert.match(source, /FOR DELETE TO airen_control_plane_owner USING \(true\)/);
  assert.doesNotMatch(source, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/i);
});
