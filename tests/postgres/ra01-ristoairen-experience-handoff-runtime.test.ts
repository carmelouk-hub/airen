import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { PostgresRistoairenExperienceHandoffStore } from "../../packages/persistence-postgres/src/ristoairen-experience-handoff.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const ACTOR = "a0140000-0000-4000-8000-000000000001";
const ORG = "a0140000-0000-4000-8000-000000000002";
const TENANT = "a0140000-0000-4000-8000-000000000003";
const LOCATION = "a0140000-0000-4000-8000-000000000004";
const ORG_MEMBERSHIP = "a0140000-0000-4000-8000-000000000005";
const TENANT_MEMBERSHIP = "a0140000-0000-4000-8000-000000000006";
const LOCATION_MEMBERSHIP = "a0140000-0000-4000-8000-000000000007";
const PLAN = "a0140000-0000-4000-8000-000000000008";
const SUBSCRIPTION = "a0140000-0000-4000-8000-000000000009";
const BINDING = "a0140000-0000-4000-8000-000000000010";
const RUNTIME_ROLE = "ra01_handoff_runtime";

function runtimeUrl(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  return url.toString();
}

function digest(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function context(correlationId: string): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: ACTOR,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: TENANT_MEMBERSHIP,
    locationMembershipId: LOCATION_MEMBERSHIP,
    tenantRole: "ra01_handoff_operator",
    locationRole: "ra01_handoff_location",
    permissions: ["ristoairen.access"],
    entitlements: ["vertical.ristoairen"],
  });
}

async function expectInvalid(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "AUTHENTICATION_REQUIRED");
    return true;
  });
}

