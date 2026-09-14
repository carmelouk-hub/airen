import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { PostgresAirenOSIdentityDirectory } from "../../packages/persistence-postgres/src/airenos-identity-directory.ts";

const sql = readFileSync(new URL("../../db/identity/0004_resolve_airenos_identity.sql", import.meta.url), "utf8");

test("identity role resolver SQL is narrow, server-side and fail-closed", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION security\.resolve_airenos_identity\(/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /pra\.status = 'active'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION security\.resolve_airenos_identity\(uuid\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION security\.resolve_airenos_identity\(uuid\) TO airen_auth/);
  assert.doesNotMatch(sql, /GRANT\s+SELECT\s+ON\s+(identity\.identities|authz\.platform_role_assignments)\s+TO\s+airen_auth/i);
});

test("PostgresAirenOSIdentityDirectory uses airen_auth and the resolver only", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  let released = false;
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("security.resolve_airenos_identity")) {
        return {
          rows: [
            {
              identityId: "11111111-1111-4111-8111-111111111111",
              status: "active",
              platformRoles: ["platform_support_readonly"]
            }
          ]
        };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    }
  };
  const pool = {
    async connect() {
      return client;
    }
  } as unknown as Pool;

  const directory = new PostgresAirenOSIdentityDirectory(pool);
  const identity = await directory.resolveIdentity("11111111-1111-4111-8111-111111111111");

  assert.deepEqual(identity, {
    identityId: "11111111-1111-4111-8111-111111111111",
    status: "active",
    platformRoles: ["platform_support_readonly"]
  });
  assert.equal(released, true);
  assert.equal(queries[0]?.text, "BEGIN");
  assert.equal(queries[1]?.text, "SET TRANSACTION READ ONLY");
  assert.equal(queries[2]?.text, "SET LOCAL ROLE airen_auth");
  assert.match(queries[3]?.text ?? "", /security\.resolve_airenos_identity\(\$1\)/);
  assert.deepEqual(queries[3]?.values, ["11111111-1111-4111-8111-111111111111"]);
  assert.equal(queries[4]?.text, "COMMIT");
  assert.equal(queries.some((q) => /FROM\s+identity\.identities|FROM\s+authz\.platform_role_assignments/i.test(q.text)), false);
});

test("missing identity resolves to null and database errors rollback", async () => {
  let mode: "missing" | "error" = "missing";
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      queries.push(text);
      if (text.includes("security.resolve_airenos_identity")) {
        if (mode === "error") throw new Error("db unavailable");
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } } as unknown as Pool;
  const directory = new PostgresAirenOSIdentityDirectory(pool);

  assert.equal(await directory.resolveIdentity("22222222-2222-4222-8222-222222222222"), null);

  mode = "error";
  await assert.rejects(() => directory.resolveIdentity("33333333-3333-4333-8333-333333333333"), /db unavailable/);
  assert.equal(queries.includes("ROLLBACK"), true);
});
