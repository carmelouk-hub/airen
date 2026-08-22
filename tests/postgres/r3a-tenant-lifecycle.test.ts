import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext } from "../../packages/authorization/src/index.ts";
import { archiveTenant, getTenantAdmin, listTenantsAdmin, reactivateTenant, suspendTenant, updateTenant } from "../../packages/tenant/src/commands/manage-tenant.ts";
import { provisionTenant } from "../../packages/tenant/src/commands/provision-tenant.ts";
import { resolveTenantRoute } from "../../packages/tenant/src/index.ts";
import { PostgresTenantControlPlaneStore } from "../../packages/persistence-postgres/src/tenant-control-plane.ts";
import { PostgresTenantProvisioningUnitOfWork } from "../../packages/persistence-postgres/src/tenant-provisioning.ts";
import { PostgresFoundationReadStore, createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const reads = new PostgresFoundationReadStore(pool);
const lifecycle = new PostgresTenantControlPlaneStore(pool);
const provisioning = new PostgresTenantProvisioningUnitOfWork(pool);
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000001";

async function seedPermissions() {
  for (const permission of ["platform.tenants.provision","platform.tenants.read","platform.tenants.update","platform.tenants.suspend","platform.tenants.reactivate","platform.tenants.archive"]) {
    await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ($1,$1,'high') ON CONFLICT DO NOTHING", [permission]);
    await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('platform','platform_admin',$1,'allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'", [permission]);
  }
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active'", [ALICE]);
}

test.before(seedPermissions);
test.after(async () => { await pool.end(); });

test("R3-A remaining Tenant lifecycle is governed, idempotent, non-destructive and queryable", async () => {
  const context = await buildPlatformSecurityContext({ principal: { identityId: ALICE, providerKey: "synthetic", providerSubject: "alice-platform", platformRoles: ["platform_admin"] }, roles: reads, correlationId: "r3a2-provision" });
  const provisioned = await provisionTenant({ idempotencyKey: "r3a2-provision-delta-v1", slug: "delta-r3a2", name: "Delta R3A2", timezone: "Europe/Rome", primaryLocation: { slug: "main", name: "Delta Main" } }, { context, unitOfWork: provisioning });
  const tenantId = provisioned.tenant.id;
  const slug = provisioned.tenant.slug;

  // Prove tenant authority and platform authority remain separate: BOB is an active tenant_admin but has no platform role.
  await pool.query("INSERT INTO authz.tenant_memberships(tenant_id,identity_id,role_key,status) VALUES ($1,$2,'tenant_admin','active')", [tenantId, BOB]);

  const updateContext = { ...context, correlationId: "r3a2-update" };
  const updated = await updateTenant({ idempotencyKey: "r3a2-update-delta-v1", tenantId, name: "Delta R3A2 Updated", currency: "USD" }, { context: updateContext, unitOfWork: lifecycle });
  assert.equal(updated.tenant.slug, slug);
  assert.equal(updated.tenant.name, "Delta R3A2 Updated");
  assert.equal(updated.tenant.currency, "USD");
  assert.equal(updated.tenant.status, "active");

  await assert.rejects(
    () => updateTenant({ idempotencyKey: "r3a2-update-delta-v1", tenantId, name: "Different Payload" }, { context: { ...context, correlationId: "r3a2-update-conflict" }, unitOfWork: lifecycle }),
    (error: unknown) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT"
  );
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3a2-update-conflict'")).rows[0].c), 0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3a2-update-conflict'")).rows[0].c), 0);

  const beforeSuspendCounts = {
    locations: Number((await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE tenant_id=$1", [tenantId])).rows[0].c),
    memberships: Number((await pool.query("SELECT count(*)::int AS c FROM authz.tenant_memberships WHERE tenant_id=$1", [tenantId])).rows[0].c)
  };
  const suspendContext = { ...context, correlationId: "r3a2-suspend" };
  const suspended = await suspendTenant({ idempotencyKey: "r3a2-suspend-delta-v1", tenantId, reasonCode: "manual.platform_governance" }, { context: suspendContext, unitOfWork: lifecycle });
  assert.equal(suspended.tenant.status, "suspended");
  const replayed = await suspendTenant({ idempotencyKey: "r3a2-suspend-delta-v1", tenantId, reasonCode: "manual.platform_governance" }, { context: { ...context, correlationId: "r3a2-suspend-retry" }, unitOfWork: lifecycle });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.tenant.status, "suspended");
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3a2-suspend-retry'")).rows[0].c), 0);

  await assert.rejects(
    () => resolveTenantRoute({ hostname: "delta-r3a2.ristoairen.com", trustedBaseDomain: "ristoairen.com", tenants: reads, locations: reads, domains: reads }),
    (error: unknown) => error instanceof AppError && error.code === "TENANT_RESOLUTION_FAILED"
  );
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE tenant_id=$1", [tenantId])).rows[0].c), beforeSuspendCounts.locations);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM authz.tenant_memberships WHERE tenant_id=$1", [tenantId])).rows[0].c), beforeSuspendCounts.memberships);

  const reactivated = await reactivateTenant({ idempotencyKey: "r3a2-reactivate-delta-v1", tenantId, reasonCode: "governance.remediated" }, { context: { ...context, correlationId: "r3a2-reactivate" }, unitOfWork: lifecycle });
  assert.equal(reactivated.tenant.status, "active");
  const route = await resolveTenantRoute({ hostname: "delta-r3a2.ristoairen.com", trustedBaseDomain: "ristoairen.com", tenants: reads, locations: reads, domains: reads });
  assert.equal(route.tenant.id, tenantId);

  const originalName = reactivated.tenant.name;
  await pool.query("CREATE OR REPLACE FUNCTION public.r3a2_force_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id='r3a2-rollback' THEN RAISE EXCEPTION 'R3A2_FORCED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$");
  await pool.query("CREATE TRIGGER r3a2_force_audit_failure BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.r3a2_force_audit_failure()");
  try {
    await assert.rejects(() => updateTenant({ idempotencyKey: "r3a2-rollback-update-v1", tenantId, name: "Should Roll Back" }, { context: { ...context, correlationId: "r3a2-rollback" }, unitOfWork: lifecycle }));
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS r3a2_force_audit_failure ON audit.audit_events");
    await pool.query("DROP FUNCTION IF EXISTS public.r3a2_force_audit_failure()");
  }
  assert.equal((await pool.query("SELECT name FROM platform.tenants WHERE id=$1", [tenantId])).rows[0].name, originalName);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.tenant_lifecycle_idempotency WHERE idempotency_key='r3a2-rollback-update-v1'")).rows[0].c), 0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3a2-rollback'")).rows[0].c), 0);

  const archived = await archiveTenant({ idempotencyKey: "r3a2-archive-delta-v1", tenantId, reasonCode: "commercial.closed" }, { context: { ...context, correlationId: "r3a2-archive" }, unitOfWork: lifecycle });
  assert.equal(archived.tenant.status, "archived");
  await assert.rejects(
    () => reactivateTenant({ idempotencyKey: "r3a2-invalid-reactivate-v1", tenantId, reasonCode: "invalid.reopen" }, { context: { ...context, correlationId: "r3a2-invalid-reactivate" }, unitOfWork: lifecycle }),
    (error: unknown) => error instanceof AppError && error.code === "CONFLICT"
  );
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.tenants WHERE id=$1", [tenantId])).rows[0].c), 1);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE tenant_id=$1", [tenantId])).rows[0].c), beforeSuspendCounts.locations);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM authz.tenant_memberships WHERE tenant_id=$1", [tenantId])).rows[0].c), beforeSuspendCounts.memberships);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.tenant_state_transitions WHERE tenant_id=$1", [tenantId])).rows[0].c), 3);

  const detail = await getTenantAdmin(tenantId, { context: { ...context, correlationId: "r3a2-detail" }, queries: lifecycle });
  assert.equal(detail?.status, "archived");
  const archivedList = await listTenantsAdmin({ status: "archived", limit: 100 }, { context: { ...context, correlationId: "r3a2-list" }, queries: lifecycle });
  assert.ok(archivedList.some((tenant) => tenant.id === tenantId));

  const bobContext = await buildPlatformSecurityContext({ principal: { identityId: BOB, providerKey: "synthetic", providerSubject: "bob-tenant-admin", platformRoles: [] }, roles: reads, correlationId: "r3a2-bob-denied" });
  await assert.rejects(() => getTenantAdmin(tenantId, { context: bobContext, queries: lifecycle }), (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED");
  await assert.rejects(() => updateTenant({ idempotencyKey: "r3a2-bob-update-v1", tenantId, name: "Escalated" }, { context: bobContext, unitOfWork: lifecycle }), (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED");

  const direct = await pool.connect();
  try {
    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_control_plane");
    await direct.query("SELECT set_config('airen.identity_id',$1,true), set_config('airen.correlation_id','r3a2-db-read-denied',true)", [BOB]);
    await assert.rejects(() => direct.query("SELECT * FROM security.platform_get_tenant($1)", [tenantId]), (error: unknown) => (error as { code?: string }).code === "42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_control_plane");
    await direct.query("SELECT set_config('airen.identity_id',$1,true), set_config('airen.correlation_id','r3a2-db-update-denied',true)", [BOB]);
    await assert.rejects(() => direct.query("UPDATE platform.tenants SET name='Direct Escalation' WHERE id=$1", [tenantId]), (error: unknown) => (error as { code?: string }).code === "42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_app");
    await direct.query("SELECT set_config('airen.identity_id',$1,true), set_config('airen.correlation_id','r3a2-app-denied',true)", [ALICE]);
    await assert.rejects(() => direct.query("SELECT * FROM security.platform_mutate_tenant('update','r3a2-app-denied-v1',$1,'Nope',NULL,NULL,NULL,NULL)", [tenantId]), (error: unknown) => (error as { code?: string }).code === "42501");
    await direct.query("ROLLBACK");
  } finally { direct.release(); }
});
