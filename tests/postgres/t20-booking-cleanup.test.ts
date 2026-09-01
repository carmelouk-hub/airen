import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingReadRepository, PostgresRistoBookingUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-repository.ts";
import { BookingApplicationService } from "../../packages/booking-core/src/index.ts";
import { T20, cleanupT20BookingData, seedT20BookingTopology, securityContext } from "../helpers/t20-booking-fixtures.ts";

const connectionString=process.env.DATABASE_URL;
if(!connectionString) throw new Error("DATABASE_URL is required");
const pool=createPostgresPool(connectionString);
const service=new BookingApplicationService(
  new PostgresRistoBookingReadRepository(pool,"t20-cleanup-cursor-key-000000000000000000000001"),
  new PostgresRistoBookingUnitOfWork(pool),
  {assertBookingAccess:()=>undefined}
);
const context=()=>securityContext({actorIdentityId:T20.managerA,tenantId:T20.tenantA,locationId:T20.locationA1,role:"manager",permissions:["booking.read","booking.create","booking.update","booking.status.update"],correlationId:`t20-cleanup-${crypto.randomUUID()}`});

test.before(async()=>{
  await seedT20BookingTopology(pool); await cleanupT20BookingData(pool);
  await service.create(context(),{source:"T20",partySize:2,bookingDate:"2026-09-04",bookingTimeLocal:"20:00",expectedDurationMinutes:90,customerNameSnapshot:"Cleanup Fixture"},"cleanup-create");
  await cleanupT20BookingData(pool);
});
test.after(async()=>{await cleanupT20BookingData(pool);await pool.end();});

test("T20-X01 cleanup leaves zero T20 Booking rows",async()=>{const r=await pool.query("SELECT count(*)::int c FROM risto_bookings WHERE tenant_id IN ($1,$2)",[T20.tenantA,T20.tenantB]);assert.equal(r.rows[0].c,0);});
test("T20-X02 cleanup leaves zero T20 idempotency rows",async()=>{const r=await pool.query("SELECT count(*)::int c FROM foundation_idempotency_keys WHERE tenant_id IN ($1,$2)",[T20.tenantA,T20.tenantB]);assert.equal(r.rows[0].c,0);});
test("T20-X03 cleanup leaves zero T20 Booking outbox residue",async()=>{const r=await pool.query("SELECT count(*)::int c FROM events.outbox_events WHERE tenant_id IN ($1,$2) AND event_type LIKE 'booking.%'",[T20.tenantA,T20.tenantB]);assert.equal(r.rows[0].c,0);});
test("T20-X04 cleanup leaves zero T20 Booking audit residue",async()=>{const r=await pool.query("SELECT count(*)::int c FROM audit.audit_events WHERE tenant_id IN ($1,$2) AND action_key LIKE 'BOOKING_%'",[T20.tenantA,T20.tenantB]);assert.equal(r.rows[0].c,0);});
test("T20-X05 fixture topology remains non-production and isolated from Corte",async()=>{const r=await pool.query("SELECT slug,name FROM platform.tenants WHERE id IN ($1,$2) ORDER BY id",[T20.tenantA,T20.tenantB]);assert.deepEqual(r.rows.map(x=>x.slug),["t20-a","t20-b"]);assert.equal(r.rows.some(x=>/corte/i.test(x.slug)||/corte/i.test(x.name)),false);});
