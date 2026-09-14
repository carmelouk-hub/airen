import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { authenticateAndResolveRequestSecurityContext } from "../../apps/api/src/security-context.ts";
import type { MembershipRepository, RolePermissionResolver } from "../../packages/authorization/src/index.ts";
import type { EntitlementRepository } from "../../packages/entitlements/src/index.ts";
import type { AuthenticationAdapter, AuthenticatedPrincipal } from "../../packages/identity/src/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import type { LocationRepository, TenantDomainRepository, TenantRepository } from "../../packages/tenant/src/index.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

const TENANT_A = "a3700000-0000-4370-8370-000000000001";
const LOCATION_A = "a3700000-0000-4370-8370-000000000002";
const IDENTITY_A = "a3700000-0000-4370-8370-000000000003";
const TENANT_MEMBERSHIP_A = "a3700000-0000-4370-8370-000000000004";
const LOCATION_MEMBERSHIP_A = "a3700000-0000-4370-8370-000000000005";
const ORDER_A = "a3700000-0000-4370-8370-000000000006";
const PAYMENT_A = "a3700000-0000-4370-8370-000000000007";

const TENANT_B = "b3700000-0000-4370-8370-000000000001";
const LOCATION_B = "b3700000-0000-4370-8370-000000000002";
const IDENTITY_B = "b3700000-0000-4370-8370-000000000003";
const TENANT_MEMBERSHIP_B = "b3700000-0000-4370-8370-000000000004";
const LOCATION_MEMBERSHIP_B = "b3700000-0000-4370-8370-000000000005";
const ORDER_B = "b3700000-0000-4370-8370-000000000006";
const PAYMENT_B = "b3700000-0000-4370-8370-000000000007";

const principalA: AuthenticatedPrincipal = {
  identityId: IDENTITY_A,
  providerKey: "mat037",
  providerSubject: "operator-a",
  platformRoles: []
};

const authenticationA: AuthenticationAdapter = {
  authenticate: async () => principalA
};

const tenants: TenantRepository = {
  findById: async (id) => id === TENANT_A
    ? { id: TENANT_A, slug: "mat037-a", name: "MAT037 Tenant A", status: "active" }
    : id === TENANT_B
      ? { id: TENANT_B, slug: "mat037-b", name: "MAT037 Tenant B", status: "active" }
      : null,
  findBySlug: async (slug) => slug === "mat037-a"
    ? { id: TENANT_A, slug: "mat037-a", name: "MAT037 Tenant A", status: "active" }
    : slug === "mat037-b"
      ? { id: TENANT_B, slug: "mat037-b", name: "MAT037 Tenant B", status: "active" }
      : null
};

const locations: LocationRepository = {
  findById: async (id) => id === LOCATION_A
    ? { id: LOCATION_A, tenantId: TENANT_A, slug: "main", name: "MAT037 A Main", status: "active" }
    : id === LOCATION_B
      ? { id: LOCATION_B, tenantId: TENANT_B, slug: "main", name: "MAT037 B Main", status: "active" }
      : null,
  findPrimaryForTenant: async (tenantId) => tenantId === TENANT_A
    ? { id: LOCATION_A, tenantId: TENANT_A, slug: "main", name: "MAT037 A Main", status: "active" }
    : tenantId === TENANT_B
      ? { id: LOCATION_B, tenantId: TENANT_B, slug: "main", name: "MAT037 B Main", status: "active" }
      : null
};

const domains: TenantDomainRepository = {
  findActiveByHostname: async () => null
};

const memberships: MembershipRepository = {
  findTenantMembership: async (tenantId, identityId) => tenantId === TENANT_A && identityId === IDENTITY_A
    ? { id: TENANT_MEMBERSHIP_A, tenantId: TENANT_A, identityId: IDENTITY_A, roleKey: "owner", status: "active" }
    : null,
  findLocationMembership: async (tenantMembershipId, locationId) => tenantMembershipId === TENANT_MEMBERSHIP_A && locationId === LOCATION_A
    ? { id: LOCATION_MEMBERSHIP_A, tenantMembershipId: TENANT_MEMBERSHIP_A, tenantId: TENANT_A, locationId: LOCATION_A, roleKey: "manager", status: "active" }
    : null
};

