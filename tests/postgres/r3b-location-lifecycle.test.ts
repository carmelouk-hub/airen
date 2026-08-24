import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext, buildSecurityContext } from "../../packages/authorization/src/index.ts";
import { archiveLocation, getLocationAdmin, listLocationsAdmin, reactivateLocation, suspendLocation, transferPrimaryLocation, updateLocation } from "../../packages/tenant/src/commands/manage-location.ts";
import { createLocation } from "../../packages/tenant/src/commands/create-location.ts";
import { provisionTenant } from "../../packages/tenant/src/commands/provision-tenant.ts";
import { resolveTenantRoute } from "../../packages/tenant/src/index.ts";
import { PostgresLocationControlPlaneStore } from "../../packages/persistence-postgres/src/location-control-plane.ts";
import { PostgresTenantProvisioningUnitOfWork } from "../../packages/persistence-postgres/src/tenant-provisioning.ts";
import { PostgresFoundationReadStore, PostgresLocationRepositoryAdapter, PostgresLocationUnitOfWork, PostgresTenantRepositoryAdapter, createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const reads = new PostgresFoundationReadStore(pool);
const tenantRepo = new PostgresTenantRepositoryAdapter(reads);
const locationRepo = new PostgresLocationRepositoryAdapter(reads);
const lifecycle = new PostgresLocationControlPlaneStore(pool);
const provisioning = new PostgresTenantProvisioningUnitOfWork(pool);
const locationCreateUow = new PostgresLocationUnitOfWork(pool, "airen_app");
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000001";

async function seedPermissions() {
  for (const permission of [
    "platform.tenants.provision",
    "platform.locations.read",
    "platform.locations.update",
    "platform.locations.suspend",
    "platform.locations.reactivate",
    "platform.locations.archive",
    "platform.locations.transfer_primary"
  ]) {
    await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ($1,$1,'high') ON CONFLICT DO NOTHING", [permission]);
    await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('platform','platform_admin',$1,'allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'", [permission]);
  }
  for (const permission of ["tenant.locations.manage", "tenant.location.all"]) {
    await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ($1,$1,'high') ON CONFLICT DO NOTHING", [permission]);
    await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('tenant','owner',$1,'allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'", [permission]);
  }
  await pool.query("INSERT INTO billing.entitlement_catalog(entitlement_key,description) VALUES ('tenant.multi_location','Multi-location capability') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active'", [ALICE]);
}

test.before(seedPermissions);
test.after(async () => { await pool.end(); });

test("R3-B Location lifecycle preserves tenant scope, primary invariants, idempotency and rollback", async () => {
  const platform = await buildPlatformSecurityContext({
    principal: { identityId: ALICE, providerKey: "synthetic", providerSubject: "alice-platform", platformRoles: ["platform_admin"] },
    roles: reads,
    correlationId: "r3b-provision-one"
  });
  const first = await provisionTenant({
    idempotencyKey: "r3b-provision-one-v1",
    slug: "r3b-locations-one",
    name: "R3B Locations One",
    timezone: "Europe/Rome",
    primaryLocation: { slug: "main", name: "Primary One" }
  }, { context: platform, unitOfWork: provisioning });
  const tenantId = first.tenant.id;
  const primaryId = String((await pool.query("SELECT id FROM platform.locations WHERE tenant_id=$1 AND is_primary=true", [tenantId])).rows[0].id);
  const originalSlug = String((await pool.query("SELECT slug FROM platform.locations WHERE id=$1", [primaryId])).rows[0].slug);

  const secondTenant = await provisionTenant({
    idempotencyKey: "r3b-provision-two-v1",
    slug: "r3b-locations-two",
    name: "R3B Locations Two",
    timezone: "Europe/Rome",
    primaryLocation: { slug: "main", name: "Primary Two" }
  }, { context: { ...platform, correlationId: "r3b-provision-two" }, unitOfWork: provisioning });
  const secondTenantPrimaryId = String((await pool.query("SELECT id FROM platform.locations WHERE tenant_id=$1 AND is_primary=true", [secondTenant.tenant.id])).rows[0].id);

  await pool.query("INSERT INTO authz.tenant_memberships(tenant_id,identity_id,role_key,status) VALUES ($1,$2,'tenant_admin','active')", [tenantId, BOB]);
  await pool.query("INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,enabled) VALUES ($1,'tenant.multi_location','r3b-test',true) ON CONFLICT (tenant_id,entitlement_key) DO UPDATE SET enabled=true", [tenantId]);

  const updated = await updateLocation({ idempotencyKey: "r3b-update-primary-v1", locationId: primaryId, name: "Primary One Updated", timezone: "Europe/Paris" }, { context: { ...platform, correlationId: "r3b-update-primary" }, unitOfWork: lifecycle });
  assert.equal(updated.location.name, "Primary One Updated");
  assert.equal(updated.location.timezone, "Europe/Paris");
  assert.equal(updated.location.slug, originalSlug);
  assert.equal(updated.location.tenantId, tenantId);

  await assert.rejects(
    () => updateLocation({ idempotencyKey: "r3b-update-primary-v1", locationId: primaryId, name: "Changed Payload" }, { context: { ...platform, correlationId: "r3b-update-conflict" }, unitOfWork: lifecycle }),
    (error: unknown) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT"
  );

  await assert.rejects(
    () => suspendLocation({ idempotencyKey: "r3b-primary-suspend-denied-v1", locationId: primaryId, reasonCode: "operations.maintenance" }, { context: { ...platform, correlationId: "r3b-primary-suspend-denied" }, unitOfWork: lifecycle }),
    (error: unknown) => error instanceof AppError && error.code === "CONFLICT"
  );
  assert.equal(String((await pool.query("SELECT status FROM platform.locations WHERE id=$1", [primaryId])).rows[0].status), "active");

  const route = await resolveTenantRoute({ hostname: "r3b-locations-one.ristoairen.com", trustedBaseDomain: "ristoairen.com", tenants: tenantRepo, locations: locationRepo, domains: reads });
  const tenantContext = await buildSecurityContext({
    principal: { identityId: ALICE, providerKey: "synthetic", providerSubject: "alice-tenant", platformRoles: [] },
    route,
    memberships: reads,
    roles: reads,
    entitlements: await reads.enabledForTenant(tenantId),
    correlationId: "r3b-create-second-location"
  });
  const secondLocation = await createLocation({ slug: "annex", name: "Annex", timezone: "Europe/Rome" }, { context: tenantContext, unitOfWork: locationCreateUow });
  assert.equal(secondLocation.tenantId, tenantId);

  const transfer = await transferPrimaryLocation({
    idempotencyKey: "r3b-transfer-primary-v1",
    sourceLocationId: primaryId,
    targetLocationId: secondLocation.id,
    reasonCode: "operations.primary_transfer"
  }, { context: { ...platform, correlationId: "r3b-transfer-primary" }, unitOfWork: lifecycle });
  assert.equal(transfer.location.id, secondLocation.id);
  assert.equal(transfer.location.isPrimary, true);
  assert.equal(transfer.previousPrimaryLocationId, primaryId);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.locations WHERE tenant_id=$1 AND is_primary=true", [tenantId])).rows[0].c), 1);

  const replay = await transferPrimaryLocation({
    idempotencyKey: "r3b-transfer-primary-v1",
    sourceLocationId: primaryId,
    targetLocationId: secondLocation.id,
    reasonCode: "operations.primary_transfer"
  }, { context: { ...platform, correlationId: "r3b-transfer-primary-retry" }, unitOfWork: lifecycle });
  assert.equal(replay.replayed, true);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3b-transfer-primary-retry'")).rows[0].c), 0);

  await assert.rejects(
    () => transferPrimaryLocation({ idempotencyKey: "r3b-cross-tenant-transfer-v1", sourceLocationId: secondTenantPrimaryId, targetLocationId: secondLocation.id, reasonCode: "invalid.cross_tenant" }, { context: { ...platform, correlationId: "r3b-cross-tenant-transfer" }, unitOfWork: lifecycle }),
    (error: unknown) => error instanceof AppError && error.code === "CONFLICT"
  );

  const statusBeforeRollback = String((await pool.query("SELECT status FROM platform.locations WHERE id=$1", [primaryId])).rows[0].status);
  const transitionCountBeforeRollback = Number((await pool.query("SELECT count(*)::int AS c FROM platform.location_state_transitions WHERE location_id=$1", [primaryId])).rows[0].c);
  await pool.query("CREATE OR REPLACE FUNCTION public.r3b_force_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id='r3b-rollback' THEN RAISE EXCEPTION 'R3B_FORCED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$");
  await pool.query("CREATE TRIGGER r3b_force_audit_failure BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.r3b_force_audit_failure()");
  try {
    await assert.rejects(() => suspendLocation({ idempotencyKey: "r3b-rollback-suspend-v1", locationId: primaryId, reasonCode: "operations.rollback_probe" }, { context: { ...platform, correlationId: "r3b-rollback" }, unitOfWork: lifecycle }));
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS r3b_force_audit_failure ON audit.audit_events");
    await pool.query("DROP FUNCTION IF EXISTS public.r3b_force_audit_failure()");
  }
  assert.equal(String((await pool.query("SELECT status FROM platform.locations WHERE id=$1", [primaryId])).rows[0].status), statusBeforeRollback);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.location_lifecycle_idempotency WHERE idempotency_key='r3b-rollback-suspend-v1'")).rows[0].c), 0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.location_state_transitions WHERE location_id=$1", [primaryId])).rows[0].c), transitionCountBeforeRollback);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3b-rollback'")).rows[0].c), 0);

  const suspended = await suspendLocation({ idempotencyKey: "r3b-suspend-old-primary-v1", locationId: primaryId, reasonCode: "operations.maintenance" }, { context: { ...platform, correlationId: "r3b-suspend-old-primary" }, unitOfWork: lifecycle });
  assert.equal(suspended.location.status, "suspended");

  await assert.rejects(
    () => transferPrimaryLocation({ idempotencyKey: "r3b-transfer-to-suspended-v1", sourceLocationId: secondLocation.id, targetLocationId: primaryId, reasonCode: "invalid.target_state" }, { context: { ...platform, correlationId: "r3b-transfer-to-suspended" }, unitOfWork: lifecycle }),
    (error: unknown) => error instanceof AppError && error.code === "CONFLICT"
  );

  const reactivated = await reactivateLocation({ idempotencyKey: "r3b-reactivate-old-primary-v1", locationId: primaryId, reasonCode: "operations.remediated" }, { context: { ...platform, correlationId: "r3b-reactivate-old-primary" }, unitOfWork: lifecycle });
  assert.equal(reactivated.location.status, "active");
  const archived = await archiveLocation({ idempotencyKey: "r3b-archive-old-primary-v1", locationId: primaryId, reasonCode: "operations.location_closed" }, { context: { ...platform, correlationId: "r3b-archive-old-primary" }, unitOfWork: lifecycle });
  assert.equal(archived.location.status, "archived");
  await assert.rejects(
    () => reactivateLocation({ idempotencyKey: "r3b-reactivate-archived-v1", locationId: primaryId, reasonCode: "invalid.reopen" }, { context: { ...platform, correlationId: "r3b-reactivate-archived" }, unitOfWork: lifecycle }),
    (error: unknown) => error instanceof AppError && error.code === "CONFLICT"
  );

  const detail = await getLocationAdmin(primaryId, { context: { ...platform, correlationId: "r3b-detail" }, queries: lifecycle });
  assert.equal(detail?.status, "archived");
  const list = await listLocationsAdmin({ tenantId, limit: 100 }, { context: { ...platform, correlationId: "r3b-list" }, queries: lifecycle });
  assert.equal(list.filter((location) => location.tenantId === tenantId).length, 2);
  assert.ok(list.some((location) => location.id === secondLocation.id && location.isPrimary));
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM platform.location_state_transitions WHERE location_id=$1", [primaryId])).rows[0].c), 3);

  const bobContext = await buildPlatformSecurityContext({ principal: { identityId: BOB, providerKey: "synthetic", providerSubject: "bob-tenant-admin", platformRoles: [] }, roles: reads, correlationId: "r3b-bob-denied" });
  await assert.rejects(() => getLocationAdmin(primaryId, { context: bobContext, queries: lifecycle }), (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED");
  await assert.rejects(() => updateLocation({ idempotencyKey: "r3b-bob-update-v1", locationId: primaryId, name: "Escalated" }, { context: bobContext, unitOfWork: lifecycle }), (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED");

  const direct = await pool.connect();
  try {
    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_control_plane");
    await direct.query("SELECT set_config('airen.identity_id',$1,true), set_config('airen.correlation_id','r3b-db-read-denied',true)", [BOB]);
    await assert.rejects(() => direct.query("SELECT * FROM security.platform_get_location($1)", [primaryId]), (error: unknown) => (error as { code?: string }).code === "42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_control_plane");
    await assert.rejects(() => direct.query("UPDATE platform.locations SET name='Direct Escalation' WHERE id=$1", [primaryId]), (error: unknown) => (error as { code?: string }).code === "42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_app");
    await direct.query("SELECT set_config('airen.identity_id',$1,true), set_config('airen.correlation_id','r3b-app-denied',true)", [ALICE]);
    await assert.rejects(() => direct.query("SELECT * FROM security.platform_mutate_location('update','r3b-app-denied-v1',$1,'Nope',NULL,NULL)", [secondLocation.id]), (error: unknown) => (error as { code?: string }).code === "42501");
    await direct.query("ROLLBACK");
  } finally { direct.release(); }

  assert.equal(String((await pool.query("SELECT tenant_id FROM platform.locations WHERE id=$1", [primaryId])).rows[0].tenant_id), tenantId);
  assert.equal(String((await pool.query("SELECT slug FROM platform.locations WHERE id=$1", [primaryId])).rows[0].slug), originalSlug);
});
