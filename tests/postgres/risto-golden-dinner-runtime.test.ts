import test from "node:test";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import { type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  GOLDEN_DINNER_STEPS,
  runGoldenDinner,
  type GoldenDinnerContextSet,
  type GoldenDinnerInput,
} from "../../packages/ristoairen/src/journeys/golden-dinner-runtime.ts";
import { createPostgresGoldenDinnerServices } from "../../packages/persistence-postgres/src/risto-golden-dinner-runtime.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 20 });
const services = createPostgresGoldenDinnerServices(pool);

const TENANT_A = "34343434-1111-4111-8111-111111111111";
const LOCATION_A = "34343434-2222-4222-8222-222222222221";
const TENANT_B = "34343434-3333-4333-8333-333333333333";
const LOCATION_B = "34343434-4444-4444-8444-444444444444";
const GUEST = "34343434-5555-4555-8555-555555555551";
const FOH = "34343434-5555-4555-8555-555555555552";
const KITCHEN = "34343434-5555-4555-8555-555555555553";
const BAR = "34343434-5555-4555-8555-555555555554";
const CASHIER = "34343434-5555-4555-8555-555555555555";
const MANAGER = "34343434-5555-4555-8555-555555555556";
const STELLA = "34343434-5555-4555-8555-555555555557";
const TENANT_MEMBERSHIP = "34343434-6666-4666-8666-666666666661";
const LOCATION_MEMBERSHIP = "34343434-7777-4777-8777-777777777771";
const JOURNEY = "34343434-8888-4888-8888-888888888881";
const TABLE = "34343434-9999-4999-8999-999999999991";
const MENU_VERSION = "34343434-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const KITCHEN_ITEM = "34343434-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const BAR_ITEM = "34343434-cccc-4ccc-8ccc-ccccccccccc1";
const CORRELATION = "mat034-golden-dinner-correlation";

const ENTITLEMENTS = ["vertical.ristoairen"] as const;
const PERMISSIONS = Object.freeze({
  GUEST: ["guest.party.upsert", "reservation.create"],
  FOH: ["floor.seat", "service.session.open", "order.submit", "service.serve", "service.session.close"],
  KITCHEN: ["production.ticket.progress"],
  BAR: ["production.ticket.progress"],
  CASHIER: ["pos.payment.record"],
  MANAGER: ["operations.review"],
  STELLA: ["intelligence.proposal.create"],
} as const);

function context(
  actorIdentityId: string,
  permissions: readonly string[],
  options: Readonly<{
    tenantId?: string;
    locationId?: string;
    correlationId?: string;
    platformRoles?: readonly string[];
    entitlements?: readonly string[];
  }> = {},
): SecurityContext {
  return Object.freeze({
    correlationId: options.correlationId ?? CORRELATION,
    actorIdentityId,
    platformRoles: options.platformRoles ?? [],
    platformPermissions: [],
    tenantId: options.tenantId ?? TENANT_A,
    locationId: options.locationId ?? LOCATION_A,
    tenantMembershipId: TENANT_MEMBERSHIP,
    locationMembershipId: LOCATION_MEMBERSHIP,
    tenantRole: "operator",
    locationRole: "operator",
    permissions,
    entitlements: options.entitlements ?? ENTITLEMENTS,
  });
}

function contexts(): GoldenDinnerContextSet {
  return Object.freeze({
    GUEST: context(GUEST, PERMISSIONS.GUEST),
    FOH: context(FOH, PERMISSIONS.FOH),
    KITCHEN: context(KITCHEN, PERMISSIONS.KITCHEN),
    BAR: context(BAR, PERMISSIONS.BAR),
    CASHIER: context(CASHIER, PERMISSIONS.CASHIER),
    MANAGER: context(MANAGER, PERMISSIONS.MANAGER),
    STELLA: context(STELLA, PERMISSIONS.STELLA, { platformRoles: ["AI_STELLA"] }),
  });
}

