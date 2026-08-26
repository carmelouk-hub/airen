import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { BookingApplicationService } from "../../packages/ristoairen/src/booking/index.ts";
import { createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingReadRepository, PostgresRistoBookingUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-repository.ts";
import { T20, cleanupT20BookingData, seedT20BookingTopology, securityContext } from "../helpers/t20-booking-fixtures.ts";

const connectionString=process.env.DATABASE_URL;
if(!connectionString) throw new Error("DATABASE_URL is required");
const pool=createPostgresPool(connectionString);
const reads=new PostgresRistoBookingReadRepository(pool,"t20-booking-cursor-key-000000000000000000000001");
const service=new BookingApplicationService(reads,new PostgresRistoBookingUnitOfWork(pool),{assertRistoAirenAccess:()=>undefined});
const manager=()=>securityContext({actorIdentityId:T20.managerA,tenantId:T20.tenantA,locationId:T20.locationA1,role:"manager",permissions:["booking.read","booking.create","booking.update","booking.status.update"],correlationId:`t20-runtime-${crypto.randomUUID()}`});
let bookingId="";
let rowVersion=0;

test.before(async()=>{await seedT20BookingTopology(pool);await cleanupT20BookingData(pool);});
test.after(async()=>{await cleanupT20BookingData(pool);await pool.end();});

test("T20-R01 authorized create persists a REQUESTED Booking",async()=>{
  const r=await service.create(manager(),{source:"T20",partySize:2,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",expectedDurationMinutes:120,customerNameSnapshot:"Synthetic Alpha"},"runtime-create-1");
  assert.equal(r.replayed,false); assert.equal(r.booking.status,"REQUESTED"); bookingId=r.booking.id; rowVersion=r.booking.rowVersion;
});
test("T20-R02 created Booking is TEST_TEMPORARY and scope-bound in storage",async()=>{
  const r=await pool.query("SELECT tenant_id::text,location_id::text,environment_class FROM risto_bookings WHERE id=$1",[bookingId]);
  assert.deepEqual(r.rows[0],{tenant_id:T20.tenantA,location_id:T20.locationA1,environment_class:"TEST_TEMPORARY"});
});
test("T20-R03 trusted Location timezone derives starts_at server-side",async()=>{
  const r=await service.get(manager(),bookingId); assert.equal(r.startsAt,"2026-09-01T18:00:00.000Z");
});
test("T20-R04 create retry with same key/payload returns stored result",async()=>{
  const r=await service.create(manager(),{source:"T20",partySize:2,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",expectedDurationMinutes:120,customerNameSnapshot:"Synthetic Alpha"},"runtime-create-1");
  assert.equal(r.replayed,true); assert.equal(r.booking.id,bookingId);
});
test("T20-R05 same idempotency key with semantic mismatch is rejected",async()=>{
  await assert.rejects(()=>service.create(manager(),{source:"T20",partySize:3,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",expectedDurationMinutes:120,customerNameSnapshot:"Synthetic Alpha"},"runtime-create-1"),(e:any)=>e instanceof AppError&&e.code==="IDEMPOTENCY_CONFLICT");
});
test("T20-R06 create emits exactly one audit event",async()=>{
  const r=await pool.query("SELECT count(*)::int c FROM audit.audit_events WHERE resource_id=$1 AND action_key='BOOKING_CREATED'",[bookingId]); assert.equal(r.rows[0].c,1);
});
test("T20-R07 create emits exactly one outbox event",async()=>{
  const r=await pool.query("SELECT count(*)::int c FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='booking.created.v1'",[bookingId]); assert.equal(r.rows[0].c,1);
});
test("T20-R08 outbox create payload is minimized and excludes PII fields",async()=>{
  const r=await pool.query("SELECT payload FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='booking.created.v1'",[bookingId]);
  const payload=r.rows[0].payload; assert.deepEqual(Object.keys(payload).sort(),["booking_id","party_size","starts_at","status"].sort());
});
test("T20-R09 private query returns the authorized Booking",async()=>{
  const r=await service.query(manager(),{fromDate:"2026-09-01",toDate:"2026-09-01"}); assert.ok(r.items.some(x=>x.id===bookingId));
});
test("T20-R10 update changes mutable fields and increments row_version",async()=>{
  const r=await service.update(manager(),bookingId,{partySize:4,notes:"synthetic note",rowVersion},"runtime-update-1");
  assert.equal(r.booking.partySize,4); assert.equal(r.booking.rowVersion,rowVersion+1); rowVersion=r.booking.rowVersion;
});
test("T20-R11 stale optimistic row_version is rejected",async()=>{
  await assert.rejects(()=>service.update(manager(),bookingId,{partySize:5,rowVersion:1},"runtime-update-stale"),(e:any)=>e instanceof AppError&&e.code==="CONFLICT");
});
test("T20-R12 update emits audit and minimized outbox",async()=>{
  const a=await pool.query("SELECT count(*)::int c FROM audit.audit_events WHERE resource_id=$1 AND action_key='BOOKING_UPDATED'",[bookingId]);
  const o=await pool.query("SELECT payload FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='booking.updated.v1'",[bookingId]);
  assert.equal(a.rows[0].c,1); assert.equal(o.rows.length,1); assert.equal(Object.hasOwn(o.rows[0].payload,"notes"),false);
});
test("T20-R13 valid REQUESTED to CONFIRMED transition persists",async()=>{
  const r=await service.transitionStatus(manager(),bookingId,{requestedStatus:"CONFIRMED",rowVersion},"runtime-status-1"); assert.equal(r.booking.status,"CONFIRMED"); rowVersion=r.booking.rowVersion;
});
test("T20-R14 CONFIRMED to ARRIVED records arrival timestamp",async()=>{
  const r=await service.transitionStatus(manager(),bookingId,{requestedStatus:"ARRIVED",rowVersion},"runtime-status-2"); assert.ok(r.booking.arrivalAt); rowVersion=r.booking.rowVersion;
});
test("T20-R15 ARRIVED to SEATED records seated timestamp",async()=>{
  const r=await service.transitionStatus(manager(),bookingId,{requestedStatus:"SEATED",rowVersion},"runtime-status-3"); assert.ok(r.booking.seatedAt); rowVersion=r.booking.rowVersion;
});
test("T20-R16 SEATED to COMPLETED records completed timestamp",async()=>{
  const r=await service.transitionStatus(manager(),bookingId,{requestedStatus:"COMPLETED",rowVersion},"runtime-status-4"); assert.ok(r.booking.completedAt); rowVersion=r.booking.rowVersion;
});
test("T20-R17 terminal COMPLETED cannot transition further",async()=>{
  await assert.rejects(()=>service.transitionStatus(manager(),bookingId,{requestedStatus:"CANCELLED",rowVersion},"runtime-status-invalid"),(e:any)=>e instanceof AppError&&e.code==="CONFLICT");
});
test("T20-R18 status transitions emit correlated audit/outbox records",async()=>{
  const a=await pool.query("SELECT count(*)::int c FROM audit.audit_events WHERE resource_id=$1 AND action_key='BOOKING_STATUS_CHANGED'",[bookingId]);
  const o=await pool.query("SELECT count(*)::int c FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='booking.status_changed.v1'",[bookingId]);
  assert.equal(a.rows[0].c,4); assert.equal(o.rows[0].c,4);
});
