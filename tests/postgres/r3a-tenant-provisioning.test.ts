import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext } from "../../packages/authorization/src/index.ts";
import { provisionTenant } from "../../packages/tenant/src/commands/provision-tenant.ts";
import { PostgresTenantProvisioningUnitOfWork } from "../../packages/persistence-postgres/src/tenant-provisioning.ts";
import { PostgresFoundationReadStore, createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const reads = new PostgresFoundationReadStore(pool);
const uow = new PostgresTenantProvisioningUnitOfWork(pool);
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000001";

async function seedPlatformAuthority() {
  await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ('platform.tenants.provision','Provision tenants','high') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active'", [ALICE]);
  await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('platform','platform_admin','platform.tenants.provision','allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'");
}

test.before(seedPlatformAuthority);
test.after(async () => { await pool.end(); });

test("R3-A provisions Tenant atomically, replays idempotently, denies tenant-only actors and rolls back partial failure", async () => {
  const allowedContext = await buildPlatformSecurityContext({
    principal: { identityId: ALICE, providerKey: "synthetic", providerSubject: "alice-platform", platformRoles: ["platform_admin"] },
    roles: reads,
    correlationId: "r3a-provision-create"
  });
  const input = {
    idempotencyKey: "r3a-provision-gamma-v1",
    slug: "gamma-r3a",
    name: "Gamma R3A Synthetic",
    locale: "it-IT",
    timezone: "Europe/Rome",
    currency: "EUR",
    primaryLocation: { slug: "main", name: "Gamma Main" }
  } as const;

  const created = await provisionTenant(input, { context: allowedContext, unitOfWork: uow });
  assert.equal(created.replayed, false);
  assert.equal(created.tenant.slug, "gamma-r3a");
  assert.equal(created.primaryLocation.tenantId, created.tenant.id);

  const tenantRows = await pool.query("SELECT count(*)::int AS c FROM platform.tenants WHERE id=$1 AND slug='gamma-r3a'", [created.tenant.id]);
  const locationRows = await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE id=$1 AND tenant_id=$2 AND is_primary=true", [created.primaryLocation.id, created.tenant.id]);
  const membershipRows = await pool.query("SELECT count(*)::int AS c FROM authz.tenant_memberships WHERE id=$1 AND tenant_id=$2 AND identity_id=$3 AND role_key='owner' AND status='active'", [created.tenantMembershipId, created.tenant.id, ALICE]);
  const auditRows = await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3a-provision-create' AND action_key='platform.tenant.provision' AND resource_id=$1", [created.tenant.id]);
  const outboxRows = await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3a-provision-create' AND event_type='platform.tenant.provisioned' AND aggregate_id=$1", [created.tenant.id]);
  assert.equal(tenantRows.rows[0].c, 1);
  assert.equal(locationRows.rows[0].c, 1);
  assert.equal(membershipRows.rows[0].c, 1);
  assert.equal(auditRows.rows[0].c, 1);
  assert.equal(outboxRows.rows[0].c, 1);

  const retryContext = await buildPlatformSecurityContext({
    principal: { identityId: ALICE, providerKey: "synthetic", providerSubject: "alice-platform", platformRoles: ["platform_admin"] },
    roles: reads,
    correlationId: "r3a-provision-retry"
  });
  const replayed = await provisionTenant(input, { context: retryContext, unitOfWork: uow });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.tenant.id, created.tenant.id);
  const retryAudit = await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3a-provision-retry'");
  const retryOutbox = await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3a-provision-retry'");
  assert.equal(retryAudit.rows[0].c, 0);
  assert.equal(retryOutbox.rows[0].c, 0);

  await assert.rejects(
    () => provisionTenant({ ...input, name: "Different payload" }, { context: retryContext, unitOfWork: uow }),
    (error: unknown) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT"
  );

  const deniedContext = await buildPlatformSecurityContext({
    principal: { identityId: BOB, providerKey: "synthetic", providerSubject: "bob-tenant", platformRoles: [] },
    roles: reads,
    correlationId: "r3a-tenant-actor-denied"
  });
  await assert.rejects(
    () => provisionTenant({ ...input, idempotencyKey: "r3a-denied-tenant-v1", slug: "denied-r3a", name: "Denied R3A" }, { context: deniedContext, unitOfWork: uow }),
    (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED"
  );
  const deniedRows = await pool.query("SELECT count(*)::int AS c FROM platform.tenants WHERE slug='denied-r3a'");
  assert.equal(deniedRows.rows[0].c, 0);

  const directClient = await pool.connect();
  try {
    await directClient.query("BEGIN");
    await directClient.query("SET LOCAL ROLE airen_control_plane");
    await directClient.query("SELECT set_config('airen.identity_id',$1,true), set_config('airen.correlation_id','r3a-db-denied',true)", [BOB]);
    await assert.rejects(
      () => directClient.query("SELECT * FROM security.platform_provision_tenant('r3a-db-denied-v1','db-denied-r3a','DB Denied','it-IT','Europe/Rome','EUR','main','Main','Europe/Rome')"),
      (error: unknown) => (error as { code?: string }).code === "42501"
    );
    await directClient.query("ROLLBACK");
  } finally {
    directClient.release();
  }

  await pool.query("CREATE OR REPLACE FUNCTION public.r3a_force_membership_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'R3A_FORCED_PARTIAL_FAILURE'; END $$");
  await pool.query("CREATE TRIGGER r3a_force_membership_failure BEFORE INSERT ON authz.tenant_memberships FOR EACH ROW EXECUTE FUNCTION public.r3a_force_membership_failure()");
  try {
    const rollbackContext = await buildPlatformSecurityContext({
      principal: { identityId: ALICE, providerKey: "synthetic", providerSubject: "alice-platform", platformRoles: ["platform_admin"] },
      roles: reads,
      correlationId: "r3a-forced-rollback"
    });
    await assert.rejects(() => provisionTenant({ ...input, idempotencyKey: "r3a-rollback-v1", slug: "rollback-r3a", name: "Rollback R3A" }, { context: rollbackContext, unitOfWork: uow }));
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS r3a_force_membership_failure ON authz.tenant_memberships");
    await pool.query("DROP FUNCTION IF EXISTS public.r3a_force_membership_failure()");
  }
  const rollbackTenant = await pool.query("SELECT count(*)::int AS c FROM platform.tenants WHERE slug='rollback-r3a'");
  const rollbackRequest = await pool.query("SELECT count(*)::int AS c FROM platform.tenant_provisioning_idempotency WHERE idempotency_key='r3a-rollback-v1'");
  const rollbackAudit = await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3a-forced-rollback'");
  const rollbackOutbox = await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3a-forced-rollback'");
  assert.equal(rollbackTenant.rows[0].c, 0);
  assert.equal(rollbackRequest.rows[0].c, 0);
  assert.equal(rollbackAudit.rows[0].c, 0);
  assert.equal(rollbackOutbox.rows[0].c, 0);
});