const input: GoldenDinnerInput = Object.freeze({
  journeyId: JOURNEY,
  arrivalMode: "BOOKING",
  partySize: 4,
  guestCredentialReference: "TEST_TEMPORARY:guest:mat034",
  tableId: TABLE,
  menuVersionId: MENU_VERSION,
  kitchenItemId: KITCHEN_ITEM,
  barItemId: BAR_ITEM,
  totalAmount: "96.50",
  currency: "EUR",
  idempotencyKey: "mat034-golden-dinner",
});

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES
      ('${TENANT_A}','mat034-a','MAT034 A'),
      ('${TENANT_B}','mat034-b','MAT034 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,status) VALUES
      ('${LOCATION_A}','${TENANT_A}','main','MAT034 Main','Europe/Rome','active'),
      ('${LOCATION_B}','${TENANT_B}','main','MAT034 Foreign','Europe/Rome','active');
    INSERT INTO identity.identities (id,display_name) VALUES
      ('${GUEST}','MAT034 Guest'),
      ('${FOH}','MAT034 FOH'),
      ('${KITCHEN}','MAT034 Kitchen'),
      ('${BAR}','MAT034 Bar'),
      ('${CASHIER}','MAT034 Cashier'),
      ('${MANAGER}','MAT034 Manager'),
      ('${STELLA}','MAT034 STELLA');
  `);
}

async function visibleRows(actor: string, tenantId: string, locationId: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
      [actor, tenantId, locationId, CORRELATION],
    );
    const result = await client.query("SELECT count(*)::int AS count FROM ristoairen.golden_dinner_runtime_events");
    await client.query("COMMIT");
    return Number(result.rows[0].count);
  } finally {
    client.release();
  }
}

async function expectMutationDenied(sql: string, params: readonly unknown[]): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
      [FOH, TENANT_A, LOCATION_A, CORRELATION],
    );
    await assert.rejects(client.query(sql, [...params]), /permission denied|row-level security|IMMUTABLE|FORBIDDEN/i);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

test("MAT-034 / GJ2-039 Golden Dinner executable spine PostgreSQL runtime", async t => {
  await seed();
  t.after(async () => { await pool.end(); });

  let firstSnapshot: Awaited<ReturnType<typeof runGoldenDinner>>;

  await t.test("executes all twelve correlated steps and leaves STELLA proposal pending human approval", async () => {
    firstSnapshot = await runGoldenDinner(contexts(), input, { services, now: () => "2026-09-13T10:50:00Z" });
    assert.equal(firstSnapshot.environmentClass, "TEST_TEMPORARY");
    assert.equal(firstSnapshot.tenantId, TENANT_A);
    assert.equal(firstSnapshot.locationId, LOCATION_A);
    assert.equal(firstSnapshot.correlationId, CORRELATION);
    assert.equal(firstSnapshot.proposalStatus, "PENDING_APPROVAL");
    assert.deepEqual(firstSnapshot.timeline.map(item => item.step), [...GOLDEN_DINNER_STEPS]);
    assert.deepEqual(firstSnapshot.timeline.map(item => item.sequence), [1,2,3,4,5,6,7,8,9,10,11,12]);

    const persisted = await pool.query(
      `SELECT step,sequence,actor_identity_id::text AS "actorIdentityId",environment_class AS "environmentClass",correlation_id AS "correlationId"
         FROM ristoairen.golden_dinner_runtime_events
        WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND journey_id=$3::uuid
        ORDER BY sequence`,
      [TENANT_A, LOCATION_A, JOURNEY],
    );
    assert.equal(persisted.rowCount, 12);
    assert.deepEqual(persisted.rows.map(row => row.step), [...GOLDEN_DINNER_STEPS]);
    assert.deepEqual(persisted.rows.map(row => row.actorIdentityId), [GUEST,GUEST,FOH,FOH,FOH,KITCHEN,BAR,FOH,CASHIER,FOH,MANAGER,STELLA]);
    assert.ok(persisted.rows.every(row => row.environmentClass === "TEST_TEMPORARY"));
    assert.ok(persisted.rows.every(row => row.correlationId === CORRELATION));
  });

  await t.test("retries the same journey idempotently with stable resources and no duplicate evidence", async () => {
    const replay = await runGoldenDinner(contexts(), input, { services, now: () => "2026-09-13T10:51:00Z" });
    assert.equal(replay.partyId, firstSnapshot.partyId);
    assert.equal(replay.demandReferenceId, firstSnapshot.demandReferenceId);
    assert.equal(replay.serviceSessionId, firstSnapshot.serviceSessionId);
    assert.equal(replay.orderId, firstSnapshot.orderId);
    assert.equal(replay.kitchenTicketId, firstSnapshot.kitchenTicketId);
    assert.equal(replay.barTicketId, firstSnapshot.barTicketId);
    assert.equal(replay.paymentId, firstSnapshot.paymentId);
    assert.equal(replay.managerReviewId, firstSnapshot.managerReviewId);
    assert.equal(replay.proposalId, firstSnapshot.proposalId);
    assert.deepEqual(replay.timeline.map(item => item.resourceId), firstSnapshot.timeline.map(item => item.resourceId));
    const count = await pool.query(
      "SELECT count(*)::int AS count FROM ristoairen.golden_dinner_runtime_events WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND journey_id=$3::uuid",
      [TENANT_A, LOCATION_A, JOURNEY],
    );
    assert.equal(count.rows[0].count, 12);
  });

  await t.test("rejects conflicting reuse of an idempotency key without mutating persisted evidence", async () => {
    await assert.rejects(
      runGoldenDinner(contexts(), { ...input, partySize: 5 }, { services, now: () => "2026-09-13T10:52:00Z" }),
      error => hasCode(error, "IDEMPOTENCY_CONFLICT"),
    );
    const party = await pool.query(
      `SELECT payload->>'partySize' AS "partySize"
         FROM ristoairen.golden_dinner_runtime_events
        WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND idempotency_key=$3`,
      [TENANT_A, LOCATION_A, `${input.idempotencyKey}:party_recorded`],
    );
    assert.equal(party.rows[0].partySize, "4");
    const count = await pool.query(
      "SELECT count(*)::int AS count FROM ristoairen.golden_dinner_runtime_events WHERE tenant_id=$1::uuid AND location_id=$2::uuid",
      [TENANT_A, LOCATION_A],
    );
    assert.equal(count.rows[0].count, 12);
  });

  await t.test("enforces tenant/location RLS and append-only ledger boundaries", async () => {
    assert.equal(await visibleRows(GUEST, TENANT_A, LOCATION_A), 12);
    assert.equal(await visibleRows(GUEST, TENANT_B, LOCATION_B), 0);
    await expectMutationDenied(
      "UPDATE ristoairen.golden_dinner_runtime_events SET event_type='risto.tampered' WHERE tenant_id=$1::uuid AND location_id=$2::uuid",
      [TENANT_A, LOCATION_A],
    );
    await expectMutationDenied(
      "DELETE FROM ristoairen.golden_dinner_runtime_events WHERE tenant_id=$1::uuid AND location_id=$2::uuid",
      [TENANT_A, LOCATION_A],
    );
  });

  await t.test("fails closed when AI_STELLA crosses Core authority or actor scopes diverge", async () => {
    const base = contexts();
    const stellaAsFoh = Object.freeze({
      ...base,
      FOH: context(FOH, PERMISSIONS.FOH, { platformRoles: ["AI_STELLA"] }),
    }) as GoldenDinnerContextSet;
    await assert.rejects(runGoldenDinner(stellaAsFoh, input, { services }), error => hasCode(error, "PERMISSION_DENIED"));

    const humanStella = Object.freeze({
      ...base,
      STELLA: context(STELLA, PERMISSIONS.STELLA),
    }) as GoldenDinnerContextSet;
    await assert.rejects(runGoldenDinner(humanStella, input, { services }), error => hasCode(error, "PERMISSION_DENIED"));

    const foreignKitchen = Object.freeze({
      ...base,
      KITCHEN: context(KITCHEN, PERMISSIONS.KITCHEN, { tenantId: TENANT_B, locationId: LOCATION_B }),
    }) as GoldenDinnerContextSet;
    await assert.rejects(runGoldenDinner(foreignKitchen, input, { services }), error => hasCode(error, "TENANT_SCOPE_VIOLATION"));

    const wrongCorrelation = Object.freeze({
      ...base,
      BAR: context(BAR, PERMISSIONS.BAR, { correlationId: "mat034-wrong-correlation" }),
    }) as GoldenDinnerContextSet;
    await assert.rejects(runGoldenDinner(wrongCorrelation, input, { services }), error => hasCode(error, "CONFLICT"));

    const count = await pool.query(
      "SELECT count(*)::int AS count FROM ristoairen.golden_dinner_runtime_events WHERE tenant_id=$1::uuid AND location_id=$2::uuid",
      [TENANT_A, LOCATION_A],
    );
    assert.equal(count.rows[0].count, 12);
  });
});
