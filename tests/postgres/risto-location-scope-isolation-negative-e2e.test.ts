import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { authenticateAndResolveRequestSecurityContext } from "../../apps/api/src/security-context.ts";
import type { MembershipRepository, RolePermissionResolver } from "../../packages/authorization/src/index.ts";
import type { EntitlementRepository } from "../../packages/entitlements/src/index.ts";
import type { AuthenticationAdapter, AuthenticatedPrincipal } from "../../packages/identity/src/index.ts";
import type {
  LocationRepository,
  PublicRouteLookup,
  TenantDomainRepository,
  TenantRepository
} from "../../packages/tenant/src/index.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

const TENANT = "a3800000-0000-4380-8380-000000000001";
const LOCATION_A = "a3800000-0000-4380-8380-000000000002";
const LOCATION_B = "a3800000-0000-4380-8380-000000000003";
const OPERATOR = "a3800000-0000-4380-8380-000000000004";
const SEED_ACTOR_B = "a3800000-0000-4380-8380-000000000005";
const TENANT_MEMBERSHIP = "a3800000-0000-4380-8380-000000000006";
const LOCATION_MEMBERSHIP_A = "a3800000-0000-4380-8380-000000000007";

const UOM = "a3800000-0000-4380-8380-000000000010";
const INGREDIENT = "a3800000-0000-4380-8380-000000000011";
const STOCK_A = "a3800000-0000-4380-8380-000000000012";
const STOCK_B = "a3800000-0000-4380-8380-000000000013";
const SHIFT_A = "a3800000-0000-4380-8380-000000000014";
const SHIFT_B = "a3800000-0000-4380-8380-000000000015";
const PLAN_A = "a3800000-0000-4380-8380-000000000016";
const PLAN_B = "a3800000-0000-4380-8380-000000000017";

const JOURNEY_A = "a3800000-0000-4380-8380-000000000020";
const JOURNEY_B = "a3800000-0000-4380-8380-000000000021";
const BOOKING_A = "a3800000-0000-4380-8380-000000000022";
const BOOKING_B = "a3800000-0000-4380-8380-000000000023";
const TABLE_A = "a3800000-0000-4380-8380-000000000024";
const TABLE_B = "a3800000-0000-4380-8380-000000000025";
const SESSION_A = "a3800000-0000-4380-8380-000000000026";
const SESSION_B = "a3800000-0000-4380-8380-000000000027";
const TICKET_A = "a3800000-0000-4380-8380-000000000028";
const TICKET_B = "a3800000-0000-4380-8380-000000000029";

const principal: AuthenticatedPrincipal = {
  identityId: OPERATOR,
  providerKey: "mat038",
  providerSubject: "location-a-operator",
  platformRoles: []
};

const authentication: AuthenticationAdapter = {
  authenticate: async () => principal
};

const tenant = Object.freeze({
  id: TENANT,
  slug: "lumen27",
  name: "LUMEN 27 Synthetic",
  status: "active" as const
});
const locationA = Object.freeze({
  id: LOCATION_A,
  tenantId: TENANT,
  slug: "main",
  name: "LUMEN 27 Location A",
  status: "active" as const
});
const locationB = Object.freeze({
  id: LOCATION_B,
  tenantId: TENANT,
  slug: "second",
  name: "LUMEN 27 Location B",
  status: "active" as const
});

const tenants: TenantRepository = {
  findById: async (id) => id === TENANT ? tenant : null,
  findBySlug: async (slug) => slug === tenant.slug ? tenant : null
};

const locations: LocationRepository = {
  findById: async (id) => id === LOCATION_A ? locationA : id === LOCATION_B ? locationB : null,
  findPrimaryForTenant: async (tenantId) => tenantId === TENANT ? locationA : null
};

