import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { AppError, type PlatformSecurityContext, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { bindProductSubscription, requireProductAccess, resolveProductAccess, AIRenProductCodes } from "../../packages/platform-core/src/index.ts";
import { PostgresProductAccessStore } from "../../packages/persistence-postgres/src/product-access.ts";
import { PostgresOrganizationContextRepository } from "../../packages/persistence-postgres/src/organization-control-plane.ts";
import { PostgresFoundationReadStore } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresEntitlementControlPlaneStore } from "../../packages/persistence-postgres/src/entitlement-control-plane.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const ACTOR = "a0330000-0000-4000-8000-000000000001";
const ORG = "a0330000-0000-4000-8000-000000000002";
const TENANT = "a0330000-0000-4000-8000-000000000003";
const LOCATION = "a0330000-0000-4000-8000-000000000004";
const ORG_MEMBERSHIP = "a0330000-0000-4000-8000-000000000005";
const TENANT_MEMBERSHIP = "a0330000-0000-4000-8000-000000000006";
const LOCATION_MEMBERSHIP = "a0330000-0000-4000-8000-000000000007";
const PLAN = "a0330000-0000-4000-8000-000000000008";
const SUBSCRIPTION = "a0330000-0000-4000-8000-000000000009";
const OTHER_TENANT = "a0330000-0000-4000-8000-000000000010";
const OTHER_LOCATION = "a0330000-0000-4000-8000-000000000011";
const RUNTIME_ROLE = "aos03_runtime";

function runtimeUrl(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  return url.toString();
}

function platformContext(): PlatformSecurityContext {
  return {
    scopeKind: "platform",
    correlationId: "aos03-pg-bind",
    actorIdentityId: ACTOR,
    platformRoles: ["aos03_admin"],
    platformPermissions: ["platform.product_access.bind_subscription"],
  };
}

