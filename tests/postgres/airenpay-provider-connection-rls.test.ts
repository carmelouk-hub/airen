import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import type { AirenPayTrustedProviderConnectionV1 } from "../../packages/airenpay/src/index.ts";
import { PostgresAirenPayProviderConnectionStore } from "../../packages/persistence-postgres/src/airenpay-provider-connection.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "22222222-2222-4222-8222-222222222222";
const IDENTITY_A = "33333333-3333-4333-8333-333333333333";
const TENANT_B = "44444444-4444-4444-8444-444444444444";
const LOCATION_B = "55555555-5555-4555-8555-555555555555";
const IDENTITY_B = "66666666-6666-4666-8666-666666666666";
const CONNECTION_A = "77777777-7777-4777-8777-777777777777";
const CONNECTION_B = "88888888-8888-4888-8888-888888888888";

function context(tenantId: string, locationId: string, actorIdentityId: string, correlationId: string): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId,
    platformRoles: [],
    platformPermissions: [],
    tenantId,
    locationId,
    permissions: [],
    entitlements: ["airen.pay"]
  });
}

function connection(
  id: string,
  tenantId: string,
  providerAccountReference: string
): AirenPayTrustedProviderConnectionV1 {
  const timestamp = "2026-09-14T11:00:00.000Z";
  return Object.freeze({
    gateway: Object.freeze({
      id,
      tenantId,
      providerType: "stripe",
      providerAccountReference,
      capabilities: Object.freeze(["DEPOSIT_PAYMENT", "REFUND_PAYMENT", "WEBHOOK_VERIFICATION"]),
      mode: "TEST",
      credentialSecretRef: Object.freeze({ provider: "github-actions", key: "STRIPE_AIRENPAY_TEST_SECRET_KEY" }),
      webhookSecretRef: Object.freeze({ provider: "github-actions", key: "STRIPE_AIRENPAY_CONNECT_TEST_WEBHOOK_SECRET" }),
      webhookConfigurationReference: "airenpay-connect-sandbox",
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
      rowVersion: 1
    }),
    profile: Object.freeze({
      connectionId: id,
      tenantId,
      providerType: "stripe",
      providerApiProfile: "accounts-v2",
      environmentClass: "TEST",
      configurationRoles: Object.freeze(["MERCHANT"]),
      fundsFlowProfile: "DIRECT_CHARGES",
      dashboardProfile: "EXPRESS",
      feesResponsibility: "CONNECTED_MERCHANT",
      lossesResponsibility: "CONNECTED_MERCHANT",
      readinessState: "PENDING"
    })
  });
}

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name) VALUES
      ('${TENANT_A}', 'airenpay-042-a', 'AIRenPay 042 A'),
      ('${TENANT_B}', 'airenpay-042-b', 'AIRenPay 042 B');
    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone) VALUES
      ('${LOCATION_A}', '${TENANT_A}', 'main', 'Main A', 'Europe/Rome'),
      ('${LOCATION_B}', '${TENANT_B}', 'main', 'Main B', 'Europe/Rome');
    INSERT INTO identity.identities (id, display_name) VALUES
      ('${IDENTITY_A}', 'AIRenPay 042 A'),
      ('${IDENTITY_B}', 'AIRenPay 042 B');
  `);
}

test("AIRenPay provider connection persistence is tenant isolated by PostgreSQL RLS", async (t) => {
  await seed();
  t.after(async () => { await pool.end(); });

  const store = new PostgresAirenPayProviderConnectionStore(pool);
  const contextA = context(TENANT_A, LOCATION_A, IDENTITY_A, "airenpay-042-a");
  const contextB = context(TENANT_B, LOCATION_B, IDENTITY_B, "airenpay-042-b");

  const insertedA = await store.insert(contextA, connection(CONNECTION_A, TENANT_A, "acct_sandbox_tenant_a"));
  assert.equal(insertedA.gateway.tenantId, TENANT_A);
  assert.equal(insertedA.profile.environmentClass, "TEST");
  assert.equal(insertedA.profile.fundsFlowProfile, "DIRECT_CHARGES");
  assert.deepEqual(insertedA.gateway.credentialSecretRef, {
    provider: "github-actions",
    key: "STRIPE_AIRENPAY_TEST_SECRET_KEY"
  });

  const insertedB = await store.insert(contextB, connection(CONNECTION_B, TENANT_B, "acct_sandbox_tenant_b"));
  assert.equal(insertedB.gateway.tenantId, TENANT_B);

  assert.equal((await store.list(contextA)).length, 1);
  assert.equal((await store.list(contextB)).length, 1);
  assert.equal(await store.getById(contextA, CONNECTION_B), null);
  assert.equal(await store.getById(contextB, CONNECTION_A), null);

  await assert.rejects(
    () => store.insert(contextA, connection("99999999-9999-4999-8999-999999999999", TENANT_B, "acct_cross_tenant_denied")),
    /row-level security|policy/i
  );

  await assert.rejects(
    () => store.insert(contextB, connection("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", TENANT_B, "acct_sandbox_tenant_a")),
    /duplicate key|unique constraint/i
  );

  const persisted = await pool.query(
    `SELECT tenant_id::text AS tenant_id, provider_type, environment_class, provider_account_reference,
            credential_secret_ref
       FROM airenpay.provider_connections
      ORDER BY tenant_id`
  );
  assert.equal(persisted.rowCount, 2);
  assert.ok(persisted.rows.every((row) => row.environment_class === "TEST"));
  assert.ok(persisted.rows.every((row) => row.provider_type === "stripe"));
  assert.ok(persisted.rows.every((row) => String(row.credential_secret_ref).includes("STRIPE_AIRENPAY_TEST_SECRET_KEY")));
  assert.ok(persisted.rows.every((row) => !String(row.credential_secret_ref).includes("sk_test_")));
});
