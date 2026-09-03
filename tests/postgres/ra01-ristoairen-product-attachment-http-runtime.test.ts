import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign as signData } from "node:crypto";
import { Pool } from "pg";
import { ProviderNeutralAuthenticationAdapter } from "../../packages/identity/src/index.ts";
import { Ed25519SignedSessionVerifier } from "../../packages/integrations/src/ed25519-signed-session.ts";
import {
  AIRenProductCodes,
  RISTOAIREN_ATTACHMENT_ENTRYPOINT,
  bindProductSubscription,
} from "../../packages/platform-core/src/index.ts";
import {
  PostgresAuthenticationIdentityDirectory,
  PostgresFoundationReadStore,
  PostgresLocationRepositoryAdapter,
  PostgresTenantRepositoryAdapter,
} from "../../packages/persistence-postgres/src/index.ts";
import { PostgresOrganizationContextRepository } from "../../packages/persistence-postgres/src/organization-control-plane.ts";
import { PostgresProductAccessStore } from "../../packages/persistence-postgres/src/product-access.ts";
import { PostgresEntitlementControlPlaneStore } from "../../packages/persistence-postgres/src/entitlement-control-plane.ts";
import {
  dispatchRistoairenProductAttachmentApiRequest,
  type RistoairenProductAttachmentApiDependencies,
} from "../../apps/api/src/ristoairen-product-attachment-api.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const ACTOR = "a0120000-0000-4000-8000-000000000001";
const ORG = "a0120000-0000-4000-8000-000000000002";
const TENANT = "a0120000-0000-4000-8000-000000000003";
const LOCATION = "a0120000-0000-4000-8000-000000000004";
const ORG_MEMBERSHIP = "a0120000-0000-4000-8000-000000000005";
const TENANT_MEMBERSHIP = "a0120000-0000-4000-8000-000000000006";
const LOCATION_MEMBERSHIP = "a0120000-0000-4000-8000-000000000007";
const PLAN = "a0120000-0000-4000-8000-000000000008";
const SUBSCRIPTION = "a0120000-0000-4000-8000-000000000009";
const RUNTIME_ROLE = "ra01_http_runtime";
const PROVIDER_KEY = "ra01-ed25519";
const PROVIDER_SUBJECT = "ra01-operator-subject";
const AUDIENCE = "airenos-foundation";
const KID = "ra01-session-k1";

function runtimeUrl(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  return url.toString();
}

function issueToken(privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: KID })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = signData(null, Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function validClaims(sessionId: string): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { iss: PROVIDER_KEY, aud: AUDIENCE, sub: PROVIDER_SUBJECT, sid: sessionId, iat: now - 2, exp: now + 120 };
}

function tamper(token: string): string {
  const parts = token.split(".");
  const signature = parts[2] ?? "";
  parts[2] = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  return parts.join(".");
}

function request(token: string, correlationId: string) {
  return {
    method: "GET",
    url: RISTOAIREN_ATTACHMENT_ENTRYPOINT,
    headers: {
      authorization: `Bearer ${token}`,
      host: "ra01-runtime.ristoairen.test",
      "x-correlation-id": correlationId,
      "x-claimed-tenant": "attacker-tenant",
      "x-claimed-role": "platform_super_admin",
    },
  };
}

