import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext } from "../../packages/authorization/src/index.ts";
import { revokePlatformRole } from "../../packages/authorization/src/platform-role-admin.ts";
import { createPostgresPool, PostgresFoundationReadStore } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresPlatformRoleAdminStore } from "../../packages/persistence-postgres/src/platform-role-control-plane.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = createPostgresPool(connectionString);
const reads = new PostgresFoundationReadStore(pool);
const store = new PostgresPlatformRoleAdminStore(pool);

const ACTOR = "f1000000-0000-4000-8000-000000000001";
const TARGET = "f2000000-0000-4000-8000-000000000001";
const KEY = "r3d-missing-revoke-v1";
const CORRELATION = "r3d-missing-revoke";

async function seed() {
  await pool.query(
    "INSERT INTO identity.identities(id,display_name,primary_email,status) VALUES ($1,'R3D Revoke Tester','r3d-revoke-tester@example.test','active'),($2,'R3D Missing Assignment Target','r3d-missing-target@example.test','active') ON CONFLICT (id) DO UPDATE SET status='active'",
    [ACTOR,TARGET]
  );
  await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ('platform.roles.revoke','Revoke a platform role assignment','critical'),('platform.fixture.observe','Synthetic platform fixture permission','normal') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('platform','platform_revoke_tester','platform.roles.revoke','allow'),('platform','platform_operator','platform.fixture.observe','allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'");
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_revoke_tester','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active',updated_at=now()",[ACTOR]);
  await pool.query("DELETE FROM authz.platform_role_assignments WHERE identity_id=$1 AND role_key='platform_operator'",[TARGET]);
  await pool.query("DELETE FROM authz.platform_role_lifecycle_idempotency WHERE idempotency_key=$1",[KEY]);
}

test.before(seed);
test.after(async()=>{ await pool.end(); });

test("R3-D revoke of a missing assignment fails closed with governed state error and no side effects", async () => {
  const context = await buildPlatformSecurityContext({
    principal:{identityId:ACTOR,providerKey:"synthetic",providerSubject:"r3d-revoke-tester",platformRoles:["platform_revoke_tester"]},
    roles:reads,
    correlationId:CORRELATION
  });

  await assert.rejects(
    () => revokePlatformRole(
      {idempotencyKey:KEY,targetIdentityId:TARGET,roleKey:"platform_operator",reasonCode:"security.missing_assignment"},
      {context,unitOfWork:store}
    ),
    (error: unknown) => error instanceof AppError && error.code === "CONFLICT"
  );

  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM authz.platform_role_lifecycle_idempotency WHERE idempotency_key=$1",[KEY])).rows[0].c),0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM authz.platform_role_assignment_transitions WHERE identity_id=$1 AND role_key='platform_operator'",[TARGET])).rows[0].c),0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id=$1",[CORRELATION])).rows[0].c),0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id=$1",[CORRELATION])).rows[0].c),0);
});