const domains: TenantDomainRepository & PublicRouteLookup = {
  findActiveByHostname: async (hostname) => hostname === "location-b.lumen27.test"
    ? { id: "a3800000-0000-4380-8380-000000000030", tenantId: TENANT, locationId: LOCATION_B, hostname, status: "active" }
    : null,
  findTrustedSubdomainRoute: async (slug) => slug === "lumen27" ? { tenant, location: locationA } : null,
  findCustomDomainRoute: async (hostname) => hostname === "location-b.lumen27.test"
    ? {
        domain: { id: "a3800000-0000-4380-8380-000000000030", tenantId: TENANT, locationId: LOCATION_B, hostname, status: "active" },
        tenant,
        location: locationB
      }
    : null
};

const memberships: MembershipRepository = {
  findTenantMembership: async (tenantId, identityId) => tenantId === TENANT && identityId === OPERATOR
    ? { id: TENANT_MEMBERSHIP, tenantId: TENANT, identityId: OPERATOR, roleKey: "location_operator", status: "active" }
    : null,
  findLocationMembership: async (tenantMembershipId, locationId) =>
    tenantMembershipId === TENANT_MEMBERSHIP && locationId === LOCATION_A
      ? {
          id: LOCATION_MEMBERSHIP_A,
          tenantMembershipId: TENANT_MEMBERSHIP,
          tenantId: TENANT,
          locationId: LOCATION_A,
          roleKey: "location_operator",
          status: "active"
        }
      : null
};

const roles: RolePermissionResolver = {
  platformPermissions: async () => [],
  tenantPermissions: async () => [],
  locationPermissions: async () => ["location.operations.read", "location.operations.write"]
};

