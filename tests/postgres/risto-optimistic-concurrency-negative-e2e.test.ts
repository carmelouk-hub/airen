import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  transitionGuestQueueEntry,
  transitionReservation
} from "../../packages/ristoairen/src/reservations/reservation-queue-service.ts";
import { moveServiceSessionToTable } from "../../packages/ristoairen/src/floor/floor-seating-service.ts";
import { closeServiceSession } from "../../packages/ristoairen/src/service/service-session-service.ts";
import { amendOrder } from "../../packages/ristoairen/src/orders/order-intake-service.ts";
import { PostgresGuestServiceOrderUnitOfWork } from "../../packages/persistence-postgres/src/risto-guest-service-order-runtime.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
const uow = new PostgresGuestServiceOrderUnitOfWork(pool);

const TENANT = "a3900000-0000-4390-8390-000000000001";
const LOCATION = "a3900000-0000-4390-8390-000000000002";
const ACTOR = "a3900000-0000-4390-8390-000000000003";
const BOOKING = "a3900000-0000-4390-8390-000000000010";
const QUEUE = "a3900000-0000-4390-8390-000000000011";
const TABLE_FROM = "a3900000-0000-4390-8390-000000000020";
const TABLE_TARGET = "a3900000-0000-4390-8390-000000000021";
const TABLE_STALE_TARGET = "a3900000-0000-4390-8390-000000000022";
const TABLE_CLOSE = "a3900000-0000-4390-8390-000000000023";
const TABLE_ORDER = "a3900000-0000-4390-8390-000000000024";
const SESSION_SEATING = "a3900000-0000-4390-8390-000000000030";
const SESSION_CLOSE = "a3900000-0000-4390-8390-000000000031";
const SESSION_ORDER = "a3900000-0000-4390-8390-000000000032";
const ORDER = "a3900000-0000-4390-8390-000000000040";

const ALL_ENTITLEMENTS = Object.freeze([
  "vertical.ristoairen",
  "reservations.enabled",
  "floor-seating.enabled",
  "service-operations.enabled",
  "ordering.enabled"
]);