test("RA-01 PostgreSQL Experience handoff is hash-only, single-use, expiring and authority-revocable", async () => {
  const admin = new Pool({ connectionString: DATABASE_URL });
  const password = randomBytes(24).toString("hex");

  await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
  await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await admin.query(`GRANT airen_app TO ${RUNTIME_ROLE}`);

  await admin.query(
    `INSERT INTO identity.identities(id,display_name,primary_email,status)
     VALUES ($1,'RA01 Handoff Operator','ra01-handoff@example.test','active')
     ON CONFLICT (id) DO UPDATE SET status='active'`,
    [ACTOR],
  );
  await admin.query(
    `INSERT INTO platform.tenants(id,slug,name,status,timezone,currency)
     VALUES ($1,'ra01-handoff-runtime','RA01 Handoff Runtime','active','Europe/Rome','EUR')
     ON CONFLICT (id) DO UPDATE SET slug='ra01-handoff-runtime',status='active',updated_at=now()`,
    [TENANT],
  );
  await admin.query(
    `INSERT INTO platform.locations(id,tenant_id,slug,name,status,timezone,is_primary)
     VALUES ($1,$2,'main','Main','active','Europe/Rome',true)
     ON CONFLICT (id) DO UPDATE SET status='active',is_primary=true,updated_at=now()`,
    [LOCATION, TENANT],
  );
  await admin.query(
    `INSERT INTO authz.tenant_memberships(id,tenant_id,identity_id,role_key,status)
     VALUES ($1,$2,$3,'ra01_handoff_operator','active')
     ON CONFLICT (tenant_id,identity_id) DO UPDATE SET role_key='ra01_handoff_operator',status='active',updated_at=now()`,
    [TENANT_MEMBERSHIP, TENANT, ACTOR],
  );
  const tenantMembershipId = String((await admin.query(
    "SELECT id FROM authz.tenant_memberships WHERE tenant_id=$1 AND identity_id=$2",
    [TENANT, ACTOR],
  )).rows[0].id);
  await admin.query(
    `INSERT INTO authz.location_memberships(id,tenant_membership_id,tenant_id,location_id,role_key,status)
     VALUES ($1,$2,$3,$4,'ra01_handoff_location','active')
     ON CONFLICT (tenant_membership_id,location_id) DO UPDATE SET role_key='ra01_handoff_location',status='active'`,
    [LOCATION_MEMBERSHIP, tenantMembershipId, TENANT, LOCATION],
  );
  await admin.query(
    `INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
     VALUES ('tenant','ra01_handoff_operator','ristoairen.access','allow')
     ON CONFLICT(scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`,
  );

  await admin.query(
    `INSERT INTO platform.organizations(id,slug,name,status)
     VALUES ($1,'ra01-handoff-group','RA01 Handoff Group','active')
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
     VALUES ($1,'ra01-handoff-plan','RA01 Handoff Plan','active','EUR',0,'monthly',0,now())
     ON CONFLICT (id) DO NOTHING`,
    [PLAN],
  );
  await admin.query(
    `INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,starts_at,current_period_start,current_period_end,source_kind)
     VALUES ($1,$2,$3,'active',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days','manual')
     ON CONFLICT (id) DO UPDATE SET status='active',current_period_end=now()+interval '29 days'`,
    [SUBSCRIPTION, TENANT, PLAN],
  );
  await admin.query(
    `INSERT INTO billing.entitlement_catalog(entitlement_key,description,status)
     VALUES ('vertical.ristoairen','RISTOAIREN vertical access','active')
     ON CONFLICT (entitlement_key) DO UPDATE SET status='active',retired_at=NULL`,
  );
  await admin.query(
    `INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,enabled)
     VALUES ($1,'vertical.ristoairen','manual',true)
     ON CONFLICT (tenant_id,entitlement_key) DO UPDATE SET source_kind='manual',enabled=true,valid_from=NULL,valid_until=NULL,revoked_at=NULL,expired_at=NULL`,
    [TENANT],
  );
  await admin.query(
    `INSERT INTO platform.product_subscription_bindings(id,organization_id,tenant_id,product_code,entitlement_key,subscription_id)
     VALUES ($1,$2,$3,'ristoairen','vertical.ristoairen',$4)
     ON CONFLICT (subscription_id,product_code) DO UPDATE SET organization_id=EXCLUDED.organization_id,tenant_id=EXCLUDED.tenant_id,entitlement_key=EXCLUDED.entitlement_key`,
    [BINDING, ORG, TENANT, SUBSCRIPTION],
  );

  const connectionString = runtimeUrl(DATABASE_URL, RUNTIME_ROLE, password);
  const appPool = new Pool({ connectionString, application_name: "ra01-handoff-runtime-proof" });
  const store = new PostgresRistoairenExperienceHandoffStore(appPool);

  try {
    const first = await store.issue({
      context: context("ra01-handoff-runtime-issue-001"),
      organizationId: ORG,
      subscriptionId: SUBSCRIPTION,
    });
    assert.match(first.launchCode, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(new Date(first.expiresAtIso).getTime() > Date.now());
    assert.ok(new Date(first.expiresAtIso).getTime() <= Date.now() + 61_000);

    const firstHash = digest(first.launchCode);
    const stored = await admin.query(
      `SELECT code_hash,actor_identity_id,organization_id,tenant_id,location_id,subscription_id,product_code,entitlement_key,permission_key,consumed_at
       FROM platform.ristoairen_experience_handoffs WHERE code_hash=$1`,
      [firstHash],
    );
    assert.equal(stored.rowCount, 1);
    assert.equal(String(stored.rows[0].code_hash), firstHash);
    assert.notEqual(String(stored.rows[0].code_hash), first.launchCode);
    assert.equal(stored.rows[0].consumed_at, null);
    assert.equal(JSON.stringify(stored.rows[0]).includes(first.launchCode), false);

    const plaintextColumns = await admin.query(
      `SELECT count(*)::int AS count
       FROM information_schema.columns
       WHERE table_schema='platform' AND table_name='ristoairen_experience_handoffs'
         AND column_name IN ('launch_code','code','token','access_token','session_token')`,
    );
    assert.equal(Number(plaintextColumns.rows[0].count), 0);
    const appDirectRead = await admin.query(
      `SELECT has_table_privilege('airen_app','platform.ristoairen_experience_handoffs','SELECT') AS allowed`,
    );
    assert.equal(appDirectRead.rows[0].allowed, false);

    const consumed = await store.consume(first.launchCode);
    assert.equal(consumed.actorIdentityId, ACTOR);
    assert.equal(consumed.organizationId, ORG);
    assert.equal(consumed.tenantId, TENANT);
    assert.equal(consumed.locationId, LOCATION);
    assert.equal(consumed.subscriptionId, SUBSCRIPTION);
    assert.equal(consumed.productCode, "ristoairen");
    assert.equal(consumed.entitlementKey, "vertical.ristoairen");
    assert.equal(consumed.permissionKey, "ristoairen.access");
    assert.equal(new Date(consumed.projectionExpiresAtIso).getTime() - new Date(consumed.consumedAtIso).getTime(), 60_000);
    await expectInvalid(store.consume(first.launchCode));

    const revoked = await store.issue({
      context: context("ra01-handoff-runtime-issue-002"),
      organizationId: ORG,
      subscriptionId: SUBSCRIPTION,
    });
    await admin.query(
      `DELETE FROM authz.role_permission_grants
       WHERE scope_kind='tenant' AND role_key='ra01_handoff_operator' AND permission_key='ristoairen.access'`,
    );
    await expectInvalid(store.consume(revoked.launchCode));

    await admin.query(
      `INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
       VALUES ('tenant','ra01_handoff_operator','ristoairen.access','allow')
       ON CONFLICT(scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`,
    );
    const expired = await store.issue({
      context: context("ra01-handoff-runtime-issue-003"),
      organizationId: ORG,
      subscriptionId: SUBSCRIPTION,
    });
    await admin.query(
      `UPDATE platform.ristoairen_experience_handoffs
       SET issued_at=now()-interval '80 seconds', expires_at=now()-interval '20 seconds'
       WHERE code_hash=$1`,
      [digest(expired.launchCode)],
    );
    await expectInvalid(store.consume(expired.launchCode));

    const evidence = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM platform.ristoairen_experience_handoffs WHERE tenant_id=$1) AS handoffs,
         (SELECT count(*)::int FROM platform.ristoairen_experience_handoffs WHERE tenant_id=$1 AND consumed_at IS NOT NULL) AS consumed,
         (SELECT count(*)::int FROM audit.audit_events WHERE tenant_id=$1 AND action_key='platform.ristoairen.experience_handoff.issue') AS issue_audits,
         (SELECT count(*)::int FROM audit.audit_events WHERE tenant_id=$1 AND action_key='platform.ristoairen.experience_handoff.consume') AS consume_audits,
         (SELECT count(*)::int FROM events.outbox_events WHERE tenant_id=$1 AND event_type='platform.ristoairen.experience_handoff.issued') AS outbox`,
      [TENANT],
    );
    assert.equal(Number(evidence.rows[0].handoffs), 3);
    assert.equal(Number(evidence.rows[0].consumed), 1);
    assert.equal(Number(evidence.rows[0].issue_audits), 3);
    assert.equal(Number(evidence.rows[0].consume_audits), 1);
    assert.equal(Number(evidence.rows[0].outbox), 3);
  } finally {
    await appPool.end();
    await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
    await admin.end();
  }
});
