import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { BookingApplicationService, BOOKING_ALLOWED_TRANSITIONS, BOOKING_PERMISSIONS, bookingSemanticHash, validateBookingCreate, validateBookingQuery, validateBookingUpdate, validateStatusTransition } from "../../packages/ristoairen/src/booking/index.ts";
import type { BookingMutationResultV1, BookingMutationTransaction, BookingPrivateProjectionV1, BookingUnitOfWork, IdempotencyClaim, IdempotencyScope } from "../../packages/ristoairen/src/booking/contracts.ts";

const context = (permissions: readonly string[]): SecurityContext => Object.freeze({ correlationId:"t20-contract",actorIdentityId:"actor-a",platformRoles:[],platformPermissions:[],tenantId:"tenant-a",locationId:"location-a1",tenantRole:"manager",locationRole:"manager",permissions,entitlements:[] });
const booking: BookingPrivateProjectionV1 = Object.freeze({ id:"booking-1",status:"REQUESTED",partySize:2,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",startsAt:"2026-09-01T18:00:00.000Z",expectedDurationMinutes:120,source:"T20",customerNameSnapshot:"Synthetic Guest",createdAt:"2026-08-26T00:00:00.000Z",updatedAt:"2026-08-26T00:00:00.000Z",rowVersion:1 });
class FakeTx implements BookingMutationTransaction {
  claim: IdempotencyClaim={kind:"NEW"}; current:BookingPrivateProjectionV1|null=booking; audits:unknown[]=[]; outbox:unknown[]=[]; completed:BookingMutationResultV1[]=[];
  findVisibleById=async()=>this.current; claimIdempotency=async(_s:IdempotencyScope)=>this.claim; completeIdempotency=async(_s:IdempotencyScope,r:BookingMutationResultV1)=>{this.completed.push(r)};
  insertBooking=async()=>booking; updateBooking=async()=>Object.freeze({...booking,partySize:4,rowVersion:2}); transitionBookingStatus=async(_id:string,_from:typeof booking.status,input:{requestedStatus:any})=>Object.freeze({...booking,status:input.requestedStatus,rowVersion:2});
  appendAudit=async(e:unknown)=>{this.audits.push(e)}; appendOutbox=async(e:unknown)=>{this.outbox.push(e)};
}
class FakeUow implements BookingUnitOfWork {
  readonly tx: FakeTx;
  constructor(tx = new FakeTx()){ this.tx=tx; }
  transaction=async<T>(_c:SecurityContext,fn:(tx:BookingMutationTransaction)=>Promise<T>)=>fn(this.tx);
}
function service(uow=new FakeUow()){return{uow,service:new BookingApplicationService({query:async()=>({items:[booking]}),findVisibleById:async()=>booking},uow,{assertRistoAirenAccess:()=>undefined})}}

test("T20-C01 permission keys remain least-privilege and status authority is separate",()=>assert.deepEqual(BOOKING_PERMISSIONS,{read:"booking.read",create:"booking.create",update:"booking.update",statusUpdate:"booking.status.update"}));
test("T20-C02 lifecycle freezes the eight canonical Booking states",()=>assert.deepEqual(Object.keys(BOOKING_ALLOWED_TRANSITIONS),["REQUESTED","PENDING","CONFIRMED","ARRIVED","SEATED","COMPLETED","CANCELLED","NO_SHOW"]));
test("T20-C03 REQUESTED transition set is exact",()=>assert.deepEqual(BOOKING_ALLOWED_TRANSITIONS.REQUESTED,["PENDING","CONFIRMED","CANCELLED"]));
test("T20-C04 terminal Booking states have no outgoing transitions",()=>{assert.deepEqual(BOOKING_ALLOWED_TRANSITIONS.COMPLETED,[]);assert.deepEqual(BOOKING_ALLOWED_TRANSITIONS.CANCELLED,[]);assert.deepEqual(BOOKING_ALLOWED_TRANSITIONS.NO_SHOW,[])});
test("T20-C05 query defaults limit/order deterministically",()=>assert.deepEqual(validateBookingQuery({}),{limit:50,order:"starts_at.asc"}));
test("T20-C06 query limit above 100 is rejected",()=>assert.throws(()=>validateBookingQuery({limit:101}),(e:any)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"));
test("T20-C07 inverted date range is rejected",()=>assert.throws(()=>validateBookingQuery({fromDate:"2026-09-02",toDate:"2026-09-01"}),AppError));
test("T20-C08 create validates positive party size",()=>assert.throws(()=>validateBookingCreate({source:"T20",partySize:0,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",expectedDurationMinutes:120,customerNameSnapshot:"X"}),AppError));
test("T20-C09 create validates bounded duration",()=>assert.throws(()=>validateBookingCreate({source:"T20",partySize:2,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",expectedDurationMinutes:14,customerNameSnapshot:"X"}),AppError));
test("T20-C10 update requires positive row version",()=>assert.throws(()=>validateBookingUpdate({rowVersion:0}),AppError));
test("T20-C11 invalid status transition is denied",()=>assert.throws(()=>validateStatusTransition("REQUESTED",{requestedStatus:"SEATED",rowVersion:1}),(e:any)=>e instanceof AppError&&e.code==="CONFLICT"));
test("T20-C12 semantic hash is canonical across object key order",()=>assert.equal(bookingSemanticHash({b:2,a:1}),bookingSemanticHash({a:1,b:2})));
test("T20-C13 semantic hash changes with semantic payload",()=>assert.notEqual(bookingSemanticHash({a:1}),bookingSemanticHash({a:2})));
test("T20-C14 query without booking.read is denied",async()=>{const{service:s}=service();await assert.rejects(()=>s.query(context([]),{}),(e:any)=>e instanceof AppError&&e.code==="PERMISSION_DENIED")});
test("T20-C15 create without booking.create is denied",async()=>{const{service:s}=service();await assert.rejects(()=>s.create(context([]),{source:"T20",partySize:2,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",expectedDurationMinutes:120,customerNameSnapshot:"X"},"key"),AppError)});
test("T20-C16 responsabile-like read/status permissions cannot generic-update",async()=>{const{service:s}=service();await assert.rejects(()=>s.update(context(["booking.read","booking.status.update"]),booking.id,{partySize:4,rowVersion:1},"key"),(e:any)=>e.code==="PERMISSION_DENIED")});
test("T20-C17 create writes audit and minimized outbox in same unit of work",async()=>{const{service:s,uow}=service();await s.create(context(["booking.create"]),{source:"T20",partySize:2,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",expectedDurationMinutes:120,customerNameSnapshot:"X",phoneSnapshot:"secret-phone"},"key-1");assert.equal(uow.tx.audits.length,1);assert.equal(uow.tx.outbox.length,1);assert.doesNotMatch(JSON.stringify(uow.tx.outbox),/secret-phone/)});
test("T20-C18 idempotent replay emits no duplicate audit/outbox",async()=>{const uow=new FakeUow();uow.tx.claim={kind:"REPLAY",result:{booking,replayed:false}};const{service:s}=service(uow);const r=await s.create(context(["booking.create"]),{source:"T20",partySize:2,bookingDate:"2026-09-01",bookingTimeLocal:"20:00",expectedDurationMinutes:120,customerNameSnapshot:"X"},"key-2");assert.equal(r.replayed,true);assert.equal(uow.tx.audits.length,0);assert.equal(uow.tx.outbox.length,0)});
test("T20-C19 dedicated status transition requires booking.status.update",async()=>{const{service:s}=service();await assert.rejects(()=>s.transitionStatus(context(["booking.update"]),booking.id,{requestedStatus:"CONFIRMED",rowVersion:1},"key"),(e:any)=>e.code==="PERMISSION_DENIED")});
test("T20-C20 successful status transition emits status-only minimized outbox",async()=>{const{service:s,uow}=service();const r=await s.transitionStatus(context(["booking.status.update"]),booking.id,{requestedStatus:"CONFIRMED",rowVersion:1},"key-status");assert.equal(r.booking.status,"CONFIRMED");assert.equal(uow.tx.audits.length,1);assert.equal(uow.tx.outbox.length,1);assert.doesNotMatch(JSON.stringify(uow.tx.outbox),/phone|email|notes|special/i)});
test("T20-C21 missing exact Booking is normalized to not-visible result",async()=>{const s=new BookingApplicationService({query:async()=>({items:[]}),findVisibleById:async()=>null},new FakeUow(),{assertRistoAirenAccess:()=>undefined});await assert.rejects(()=>s.get(context(["booking.read"]),"missing"),(e:any)=>e instanceof AppError&&e.code==="NOT_FOUND"&&e.message==="RESOURCE_NOT_FOUND_OR_NOT_VISIBLE")});
test("T20-C22 product access guard is mandatory before read",async()=>{const s=new BookingApplicationService({query:async()=>({items:[]}),findVisibleById:async()=>null},new FakeUow(),{assertRistoAirenAccess:()=>{throw new AppError("ENTITLEMENT_REQUIRED","no product access")}});await assert.rejects(()=>s.query(context(["booking.read"]),{}),(e:any)=>e.code==="ENTITLEMENT_REQUIRED")});