function context(correlationId: string, permission: string): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId: ACTOR,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: "mat039-tenant-membership",
    locationMembershipId: "mat039-location-membership",
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions: [permission],
    entitlements: ALL_ENTITLEMENTS
  });
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT}','mat039','MAT039 Synthetic');

    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,is_primary,status)
    VALUES ('${LOCATION}','${TENANT}','main','MAT039 Main','Europe/Rome',true,'active');

    INSERT INTO identity.identities (id,display_name)
    VALUES ('${ACTOR}','MAT039 Concurrency Operator');

    INSERT INTO ristoairen.bookings
      (id,tenant_id,location_id,request_key,status,party_size,row_version,environment_class)
    VALUES
      ('${BOOKING}','${TENANT}','${LOCATION}','mat039-booking','PENDING',2,1,'TEST_TEMPORARY');

    INSERT INTO ristoairen.guest_queue_entries
      (id,tenant_id,location_id,request_key,booking_id,status,party_size,row_version,environment_class)
    VALUES
      ('${QUEUE}','${TENANT}','${LOCATION}','mat039-queue','${BOOKING}','WAITING',2,1,'TEST_TEMPORARY');

    INSERT INTO ristoairen.dining_tables
      (id,tenant_id,location_id,code,operational_status,capacity,row_version,environment_class)
    VALUES
      ('${TABLE_FROM}','${TENANT}','${LOCATION}','T-FROM','ACTIVE',4,1,'TEST_TEMPORARY'),
      ('${TABLE_TARGET}','${TENANT}','${LOCATION}','T-TARGET','ACTIVE',4,1,'TEST_TEMPORARY'),
      ('${TABLE_STALE_TARGET}','${TENANT}','${LOCATION}','T-STALE','ACTIVE',4,1,'TEST_TEMPORARY'),
      ('${TABLE_CLOSE}','${TENANT}','${LOCATION}','T-CLOSE','ACTIVE',4,1,'TEST_TEMPORARY'),
      ('${TABLE_ORDER}','${TENANT}','${LOCATION}','T-ORDER','ACTIVE',4,1,'TEST_TEMPORARY');

    INSERT INTO ristoairen.service_sessions
      (id,tenant_id,location_id,table_id,status,row_version,environment_class,opened_at)
    VALUES
      ('${SESSION_SEATING}','${TENANT}','${LOCATION}','${TABLE_FROM}','OPEN',1,'TEST_TEMPORARY','2026-09-14T11:00:00Z'),
      ('${SESSION_CLOSE}','${TENANT}','${LOCATION}','${TABLE_CLOSE}','OPEN',1,'TEST_TEMPORARY','2026-09-14T11:01:00Z'),
      ('${SESSION_ORDER}','${TENANT}','${LOCATION}','${TABLE_ORDER}','OPEN',1,'TEST_TEMPORARY','2026-09-14T11:02:00Z');

    INSERT INTO ristoairen.orders
      (id,tenant_id,location_id,service_session_id,request_key,channel,status,row_version,environment_class,submitted_at)
    VALUES
      ('${ORDER}','${TENANT}','${LOCATION}','${SESSION_ORDER}','mat039-order','FOH','SUBMITTED',1,'TEST_TEMPORARY','2026-09-14T11:03:00Z');
  `);
}

async function row(table: string, id: string): Promise<Record<string, unknown>> {
  const allowed = new Set(["bookings","guest_queue_entries","dining_tables","service_sessions","orders"]);
  if (!allowed.has(table)) throw new Error("Unsafe MAT039 table selector");
  const result = await pool.query(`SELECT * FROM ristoairen.${table} WHERE id=$1::uuid`, [id]);
  assert.equal(result.rowCount, 1, `${table}/${id} fixture disappeared`);
  return result.rows[0] as Record<string, unknown>;
}

async function evidenceCounts(resourceType: string, resourceId: string, eventType: string): Promise<Readonly<{ audits: number; outbox: number }>> {
  const [audits, outbox] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS count FROM audit.audit_events
        WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND resource_type=$3 AND resource_id=$4`,
      [TENANT,LOCATION,resourceType,resourceId]
    ),
    pool.query(
      `SELECT count(*)::int AS count FROM events.outbox_events
        WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND aggregate_type=$3 AND aggregate_id=$4 AND event_type=$5`,
      [TENANT,LOCATION,resourceType,resourceId,eventType]
    )
  ]);
  return Object.freeze({ audits: Number(audits.rows[0].count), outbox: Number(outbox.rows[0].count) });
}

test.after(async () => {
  await pool.end();
});