const entitlements: EntitlementRepository = {
  enabledForTenant: async () => ["vertical.ristoairen"]
};

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name) VALUES
      ('${TENANT}', 'lumen27', 'LUMEN 27 Synthetic');

    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone, is_primary, status) VALUES
      ('${LOCATION_A}', '${TENANT}', 'main', 'LUMEN 27 Location A', 'Europe/Rome', true, 'active'),
      ('${LOCATION_B}', '${TENANT}', 'second', 'LUMEN 27 Location B', 'Europe/Rome', false, 'active');

    INSERT INTO identity.identities (id, display_name) VALUES
      ('${OPERATOR}', 'MAT038 Location A Operator'),
      ('${SEED_ACTOR_B}', 'MAT038 Location B Fixture Actor');

    INSERT INTO authz.tenant_memberships (id, tenant_id, identity_id, role_key, status) VALUES
      ('${TENANT_MEMBERSHIP}', '${TENANT}', '${OPERATOR}', 'location_operator', 'active');

    INSERT INTO authz.location_memberships
      (id, tenant_id, tenant_membership_id, location_id, role_key, status)
    VALUES
      ('${LOCATION_MEMBERSHIP_A}', '${TENANT}', '${TENANT_MEMBERSHIP}', '${LOCATION_A}', 'location_operator', 'active');

    INSERT INTO ristoairen.units_of_measure
      (id, tenant_id, code, name, decimal_scale, active, environment_class)
    VALUES
      ('${UOM}', '${TENANT}', 'KG', 'Kilogram', 6, true, 'TEST_TEMPORARY');

    INSERT INTO ristoairen.ingredients
      (id, tenant_id, code, name, base_uom_id, active, environment_class)
    VALUES
      ('${INGREDIENT}', '${TENANT}', 'MAT038-ING', 'MAT038 Ingredient', '${UOM}', true, 'TEST_TEMPORARY');

    INSERT INTO ristoairen.stock_items
      (id, tenant_id, location_id, ingredient_id, on_hand_quantity, reserved_quantity, base_uom_id, active, environment_class)
    VALUES
      ('${STOCK_A}', '${TENANT}', '${LOCATION_A}', '${INGREDIENT}', 10, 0, '${UOM}', true, 'TEST_TEMPORARY'),
      ('${STOCK_B}', '${TENANT}', '${LOCATION_B}', '${INGREDIENT}', 99, 0, '${UOM}', true, 'TEST_TEMPORARY');

    INSERT INTO ristoairen.work_shifts
      (id, tenant_id, location_id, starts_at, ends_at, status, row_version, environment_class)
    VALUES
      ('${SHIFT_A}', '${TENANT}', '${LOCATION_A}', '2026-09-14T08:00:00Z', '2026-09-14T16:00:00Z', 'SCHEDULED', 1, 'TEST_TEMPORARY'),
      ('${SHIFT_B}', '${TENANT}', '${LOCATION_B}', '2026-09-14T08:00:00Z', '2026-09-14T16:00:00Z', 'SCHEDULED', 1, 'TEST_TEMPORARY');

    INSERT INTO ristoairen.food_safety_plans
      (id, tenant_id, location_id, code, name, status, version, environment_class)
    VALUES
      ('${PLAN_A}', '${TENANT}', '${LOCATION_A}', 'MAT038-A', 'MAT038 Plan A', 'ACTIVE', 1, 'TEST_TEMPORARY'),
      ('${PLAN_B}', '${TENANT}', '${LOCATION_B}', 'MAT038-B', 'MAT038 Plan B', 'ACTIVE', 1, 'TEST_TEMPORARY');

    INSERT INTO ristoairen.golden_dinner_runtime_events
      (journey_id, tenant_id, location_id, correlation_id, idempotency_key, step, sequence,
       resource_type, resource_id, event_type, actor_identity_id, environment_class, payload)
    VALUES
      ('${JOURNEY_A}', '${TENANT}', '${LOCATION_A}', 'mat038-seed-a', 'mat038-a-booking', 'DEMAND_ACCEPTED', 2,
       'Booking', '${BOOKING_A}', 'risto.demand.accepted', '${OPERATOR}', 'TEST_TEMPORARY', '{"scope":"A"}'),
      ('${JOURNEY_A}', '${TENANT}', '${LOCATION_A}', 'mat038-seed-a', 'mat038-a-table', 'PARTY_SEATED', 3,
       'Table', '${TABLE_A}', 'risto.party.seated', '${OPERATOR}', 'TEST_TEMPORARY', '{"scope":"A"}'),
      ('${JOURNEY_A}', '${TENANT}', '${LOCATION_A}', 'mat038-seed-a', 'mat038-a-session', 'SERVICE_SESSION_OPENED', 4,
       'ServiceSession', '${SESSION_A}', 'risto.service_session.opened', '${OPERATOR}', 'TEST_TEMPORARY', '{"scope":"A"}'),
      ('${JOURNEY_A}', '${TENANT}', '${LOCATION_A}', 'mat038-seed-a', 'mat038-a-production', 'KITCHEN_READY', 6,
       'ProductionTicket', '${TICKET_A}', 'risto.production.kitchen_ready', '${OPERATOR}', 'TEST_TEMPORARY', '{"scope":"A"}'),
      ('${JOURNEY_B}', '${TENANT}', '${LOCATION_B}', 'mat038-seed-b', 'mat038-b-booking', 'DEMAND_ACCEPTED', 2,
       'Booking', '${BOOKING_B}', 'risto.demand.accepted', '${SEED_ACTOR_B}', 'TEST_TEMPORARY', '{"scope":"B","secretMarker":"LOCATION_B_ONLY"}'),
      ('${JOURNEY_B}', '${TENANT}', '${LOCATION_B}', 'mat038-seed-b', 'mat038-b-table', 'PARTY_SEATED', 3,
       'Table', '${TABLE_B}', 'risto.party.seated', '${SEED_ACTOR_B}', 'TEST_TEMPORARY', '{"scope":"B"}'),
      ('${JOURNEY_B}', '${TENANT}', '${LOCATION_B}', 'mat038-seed-b', 'mat038-b-session', 'SERVICE_SESSION_OPENED', 4,
       'ServiceSession', '${SESSION_B}', 'risto.service_session.opened', '${SEED_ACTOR_B}', 'TEST_TEMPORARY', '{"scope":"B"}'),
      ('${JOURNEY_B}', '${TENANT}', '${LOCATION_B}', 'mat038-seed-b', 'mat038-b-production', 'KITCHEN_READY', 6,
       'ProductionTicket', '${TICKET_B}', 'risto.production.kitchen_ready', '${SEED_ACTOR_B}', 'TEST_TEMPORARY', '{"scope":"B"}');
  `);
}

async function asLocationA<T>(
  correlationId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query("SELECT set_config('airen.identity_id', $1, true)", [OPERATOR]);
    await client.query("SELECT set_config('airen.tenant_id', $1, true)", [TENANT]);
    await client.query("SELECT set_config('airen.location_id', $1, true)", [LOCATION_A]);
    await client.query("SELECT set_config('airen.correlation_id', $1, true)", [correlationId]);
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
  assert.equal(result.rowCount, 0, `${label}: unauthorized Location B row became visible`);
}

async function expectDeniedOrZeroRow(
  client: PoolClient,
  action: () => Promise<QueryResult>,
  label: string
): Promise<void> {
  await client.query("SAVEPOINT mat038_negative_probe");
  try {
    const result = await action();
    await client.query("RELEASE SAVEPOINT mat038_negative_probe");
    assert.equal(result.rowCount, 0, `${label}: unauthorized Location B mutation affected a row`);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT mat038_negative_probe");
    await client.query("RELEASE SAVEPOINT mat038_negative_probe");
    const code = (error as { code?: string }).code;
    assert.ok(
      code === "42501" || code === "23503" || code === "23514",
      `${label}: expected fail-closed database denial, got ${String(code ?? error)}`
    );
  }
}

function hasAppCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}

test.after(async () => {
  await pool.end();
});

test("MAT-038 GJ2-033 Location-scope isolation negative E2E", async (t) => {
  await seed();

  await t.test("Location A trusted context sees A evidence but cannot read Location B across C001/C009/C010/C012/C015/C017/C018", async () => {
    await asLocationA("mat038-read-probe", async (client) => {
      const visibleGolden = await client.query(
        "SELECT resource_type FROM ristoairen.golden_dinner_runtime_events ORDER BY sequence"
      );
      assert.deepEqual(
        visibleGolden.rows.map((row) => row.resource_type),
        ["Booking", "Table", "ServiceSession", "ProductionTicket"]
      );

      assertNoRows(
        await client.query("SELECT id FROM ristoairen.golden_dinner_runtime_events WHERE resource_id=$1::uuid", [BOOKING_B]),
        "C001 Booking known-ID probe"
      );
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.golden_dinner_runtime_events WHERE resource_id=$1::uuid", [TABLE_B]),
        "C009 Table known-ID probe"
      );
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.golden_dinner_runtime_events WHERE resource_id=$1::uuid", [SESSION_B]),
        "C010 ServiceSession known-ID probe"
      );
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.golden_dinner_runtime_events WHERE resource_id=$1::uuid", [TICKET_B]),
        "C012 ProductionTicket known-ID probe"
      );
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.golden_dinner_runtime_events WHERE location_id=$1::uuid", [LOCATION_B]),
        "C001/C009/C010/C012 Location selector probe"
      );

      const stockA = await client.query("SELECT id FROM ristoairen.stock_items WHERE id=$1::uuid", [STOCK_A]);
      assert.equal(stockA.rowCount, 1, "C015 positive control must expose Location A stock");
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.stock_items WHERE id=$1::uuid", [STOCK_B]),
        "C015 stock known-ID probe"
      );
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.stock_items WHERE location_id=$1::uuid", [LOCATION_B]),
        "C015 stock Location filter probe"
      );

      const shiftA = await client.query("SELECT id FROM ristoairen.work_shifts WHERE id=$1::uuid", [SHIFT_A]);
      assert.equal(shiftA.rowCount, 1, "C017 positive control must expose Location A shift");
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.work_shifts WHERE id=$1::uuid", [SHIFT_B]),
        "C017 workforce known-ID probe"
      );
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.work_shifts WHERE location_id=$1::uuid", [LOCATION_B]),
        "C017 workforce Location filter probe"
      );

      const planA = await client.query("SELECT id FROM ristoairen.food_safety_plans WHERE id=$1::uuid", [PLAN_A]);
      assert.equal(planA.rowCount, 1, "C018 positive control must expose Location A HACCP plan");
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.food_safety_plans WHERE id=$1::uuid", [PLAN_B]),
        "C018 HACCP known-ID probe"
      );
      assertNoRows(
        await client.query("SELECT id FROM ristoairen.food_safety_plans WHERE location_id=$1::uuid", [LOCATION_B]),
        "C018 HACCP Location filter probe"
      );
    });
  });

  await t.test("known Location B IDs cannot be mutated from Location A trusted context", async () => {
    await asLocationA("mat038-write-probe", async (client) => {
      await expectDeniedOrZeroRow(
        client,
        () => client.query(
          "UPDATE ristoairen.golden_dinner_runtime_events SET idempotency_key=idempotency_key WHERE resource_id=$1::uuid",
          [BOOKING_B]
        ),
        "C001/C009/C010/C012 governed evidence mutation"
      );
      await expectDeniedOrZeroRow(
        client,
        () => client.query("UPDATE ristoairen.stock_items SET active=active WHERE id=$1::uuid", [STOCK_B]),
        "C015 stock mutation"
      );
      await expectDeniedOrZeroRow(
        client,
        () => client.query("UPDATE ristoairen.work_shifts SET status=status WHERE id=$1::uuid", [SHIFT_B]),
        "C017 workforce mutation"
      );
      await expectDeniedOrZeroRow(
        client,
        () => client.query("UPDATE ristoairen.food_safety_plans SET name=name WHERE id=$1::uuid", [PLAN_B]),
        "C018 HACCP mutation"
      );
    });

    const untouched = await pool.query(
      `SELECT
         (SELECT on_hand_quantity::text FROM ristoairen.stock_items WHERE id=$1::uuid) AS stock_b,
         (SELECT status FROM ristoairen.work_shifts WHERE id=$2::uuid) AS shift_b,
         (SELECT name FROM ristoairen.food_safety_plans WHERE id=$3::uuid) AS plan_b,
         (SELECT payload->>'secretMarker' FROM ristoairen.golden_dinner_runtime_events WHERE resource_id=$4::uuid) AS golden_secret`,
      [STOCK_B, SHIFT_B, PLAN_B, BOOKING_B]
    );
    assert.equal(untouched.rows[0].stock_b, "99.000000");
    assert.equal(untouched.rows[0].shift_b, "SCHEDULED");
    assert.equal(untouched.rows[0].plan_b, "MAT038 Plan B");
    assert.equal(untouched.rows[0].golden_secret, "LOCATION_B_ONLY");
  });

  await t.test("client-controlled location_id cannot override trusted Location A route", async () => {
    const resolved = await authenticateAndResolveRequestSecurityContext({
      request: { location_id: LOCATION_B, tenant_id: TENANT },
      authentication,
      hostname: "lumen27.ristoairen.test",
      trustedBaseDomain: "ristoairen.test",
      correlationId: "mat038-payload-spoof",
      tenants,
      locations,
      domains,
      memberships,
      roles,
      entitlements
    });

    assert.equal(resolved.route.tenant.id, TENANT);
    assert.equal(resolved.route.location.id, LOCATION_A);
    assert.equal(resolved.context.tenantId, TENANT);
    assert.equal(resolved.context.locationId, LOCATION_A);
    assert.equal(resolved.context.locationMembershipId, LOCATION_MEMBERSHIP_A);
  });

  await t.test("trusted route to Location B fails closed without explicit Location B membership", async () => {
    await assert.rejects(
      authenticateAndResolveRequestSecurityContext({
        request: {},
        authentication,
        hostname: "location-b.lumen27.test",
        trustedBaseDomain: "ristoairen.test",
        correlationId: "mat038-route-b-denied",
        tenants,
        locations,
        domains,
        memberships,
        roles,
        entitlements
      }),
      (error: unknown) => hasAppCode(error, "LOCATION_MEMBERSHIP_REQUIRED")
    );
  });
});