function securityContext(overrides: Partial<SecurityContext> = {}): SecurityContext {
  return {
    correlationId: "aos03-pg-access",
    actorIdentityId: ACTOR,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: TENANT_MEMBERSHIP,
    locationMembershipId: LOCATION_MEMBERSHIP,
    tenantRole: "aos03_manager",
    locationRole: "aos03_location",
    permissions: ["booking.read"],
    entitlements: [],
    ...overrides,
  };
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

test("AOS-03 ProductAccess runtime composes Organization, R3-E Subscription and R3-F Entitlement without weakening isolation", async () => {
  const admin = new Pool({ connectionString: DATABASE_URL });
  const password = randomBytes(24).toString("hex");
  await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
  await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await admin.query(`GRANT airen_app, airen_control_plane TO ${RUNTIME_ROLE}`);

  await admin.query(
    `INSERT INTO identity.identities(id,display_name,primary_email,status)
     VALUES ($1,'AOS03 Admin','aos03-admin@example.test','active')
     ON CONFLICT (id) DO UPDATE SET status='active'`,
    [ACTOR],
  );
  await admin.query(
    `INSERT INTO authz.platform_role_assignments(identity_id,role_key,status)
     VALUES ($1,'aos03_admin','active')
     ON CONFLICT(identity_id,role_key) DO UPDATE SET status='active'`,
    [ACTOR],
  );
  await admin.query(
    `INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
     VALUES ('platform','aos03_admin','platform.product_access.bind_subscription','allow')
     ON CONFLICT(scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`,
  );

  await admin.query(
    `INSERT INTO platform.tenants(id,slug,name,status,timezone,currency)
     VALUES ($1,'aos03-tenant','AOS03 Tenant','active','Europe/Rome','EUR'),
            ($2,'aos03-other','AOS03 Other','active','Europe/Rome','EUR')
     ON CONFLICT (id) DO UPDATE SET status='active',updated_at=now()`,
    [TENANT, OTHER_TENANT],
  );
  await admin.query(
    `INSERT INTO platform.locations(id,tenant_id,slug,name,status,timezone,is_primary)
     VALUES ($1,$2,'main','Main','active','Europe/Rome',true),
            ($3,$4,'main','Main','active','Europe/Rome',true)
     ON CONFLICT (id) DO UPDATE SET status='active',is_primary=true,updated_at=now()`,
    [LOCATION, TENANT, OTHER_LOCATION, OTHER_TENANT],
  );
  await admin.query(
    `INSERT INTO authz.tenant_memberships(id,tenant_id,identity_id,role_key,status)
     VALUES ($1,$2,$3,'aos03_manager','active')
     ON CONFLICT (tenant_id,identity_id) DO UPDATE SET role_key='aos03_manager',status='active',updated_at=now()`,
    [TENANT_MEMBERSHIP, TENANT, ACTOR],
  );
  const actualTenantMembership = String((await admin.query(
    "SELECT id FROM authz.tenant_memberships WHERE tenant_id=$1 AND identity_id=$2",
    [TENANT, ACTOR],
  )).rows[0].id);
  await admin.query(
    `INSERT INTO authz.location_memberships(id,tenant_membership_id,tenant_id,location_id,role_key,status)
     VALUES ($1,$2,$3,$4,'aos03_location','active')
     ON CONFLICT (tenant_membership_id,location_id) DO UPDATE SET role_key='aos03_location',status='active'`,
    [LOCATION_MEMBERSHIP, actualTenantMembership, TENANT, LOCATION],
  );
  const actualLocationMembership = String((await admin.query(
    "SELECT id FROM authz.location_memberships WHERE tenant_membership_id=$1 AND location_id=$2",
    [actualTenantMembership, LOCATION],
  )).rows[0].id);

  await admin.query(
    `INSERT INTO platform.organizations(id,slug,name,status)
     VALUES ($1,'aos03-group','AOS03 Group','active')
     ON CONFLICT (id) DO UPDATE SET status='active',updated_at=now()`,
    [ORG],
  );
  await admin.query(
    `INSERT INTO authz.organization_memberships(id,organization_id,identity_id,role_key,status)
     VALUES ($1,$2,$3,'organization_owner','active')
     ON CONFLICT (organization_id,identity_id) DO UPDATE SET role_key='organization_owner',status='active',updated_at=now()`,
    [ORG_MEMBERSHIP, ORG, ACTOR],
  );
  await admin.query(
    `INSERT INTO platform.organization_tenants(organization_id,tenant_id)
     VALUES ($1,$2) ON CONFLICT (organization_id,tenant_id) DO NOTHING`,
    [ORG, TENANT],
  );

  await admin.query(
    `INSERT INTO billing.plans(id,slug,name,status,currency,price_minor,billing_period,default_trial_days,activated_at)
     VALUES ($1,'aos03-plan','AOS03 Plan','active','EUR',0,'monthly',0,now())
     ON CONFLICT (id) DO NOTHING`,
    [PLAN],
  );
  await admin.query(
    `INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,starts_at,current_period_start,current_period_end,source_kind)
     VALUES ($1,$2,$3,'active',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days','manual')
     ON CONFLICT (id) DO NOTHING`,
    [SUBSCRIPTION, TENANT, PLAN],
  );
  await admin.query(
    `INSERT INTO billing.entitlement_catalog(entitlement_key,description,status)
     VALUES ('airen.booking','AIRen Booking','active'),('airen.pay','AIRenPay','active')
     ON CONFLICT (entitlement_key) DO UPDATE SET status='active',retired_at=NULL`,
  );
  await admin.query(
    `INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,enabled)
     VALUES ($1,'airen.booking','manual',true)
     ON CONFLICT (tenant_id,entitlement_key) DO UPDATE SET source_kind='manual',enabled=true,valid_from=NULL,valid_until=NULL,revoked_at=NULL,expired_at=NULL`,
    [TENANT],
  );

  const runtime = new Pool({ connectionString: runtimeUrl(DATABASE_URL, RUNTIME_ROLE, password) });
  const productAccess = new PostgresProductAccessStore(runtime);
  const organizationRepository = new PostgresOrganizationContextRepository(runtime);
  const foundation = new PostgresFoundationReadStore(runtime);
  const entitlementStore = new PostgresEntitlementControlPlaneStore(runtime);

  try {
    const created = await bindProductSubscription(
      { idempotencyKey: "aos03-bind-runtime-001", organizationId: ORG, tenantId: TENANT, productCode: AIRenProductCodes.BOOKING, subscriptionId: SUBSCRIPTION },
      { context: platformContext(), unitOfWork: productAccess },
    );
    assert.equal(created.replayed, false);
    assert.equal(created.binding.entitlementKey, "airen.booking");
    assert.equal(created.binding.subscriptionStatus, "active");

    const replay = await bindProductSubscription(
      { idempotencyKey: "aos03-bind-runtime-001", organizationId: ORG, tenantId: TENANT, productCode: AIRenProductCodes.BOOKING, subscriptionId: SUBSCRIPTION },
      { context: platformContext(), unitOfWork: productAccess },
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.binding.bindingId, created.binding.bindingId);

    await assert.rejects(
      () => bindProductSubscription(
        { idempotencyKey: "aos03-bind-runtime-001", organizationId: ORG, tenantId: TENANT, productCode: AIRenProductCodes.PAY, subscriptionId: SUBSCRIPTION },
        { context: platformContext(), unitOfWork: productAccess },
      ),
      expectCode("IDEMPOTENCY_CONFLICT"),
    );

    const payBinding = await bindProductSubscription(
      { idempotencyKey: "aos03-bind-runtime-002", organizationId: ORG, tenantId: TENANT, productCode: AIRenProductCodes.PAY, subscriptionId: SUBSCRIPTION },
      { context: platformContext(), unitOfWork: productAccess },
    );
    assert.equal(payBinding.binding.entitlementKey, "airen.pay");

    const ctx = securityContext({ tenantMembershipId: actualTenantMembership, locationMembershipId: actualLocationMembership });
    const scoped = await foundation.forTrustedRequestScope({
      actorIdentityId: ACTOR,
      tenantId: TENANT,
      locationId: LOCATION,
      correlationId: ctx.correlationId,
    });
    try {
      const access = await resolveProductAccess(
        { productCode: AIRenProductCodes.BOOKING, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
        {
          context: ctx,
          organizations: organizationRepository,
          memberships: scoped.memberships,
          productSubscriptions: productAccess,
          entitlements: entitlementStore,
        },
      );
      assert.equal(access.allowed, true);
      assert.equal(access.subscriptionId, SUBSCRIPTION);
      assert.equal(access.organizationId, ORG);

      const pay = await resolveProductAccess(
        { productCode: AIRenProductCodes.PAY, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
        {
          context: { ...ctx, entitlements: ["airen.pay"] },
          organizations: organizationRepository,
          memberships: scoped.memberships,
          productSubscriptions: productAccess,
          entitlements: entitlementStore,
        },
      );
      assert.equal(pay.allowed, false);
      assert.ok(pay.denialReasons.includes("ENTITLEMENT_REQUIRED"));
      await assert.rejects(
        () => requireProductAccess(
          { productCode: AIRenProductCodes.PAY, permissionKey: "booking.read", resourceScope: { tenantId: TENANT, locationId: LOCATION } },
          {
            context: { ...ctx, entitlements: ["airen.pay"] },
            organizations: organizationRepository,
            memberships: scoped.memberships,
            productSubscriptions: productAccess,
            entitlements: entitlementStore,
          },
        ),
        expectCode("ENTITLEMENT_REQUIRED"),
      );
    } finally {
      await scoped.release();
    }

    const directClient = await runtime.connect();
    try {
      await directClient.query("BEGIN");
      await directClient.query("SET LOCAL ROLE airen_control_plane");
      await assert.rejects(
        () => directClient.query(
          "INSERT INTO platform.product_subscription_bindings(organization_id,tenant_id,product_code,entitlement_key,subscription_id) VALUES ($1,$2,'airen.booking','airen.booking',$3)",
          [ORG, TENANT, SUBSCRIPTION],
        ),
        (error: unknown) => (error as { code?: string }).code === "42501",
      );
      await directClient.query("ROLLBACK");
    } finally {
      directClient.release();
    }

    const other = securityContext({
      tenantId: OTHER_TENANT,
      locationId: OTHER_LOCATION,
      tenantMembershipId: undefined,
      locationMembershipId: undefined,
    });
    assert.equal(await productAccess.resolveCurrentProductSubscription(AIRenProductCodes.BOOKING, other), null);

    const evidence = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM platform.product_subscription_bindings WHERE tenant_id=$1) AS bindings,
         (SELECT count(*)::int FROM audit.audit_events WHERE action_key='platform.product_subscription.bind' AND tenant_id=$1) AS audits,
         (SELECT count(*)::int FROM events.outbox_events WHERE event_type='platform.product_subscription.bound' AND tenant_id=$1) AS outbox`,
      [TENANT],
    );
    assert.equal(Number(evidence.rows[0].bindings), 2);
    assert.equal(Number(evidence.rows[0].audits), 2);
    assert.equal(Number(evidence.rows[0].outbox), 2);
  } finally {
    await runtime.end();
    await admin.end();
  }
});