const roles: RolePermissionResolver = {
  platformPermissions: async () => [],
  tenantPermissions: async () => ["tenant.location.all"],
  locationPermissions: async () => []
};

const entitlements: EntitlementRepository = {
  enabledForTenant: async () => []
};

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name) VALUES
      ('${TENANT_A}', 'mat037-a', 'MAT037 Tenant A'),
      ('${TENANT_B}', 'mat037-b', 'MAT037 Tenant B');

    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone, is_primary) VALUES
      ('${LOCATION_A}', '${TENANT_A}', 'main', 'MAT037 A Main', 'Europe/Rome', true),
      ('${LOCATION_B}', '${TENANT_B}', 'main', 'MAT037 B Main', 'Europe/Rome', true);

    INSERT INTO identity.identities (id, display_name) VALUES
      ('${IDENTITY_A}', 'MAT037 Operator A'),
      ('${IDENTITY_B}', 'MAT037 Operator B');

    INSERT INTO authz.tenant_memberships (id, tenant_id, identity_id, role_key) VALUES
      ('${TENANT_MEMBERSHIP_A}', '${TENANT_A}', '${IDENTITY_A}', 'owner'),
      ('${TENANT_MEMBERSHIP_B}', '${TENANT_B}', '${IDENTITY_B}', 'owner');

    INSERT INTO authz.location_memberships
      (id, tenant_id, tenant_membership_id, location_id, role_key)
    VALUES
      ('${LOCATION_MEMBERSHIP_A}', '${TENANT_A}', '${TENANT_MEMBERSHIP_A}', '${LOCATION_A}', 'manager'),
      ('${LOCATION_MEMBERSHIP_B}', '${TENANT_B}', '${TENANT_MEMBERSHIP_B}', '${LOCATION_B}', 'manager');

    INSERT INTO ristoairen.orders
      (id, tenant_id, location_id, channel, status, currency,
       subtotal, discount_total, tax_total, total, opened_at,
       created_by_identity_id, version, environment_class)
    VALUES
      ('${ORDER_A}', '${TENANT_A}', '${LOCATION_A}', 'POS', 'PAID', 'EUR', 37, 0, 0, 37, now(), '${IDENTITY_A}', 1, 'TEST_TEMPORARY'),
      ('${ORDER_B}', '${TENANT_B}', '${LOCATION_B}', 'POS', 'PAID', 'EUR', 73, 0, 0, 73, now(), '${IDENTITY_B}', 1, 'TEST_TEMPORARY');

    INSERT INTO ristoairen.payments
      (id, tenant_id, location_id, order_id, payment_method, amount, currency, status,
       provider_reference, received_at, recorded_by, idempotency_key,
       metadata_sanitized, row_version, environment_class)
    VALUES
      ('${PAYMENT_A}', '${TENANT_A}', '${LOCATION_A}', '${ORDER_A}', 'CASH', 37, 'EUR', 'RECORDED',
       NULL, now(), '${IDENTITY_A}', 'mat037-a-payment', '{}', 1, 'TEST_TEMPORARY'),
      ('${PAYMENT_B}', '${TENANT_B}', '${LOCATION_B}', '${ORDER_B}', 'CARD', 73, 'EUR', 'RECORDED',
       'mat037-provider-b-secret-reference', now(), '${IDENTITY_B}', 'mat037-b-payment', '{"secretMarker":"TENANT_B_ONLY"}', 1, 'TEST_TEMPORARY');

    INSERT INTO audit.audit_events
      (tenant_id, location_id, actor_identity_id, actor_kind, action_key, correlation_id, outcome, resource_type, resource_id)
    VALUES
      ('${TENANT_A}', '${LOCATION_A}', '${IDENTITY_A}', 'user', 'MAT037_A_VISIBLE', 'mat037-a-audit', 'success', 'Order', '${ORDER_A}'),
      ('${TENANT_B}', '${LOCATION_B}', '${IDENTITY_B}', 'user', 'MAT037_B_SECRET', 'mat037-b-audit', 'success', 'Order', '${ORDER_B}');

    INSERT INTO events.outbox_events
      (tenant_id, location_id, event_type, aggregate_type, aggregate_id, payload, correlation_id)
    VALUES
      ('${TENANT_A}', '${LOCATION_A}', 'MAT037_A_VISIBLE', 'Order', '${ORDER_A}', '{"scope":"A"}', 'mat037-a-outbox'),
      ('${TENANT_B}', '${LOCATION_B}', 'MAT037_B_SECRET', 'Order', '${ORDER_B}', '{"secretMarker":"TENANT_B_ONLY"}', 'mat037-b-outbox');
  `);
}

async function asAirenApp<T>(
  context: Readonly<{ identityId: string; tenantId?: string; locationId?: string; correlationId: string }>,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.identity_id', $1, true)", [context.identityId]);
    await client.query("SELECT set_config('airen.tenant_id', $1, true)", [context.tenantId ?? ""]);
    await client.query("SELECT set_config('airen.location_id', $1, true)", [context.locationId ?? ""]);
    await client.query("SELECT set_config('airen.correlation_id', $1, true)", [context.correlationId]);
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function assertNoRows(result: QueryResult, label: string): void {
  assert.equal(result.rowCount, 0, `${label}: cross-tenant row became visible`);
}

async function expectDeniedOrZeroRow(
  client: PoolClient,
  action: () => Promise<QueryResult>,
  label: string
): Promise<void> {
  await client.query("SAVEPOINT mat037_negative_probe");
  let result: QueryResult;
  try {
    result = await action();
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT mat037_negative_probe");
    await client.query("RELEASE SAVEPOINT mat037_negative_probe");
    const code = (error as { code?: string }).code;
    assert.ok(
      code === "42501" || code === "23503" || code === "23514",
      `${label}: expected fail-closed database denial, got ${String(code ?? error)}`
    );
    return;
  }
  await client.query("RELEASE SAVEPOINT mat037_negative_probe");
  assert.equal(result.rowCount, 0, `${label}: cross-tenant mutation affected a row`);
}

test.after(async () => {
  await pool.end();
});

test("MAT-037 GJ2-032 cross-tenant isolation negative E2E", async (t) => {
  await seed();

  await t.test("Tenant A trusted context cannot read Tenant B by guessed ID or tenant filter", async () => {
    await asAirenApp(
      { identityId: IDENTITY_A, tenantId: TENANT_A, locationId: LOCATION_A, correlationId: "mat037-read-probe" },
      async (client) => {
        assertNoRows(await client.query("SELECT id FROM platform.tenants WHERE id=$1::uuid", [TENANT_B]), "tenant guessed ID");
        assertNoRows(await client.query("SELECT id FROM platform.locations WHERE id=$1::uuid", [LOCATION_B]), "location guessed ID");
        assertNoRows(await client.query("SELECT id FROM ristoairen.orders WHERE id=$1::uuid", [ORDER_B]), "order guessed ID");
        assertNoRows(await client.query("SELECT id FROM ristoairen.payments WHERE id=$1::uuid", [PAYMENT_B]), "payment guessed ID");
        assertNoRows(await client.query("SELECT id FROM ristoairen.orders WHERE tenant_id=$1::uuid", [TENANT_B]), "order tenant filter");
        assertNoRows(await client.query("SELECT id FROM ristoairen.payments WHERE tenant_id=$1::uuid", [TENANT_B]), "payment tenant filter");
        assertNoRows(await client.query("SELECT id FROM audit.audit_events WHERE correlation_id='mat037-b-audit'"), "audit correlation probe");
        assertNoRows(await client.query("SELECT id FROM events.outbox_events WHERE correlation_id='mat037-b-outbox'"), "outbox correlation probe");
      }
    );
  });

  await t.test("Tenant A trusted context cannot mutate Tenant B even with known resource IDs", async () => {
    await asAirenApp(
      { identityId: IDENTITY_A, tenantId: TENANT_A, locationId: LOCATION_A, correlationId: "mat037-write-probe" },
      async (client) => {
        await expectDeniedOrZeroRow(
          client,
          () => client.query("UPDATE ristoairen.orders SET status='VOID' WHERE id=$1::uuid", [ORDER_B]),
          "order guessed-ID update"
        );
        await expectDeniedOrZeroRow(
          client,
          () => client.query("UPDATE ristoairen.payments SET metadata_sanitized='{}'::jsonb WHERE id=$1::uuid", [PAYMENT_B]),
          "payment guessed-ID update"
        );
        await expectDeniedOrZeroRow(
          client,
          () => client.query(
            `INSERT INTO events.outbox_events
               (tenant_id, location_id, event_type, aggregate_type, aggregate_id, payload, correlation_id)
             VALUES ($1::uuid, $2::uuid, 'MAT037_FORGED', 'Order', $3, '{}', 'mat037-forged-outbox')`,
            [TENANT_B, LOCATION_B, ORDER_B]
          ),
          "cross-tenant outbox insert"
        );
      }
    );

    const untouched = await pool.query(
      `SELECT o.status,
              p.metadata_sanitized->>'secretMarker' AS payment_secret,
              (SELECT count(*)::int FROM events.outbox_events WHERE correlation_id='mat037-forged-outbox') AS forged_outbox_count
         FROM ristoairen.orders o
         JOIN ristoairen.payments p ON p.order_id=o.id
        WHERE o.id=$1::uuid`,
      [ORDER_B]
    );
    assert.equal(untouched.rowCount, 1);
    assert.equal(untouched.rows[0].status, "PAID");
    assert.equal(untouched.rows[0].payment_secret, "TENANT_B_ONLY");
    assert.equal(untouched.rows[0].forged_outbox_count, 0);
  });

  await t.test("untrusted tenant/location payload cannot override trusted route and membership resolution", async () => {
    const resolvedA = await authenticateAndResolveRequestSecurityContext({
      request: { tenant_id: TENANT_B, location_id: LOCATION_B },
      authentication: authenticationA,
      hostname: "mat037-a.airen.test",
      trustedBaseDomain: "airen.test",
      correlationId: "mat037-payload-spoof-a",
      tenants,
      locations,
      domains,
      memberships,
      roles,
      entitlements
    });
    assert.equal(resolvedA.context.actorIdentityId, IDENTITY_A);
    assert.equal(resolvedA.context.tenantId, TENANT_A);
    assert.equal(resolvedA.context.locationId, LOCATION_A);

    await assert.rejects(
      () => authenticateAndResolveRequestSecurityContext({
        request: { tenant_id: TENANT_B, location_id: LOCATION_B },
        authentication: authenticationA,
        hostname: "mat037-b.airen.test",
        trustedBaseDomain: "airen.test",
        correlationId: "mat037-payload-spoof-b",
        tenants,
        locations,
        domains,
        memberships,
        roles,
        entitlements
      }),
      (error: unknown) => error instanceof AppError && error.code === "MEMBERSHIP_REQUIRED"
    );
  });

  await t.test("missing trusted tenant/location context exposes no Tenant A or Tenant B business data", async () => {
    await asAirenApp(
      { identityId: IDENTITY_A, correlationId: "mat037-empty-context" },
      async (client) => {
        assertNoRows(await client.query("SELECT id FROM platform.tenants WHERE id IN ($1::uuid,$2::uuid)", [TENANT_A, TENANT_B]), "tenant rows without trusted context");
        assertNoRows(await client.query("SELECT id FROM ristoairen.orders WHERE id IN ($1::uuid,$2::uuid)", [ORDER_A, ORDER_B]), "order rows without trusted context");
        assertNoRows(await client.query("SELECT id FROM ristoairen.payments WHERE id IN ($1::uuid,$2::uuid)", [PAYMENT_A, PAYMENT_B]), "payment rows without trusted context");
      }
    );
  });
});