test("RA-01 proves Ed25519 AIRenOS session to PostgreSQL ProductAccess runtime and fails closed on authority loss", async () => {
  const admin = new Pool({ connectionString: DATABASE_URL });
  const password = randomBytes(24).toString("hex");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
  await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await admin.query(`GRANT airen_app, airen_auth, airen_control_plane TO ${RUNTIME_ROLE}`);

  await admin.query(
    `INSERT INTO identity.identities(id,display_name,primary_email,status)
     VALUES ($1,'RA01 Runtime Operator','ra01-runtime@example.test','active')
     ON CONFLICT (id) DO UPDATE SET status='active'`,
    [ACTOR],
  );
  await admin.query(
    `INSERT INTO identity.provider_subject_links(identity_id,provider_key,provider_subject)
     VALUES ($1,$2,$3)
     ON CONFLICT (provider_key,provider_subject) DO UPDATE SET identity_id=EXCLUDED.identity_id`,
    [ACTOR, PROVIDER_KEY, PROVIDER_SUBJECT],
  );
  await admin.query(
    `INSERT INTO authz.platform_role_assignments(identity_id,role_key,status)
     VALUES ($1,'ra01_platform_admin','active')
     ON CONFLICT(identity_id,role_key) DO UPDATE SET status='active'`,
    [ACTOR],
  );
  await admin.query(
    `INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
     VALUES ('platform','ra01_platform_admin','platform.product_access.bind_subscription','allow')
     ON CONFLICT(scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`,
  );

  await admin.query(
    `INSERT INTO platform.tenants(id,slug,name,status,timezone,currency)
     VALUES ($1,'ra01-runtime','RA01 Runtime Tenant','active','Europe/Rome','EUR')
     ON CONFLICT (id) DO UPDATE SET slug='ra01-runtime',status='active',updated_at=now()`,
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
     VALUES ($1,$2,$3,'ra01_operator','active')
     ON CONFLICT (tenant_id,identity_id) DO UPDATE SET role_key='ra01_operator',status='active',updated_at=now()`,
    [TENANT_MEMBERSHIP, TENANT, ACTOR],
  );
  const tenantMembershipId = String((await admin.query(
    "SELECT id FROM authz.tenant_memberships WHERE tenant_id=$1 AND identity_id=$2",
    [TENANT, ACTOR],
  )).rows[0].id);
  await admin.query(
    `INSERT INTO authz.location_memberships(id,tenant_membership_id,tenant_id,location_id,role_key,status)
     VALUES ($1,$2,$3,$4,'ra01_location','active')
     ON CONFLICT (tenant_membership_id,location_id) DO UPDATE SET role_key='ra01_location',status='active'`,
    [LOCATION_MEMBERSHIP, tenantMembershipId, TENANT, LOCATION],
  );
  await admin.query(
    `INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
     VALUES ('tenant','ra01_operator','ristoairen.access','allow')
     ON CONFLICT(scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`,
  );

  await admin.query(
    `INSERT INTO platform.organizations(id,slug,name,status)
     VALUES ($1,'ra01-runtime-group','RA01 Runtime Group','active')
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
     VALUES ($1,'ra01-runtime-plan','RA01 Runtime Plan','active','EUR',0,'monthly',0,now())
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

  const connectionString = runtimeUrl(DATABASE_URL, RUNTIME_ROLE, password);
  const controlPool = new Pool({ connectionString });
  const appPool = new Pool({ connectionString, options: "-c role=airen_app", application_name: "ra01-http-runtime-proof" });
  const controlProductAccess = new PostgresProductAccessStore(controlPool);

  try {
    const bound = await bindProductSubscription(
      {
        idempotencyKey: "ra01-ristoairen-bind-001",
        organizationId: ORG,
        tenantId: TENANT,
        productCode: AIRenProductCodes.RISTOAIREN,
        subscriptionId: SUBSCRIPTION,
      },
      {
        context: {
          scopeKind: "platform",
          correlationId: "ra01-runtime-bind",
          actorIdentityId: ACTOR,
          platformRoles: ["ra01_platform_admin"],
          platformPermissions: ["platform.product_access.bind_subscription"],
        },
        unitOfWork: controlProductAccess,
      },
    );
    assert.equal(bound.binding.productCode, AIRenProductCodes.RISTOAIREN);
    assert.equal(bound.binding.entitlementKey, "vertical.ristoairen");

    const verifier = new Ed25519SignedSessionVerifier({
      providerKey: PROVIDER_KEY,
      audience: AUDIENCE,
      publicKeysJson: JSON.stringify({ [KID]: { key: publicKey.export({ format: "jwk" }), enabled: true } }),
      clockSkewSeconds: 0,
    });
    const authentication = new ProviderNeutralAuthenticationAdapter(
      verifier,
      new PostgresAuthenticationIdentityDirectory(appPool, "airen_auth"),
    );
    const foundation = new PostgresFoundationReadStore(appPool);
    const deps: RistoairenProductAttachmentApiDependencies = Object.freeze({
      authentication,
      roles: foundation,
      appBaseDomain: "ristoairen.test",
      tenantContext: Object.freeze({
        tenants: new PostgresTenantRepositoryAdapter(foundation),
        locations: new PostgresLocationRepositoryAdapter(foundation),
        domains: foundation,
        memberships: foundation,
        entitlements: foundation,
      }),
      organizations: new PostgresOrganizationContextRepository(appPool),
      productSubscriptions: new PostgresProductAccessStore(appPool),
      effectiveEntitlements: new PostgresEntitlementControlPlaneStore(appPool),
      trustedRequestScopes: foundation,
    });

    const token = issueToken(privateKey, validClaims("ra01-runtime-session-001"));
    const allowed = await dispatchRistoairenProductAttachmentApiRequest(request(token, "ra01-runtime-http-001"), deps);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.productAccess, "ALLOWED");
    assert.equal(allowed.body.productCode, AIRenProductCodes.RISTOAIREN);
    assert.equal(allowed.body.entitlementKey, "vertical.ristoairen");
    assert.equal(allowed.body.permissionKey, "ristoairen.access");
    assert.equal(allowed.body.organizationId, ORG);
    assert.equal(allowed.body.tenantId, TENANT);
    assert.equal(allowed.body.locationId, LOCATION);
    assert.equal((allowed.body.session as Record<string, unknown>).authority, "AIRenOS");
    assert.equal(Object.hasOwn(allowed.body.session as object, "sessionId"), false);
    assert.equal(JSON.stringify(allowed.body).includes(token), false);
    assert.equal(allowed.body.productionEnabled, false);

    const tampered = await dispatchRistoairenProductAttachmentApiRequest(request(tamper(token), "ra01-runtime-http-tampered"), deps);
    assert.equal(tampered.status, 401);
    assert.equal(tampered.body.error, "AUTHENTICATION_REQUIRED");

    await admin.query(
      `DELETE FROM authz.role_permission_grants
       WHERE scope_kind='tenant' AND role_key='ra01_operator' AND permission_key='ristoairen.access'`,
    );
    const noPermission = await dispatchRistoairenProductAttachmentApiRequest(request(token, "ra01-runtime-http-no-permission"), deps);
    assert.equal(noPermission.status, 403);
    assert.equal(noPermission.body.error, "PERMISSION_DENIED");

    await admin.query(
      `INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
       VALUES ('tenant','ra01_operator','ristoairen.access','allow')
       ON CONFLICT(scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`,
    );
    await admin.query(
      `UPDATE billing.tenant_entitlements SET enabled=false,updated_at=now()
       WHERE tenant_id=$1 AND entitlement_key='vertical.ristoairen'`,
      [TENANT],
    );
    const noEntitlement = await dispatchRistoairenProductAttachmentApiRequest(request(token, "ra01-runtime-http-no-entitlement"), deps);
    assert.equal(noEntitlement.status, 403);
    assert.equal(noEntitlement.body.error, "ENTITLEMENT_REQUIRED");

    const evidence = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM platform.product_subscription_bindings WHERE tenant_id=$1 AND product_code='ristoairen') AS bindings,
         (SELECT count(*)::int FROM audit.audit_events WHERE action_key='platform.product_subscription.bind' AND tenant_id=$1) AS audits,
         (SELECT count(*)::int FROM events.outbox_events WHERE event_type='platform.product_subscription.bound' AND tenant_id=$1) AS outbox`,
      [TENANT],
    );
    assert.equal(Number(evidence.rows[0].bindings), 1);
    assert.equal(Number(evidence.rows[0].audits), 1);
    assert.equal(Number(evidence.rows[0].outbox), 1);
  } finally {
    await appPool.end();
    await controlPool.end();
    await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
    await admin.end();
  }
});