test("MAT-039 / GJ2-034 optimistic concurrency negative E2E", async (t) => {
  await seed();

  await t.test("C001 Booking: first transition wins; stale second command fails without lost update", async () => {
    const before = await row("bookings", BOOKING);
    assert.equal(before.status,"PENDING");
    assert.equal(Number(before.row_version),1);

    const first = await transitionReservation(
      context("mat039-booking-first","reservation.manage"),
      { bookingId: BOOKING, expectedRowVersion: 1, nextStatus: "CONFIRMED" },
      { unitOfWork: uow, now: () => "2026-09-14T12:00:00.000Z" }
    );
    assert.equal(first.status,"CONFIRMED");
    assert.equal(first.rowVersion,2);

    await assert.rejects(
      transitionReservation(
        context("mat039-booking-stale","reservation.manage"),
        { bookingId: BOOKING, expectedRowVersion: 1, nextStatus: "CANCELLED" },
        { unitOfWork: uow, now: () => "2026-09-14T12:00:01.000Z" }
      ),
      (error: unknown) => hasCode(error,"CONFLICT")
    );

    const final = await row("bookings", BOOKING);
    assert.equal(final.status,"CONFIRMED");
    assert.equal(Number(final.row_version),2);
    assert.deepEqual(await evidenceCounts("Booking",BOOKING,"ReservationChanged"),{ audits:1,outbox:1 });
  });

  await t.test("C001 GuestQueueEntry: first transition wins; stale second command fails without lost update", async () => {
    const before = await row("guest_queue_entries", QUEUE);
    assert.equal(before.status,"WAITING");
    assert.equal(Number(before.row_version),1);

    const first = await transitionGuestQueueEntry(
      context("mat039-queue-first","queue.manage"),
      { queueEntryId: QUEUE, expectedRowVersion: 1, nextStatus: "CALLED" },
      { unitOfWork: uow, now: () => "2026-09-14T12:01:00.000Z" }
    );
    assert.equal(first.status,"CALLED");
    assert.equal(first.rowVersion,2);

    await assert.rejects(
      transitionGuestQueueEntry(
        context("mat039-queue-stale","queue.manage"),
        { queueEntryId: QUEUE, expectedRowVersion: 1, nextStatus: "CANCELLED" },
        { unitOfWork: uow, now: () => "2026-09-14T12:01:01.000Z" }
      ),
      (error: unknown) => hasCode(error,"CONFLICT")
    );

    const final = await row("guest_queue_entries", QUEUE);
    assert.equal(final.status,"CALLED");
    assert.equal(Number(final.row_version),2);
    assert.deepEqual(await evidenceCounts("GuestQueueEntry",QUEUE,"QueueChanged"),{ audits:1,outbox:1 });
  });

  await t.test("C009 Floor/Seating: winning table move is preserved and stale move cannot double-seat or overwrite it", async () => {
    const beforeSession = await row("service_sessions", SESSION_SEATING);
    const beforeFrom = await row("dining_tables", TABLE_FROM);
    const beforeTarget = await row("dining_tables", TABLE_TARGET);
    assert.equal(Number(beforeSession.row_version),1);
    assert.equal(Number(beforeFrom.row_version),1);
    assert.equal(Number(beforeTarget.row_version),1);

    const first = await moveServiceSessionToTable(
      context("mat039-seating-first","floor.seating.operate"),
      {
        serviceSessionId: SESSION_SEATING,
        expectedSessionRowVersion: 1,
        toTableId: TABLE_TARGET,
        expectedFromTableRowVersion: 1,
        expectedToTableRowVersion: 1
      },
      { unitOfWork: uow, now: () => "2026-09-14T12:02:00.000Z" }
    );
    assert.equal(first.session.tableId,TABLE_TARGET);
    assert.equal(first.session.rowVersion,2);
    assert.equal(first.fromTable.rowVersion,2);
    assert.equal(first.toTable.rowVersion,2);

    await assert.rejects(
      moveServiceSessionToTable(
        context("mat039-seating-stale","floor.seating.operate"),
        {
          serviceSessionId: SESSION_SEATING,
          expectedSessionRowVersion: 1,
          toTableId: TABLE_STALE_TARGET,
          expectedFromTableRowVersion: 1,
          expectedToTableRowVersion: 1
        },
        { unitOfWork: uow, now: () => "2026-09-14T12:02:01.000Z" }
      ),
      (error: unknown) => hasCode(error,"CONFLICT")
    );

    const finalSession = await row("service_sessions", SESSION_SEATING);
    const staleTarget = await row("dining_tables", TABLE_STALE_TARGET);
    assert.equal(finalSession.table_id,TABLE_TARGET);
    assert.equal(Number(finalSession.row_version),2);
    assert.equal(Number(staleTarget.row_version),1);
    const openTargetCount = await pool.query(
      "SELECT count(*)::int AS count FROM ristoairen.service_sessions WHERE tenant_id=$1 AND location_id=$2 AND table_id=$3 AND status='OPEN'",
      [TENANT,LOCATION,TABLE_TARGET]
    );
    assert.equal(openTargetCount.rows[0].count,1);
    assert.deepEqual(await evidenceCounts("ServiceSession",SESSION_SEATING,"SeatingChanged"),{ audits:1,outbox:1 });
  });

  await t.test("C010 ServiceSession: first close wins; stale second command cannot rewrite terminal state", async () => {
    const before = await row("service_sessions", SESSION_CLOSE);
    assert.equal(before.status,"OPEN");
    assert.equal(Number(before.row_version),1);

    const first = await closeServiceSession(
      context("mat039-session-first","service-session.manage"),
      { serviceSessionId: SESSION_CLOSE, expectedRowVersion: 1, outcome: "CLOSED" },
      { unitOfWork: uow, now: () => "2026-09-14T12:03:00.000Z" }
    );
    assert.equal(first.status,"CLOSED");
    assert.equal(first.rowVersion,2);

    await assert.rejects(
      closeServiceSession(
        context("mat039-session-stale","service-session.manage"),
        { serviceSessionId: SESSION_CLOSE, expectedRowVersion: 1, outcome: "CANCELLED" },
        { unitOfWork: uow, now: () => "2026-09-14T12:03:01.000Z" }
      ),
      (error: unknown) => hasCode(error,"CONFLICT")
    );

    const final = await row("service_sessions", SESSION_CLOSE);
    assert.equal(final.status,"CLOSED");
    assert.equal(Number(final.row_version),2);
    assert.ok(final.closed_at);
    assert.deepEqual(await evidenceCounts("ServiceSession",SESSION_CLOSE,"ServiceSessionClosed"),{ audits:1,outbox:1 });
  });

  await t.test("C011 Order: first amendment wins; stale second command cannot silently last-write-win", async () => {
    const before = await row("orders", ORDER);
    assert.equal(before.status,"SUBMITTED");
    assert.equal(Number(before.row_version),1);

    const first = await amendOrder(
      context("mat039-order-first","order.manage"),
      { orderId: ORDER, expectedRowVersion: 1, nextStatus: "AMENDED" },
      { unitOfWork: uow, now: () => "2026-09-14T12:04:00.000Z" }
    );
    assert.equal(first.status,"AMENDED");
    assert.equal(first.rowVersion,2);

    await assert.rejects(
      amendOrder(
        context("mat039-order-stale","order.manage"),
        { orderId: ORDER, expectedRowVersion: 1, nextStatus: "CANCELLED" },
        { unitOfWork: uow, now: () => "2026-09-14T12:04:01.000Z" }
      ),
      (error: unknown) => hasCode(error,"CONFLICT")
    );

    const final = await row("orders", ORDER);
    assert.equal(final.status,"AMENDED");
    assert.equal(Number(final.row_version),2);
    assert.deepEqual(await evidenceCounts("Order",ORDER,"OrderChanged"),{ audits:1,outbox:1 });
  });

  await t.test("GJ2-034 terminal evidence records before/after versions and exactly one durable effect per winning command", async () => {
    const versions = await pool.query(
      `SELECT 'Booking' AS aggregate,row_version FROM ristoairen.bookings WHERE id=$1::uuid
       UNION ALL SELECT 'GuestQueueEntry',row_version FROM ristoairen.guest_queue_entries WHERE id=$2::uuid
       UNION ALL SELECT 'SeatingServiceSession',row_version FROM ristoairen.service_sessions WHERE id=$3::uuid
       UNION ALL SELECT 'ClosedServiceSession',row_version FROM ristoairen.service_sessions WHERE id=$4::uuid
       UNION ALL SELECT 'Order',row_version FROM ristoairen.orders WHERE id=$5::uuid
       ORDER BY aggregate`,
      [BOOKING,QUEUE,SESSION_SEATING,SESSION_CLOSE,ORDER]
    );
    assert.equal(versions.rowCount,5);
    for (const item of versions.rows) assert.equal(Number(item.row_version),2, `${item.aggregate} must advance exactly once from v1 to v2`);

    const audits = await pool.query(
      `SELECT action_key,count(*)::int AS count FROM audit.audit_events
        WHERE tenant_id=$1::uuid AND location_id=$2::uuid
          AND action_key IN ('RESERVATION_CHANGED','QUEUE_CHANGED','SEATING_CHANGED','SERVICE_SESSION_CHANGED','ORDER_CHANGED')
        GROUP BY action_key ORDER BY action_key`,
      [TENANT,LOCATION]
    );
    assert.deepEqual(audits.rows,[
      { action_key:"ORDER_CHANGED",count:1 },
      { action_key:"QUEUE_CHANGED",count:1 },
      { action_key:"RESERVATION_CHANGED",count:1 },
      { action_key:"SEATING_CHANGED",count:1 },
      { action_key:"SERVICE_SESSION_CHANGED",count:1 }
    ]);

    const outbox = await pool.query(
      `SELECT event_type,count(*)::int AS count FROM events.outbox_events
        WHERE tenant_id=$1::uuid AND location_id=$2::uuid
          AND event_type IN ('ReservationChanged','QueueChanged','SeatingChanged','ServiceSessionClosed','OrderChanged')
        GROUP BY event_type ORDER BY event_type`,
      [TENANT,LOCATION]
    );
    assert.deepEqual(outbox.rows,[
      { event_type:"OrderChanged",count:1 },
      { event_type:"QueueChanged",count:1 },
      { event_type:"ReservationChanged",count:1 },
      { event_type:"SeatingChanged",count:1 },
      { event_type:"ServiceSessionClosed",count:1 }
    ]);
  });
});
