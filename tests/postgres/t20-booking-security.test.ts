import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingReadRepository, PostgresRistoBookingUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-repository.ts";
import { BookingApplicationService } from "../../packages/ristoairen/src/booking/index.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { EdDsaServiceAssertionVerifier, InMemoryBookingRateLimiter, dispatchRistoBookingApiRequest } from "../../apps/api/src/ristoairen-booking-api.ts";
import { T20, cleanupT20BookingData, seedT20BookingTopology, securityContext } from "../helpers/t20-booking-fixtures.ts";

const connectionString=process.env.DATABASE_URL;
if(!connectionString) throw new Error("DATABASE_URL is required");
const pool=createPostgresPool(connectionString);
const reads=new PostgresRistoBookingReadRepository(pool,"t20-security-cursor-key-00000000000000000000001");
const domainService=new BookingApplicationService(reads,new PostgresRistoBookingUnitOfWork(pool),{assertRistoAirenAccess:()=>undefined});
let scopedBookingId="";

const managerA=()=>securityContext({actorIdentityId:T20.managerA,tenantId:T20.tenantA,locationId:T20.locationA1,role:"manager",permissions:["booking.read","booking.create","booking.update","booking.status.update"],correlationId:`t20-security-${crypto.randomUUID()}`});
const a2=()=>securityContext({actorIdentityId:T20.managerA,tenantId:T20.tenantA,locationId:T20.locationA2,role:"manager",permissions:["booking.read"],correlationId:`t20-security-a2-${crypto.randomUUID()}`});
const managerB=()=>securityContext({actorIdentityId:T20.managerB,tenantId:T20.tenantB,locationId:T20.locationB1,role:"manager",permissions:["booking.read","booking.create","booking.update","booking.status.update"],correlationId:`t20-security-b-${crypto.randomUUID()}`});

const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const now=()=>Math.floor(Date.now()/1000);
function jwt(payload:Record<string,unknown>,kid="t20-kid",key=privateKey){
  const h=Buffer.from(JSON.stringify({alg:"EdDSA",typ:"JWT",kid})).toString("base64url");
  const p=Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s=sign(null,Buffer.from(`${h}.${p}`),key).toString("base64url");
  return `${h}.${p}.${s}`;
}
const validPayload=()=>({iss:"t20-experience",sub:"ristoairen-staging",aud:"airenos-foundation",iat:now()-1,exp:now()+120,jti:crypto.randomUUID()});
const registry={resolve:async(kid:string)=>kid==="t20-kid"?{key:publicKey,enabled:true}:kid==="revoked"?{key:publicKey,enabled:false}:null};
const verifier=new EdDsaServiceAssertionVerifier(registry);

test.before(async()=>{
  await seedT20BookingTopology(pool); await cleanupT20BookingData(pool);
  const r=await domainService.create(managerA(),{source:"T20",partySize:2,bookingDate:"2026-09-02",bookingTimeLocal:"19:30",expectedDurationMinutes:90,customerNameSnapshot:"Security Fixture"},"security-fixture-create"); scopedBookingId=r.booking.id;
});
test.after(async()=>{await cleanupT20BookingData(pool);await pool.end();});

test("T20-S01 risto_bookings has RLS enabled and forced",async()=>{
  const r=await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='risto_bookings'::regclass"); assert.deepEqual(r.rows[0],{relrowsecurity:true,relforcerowsecurity:true});
});
test("T20-S02 airen_app with no trusted settings sees no Booking rows",async()=>{
  const c=await pool.connect(); try{await c.query("BEGIN");await c.query("SET LOCAL ROLE airen_app");const r=await c.query("SELECT count(*)::int c FROM risto_bookings");assert.equal(r.rows[0].c,0);await c.query("ROLLBACK");}finally{c.release();}
});
test("T20-S03 trusted A/A1 scope can read its Booking",async()=>{assert.equal((await domainService.get(managerA(),scopedBookingId)).id,scopedBookingId);});
test("T20-S04 trusted A/A2 scope cannot read A/A1 Booking",async()=>{await assert.rejects(()=>domainService.get(a2(),scopedBookingId),(e:any)=>e instanceof AppError&&e.code==="NOT_FOUND");});
test("T20-S05 trusted B/B1 scope cannot read A/A1 Booking",async()=>{await assert.rejects(()=>domainService.get(managerB(),scopedBookingId),(e:any)=>e instanceof AppError&&e.code==="NOT_FOUND");});
test("T20-S06 direct cross-Tenant insert under A/A1 RLS is rejected",async()=>{
  const c=await pool.connect();try{await c.query("BEGIN");await c.query("SET LOCAL ROLE airen_app");await c.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id','cross-tenant',true)",[T20.managerA,T20.tenantA,T20.locationA1]);
    await assert.rejects(()=>c.query(`INSERT INTO risto_bookings(tenant_id,location_id,source,party_size,booking_date,booking_time_local,starts_at,expected_duration_minutes,status,customer_name_snapshot,created_by_identity_id,updated_by_identity_id,environment_class) VALUES ($1,$2,'T20',2,'2026-09-03','20:00',now(),90,'REQUESTED','X',$3,$3,'TEST_TEMPORARY')`,[T20.tenantB,T20.locationB1,T20.managerA]),(e:any)=>e.code==="42501"); await c.query("ROLLBACK");}finally{c.release();}
});
test("T20-S07 direct cross-Location update under A/A2 cannot modify A/A1 row",async()=>{
  const c=await pool.connect();try{await c.query("BEGIN");await c.query("SET LOCAL ROLE airen_app");await c.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id','cross-location',true)",[T20.managerA,T20.tenantA,T20.locationA2]);const r=await c.query("UPDATE risto_bookings SET party_size=99 WHERE id=$1",[scopedBookingId]);assert.equal(r.rowCount,0);await c.query("ROLLBACK");}finally{c.release();}
});
test("T20-S08 foundation idempotency table also has forced RLS",async()=>{const r=await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='foundation_idempotency_keys'::regclass");assert.deepEqual(r.rows[0],{relrowsecurity:true,relforcerowsecurity:true});});
test("T20-S09 valid EdDSA service assertion verifies",async()=>{const v=await verifier.verify(jwt(validPayload()));assert.equal(v.subject,"ristoairen-staging");});
test("T20-S10 expired service assertion is denied",async()=>{await assert.rejects(()=>verifier.verify(jwt({...validPayload(),iat:now()-400,exp:now()-100})),(e:any)=>e.code==="AUTHENTICATION_REQUIRED");});
test("T20-S11 assertion TTL over 300 seconds is denied",async()=>{await assert.rejects(()=>verifier.verify(jwt({...validPayload(),iat:now(),exp:now()+301})),(e:any)=>e.code==="AUTHENTICATION_REQUIRED");});
test("T20-S12 revoked service key fails closed",async()=>{await assert.rejects(()=>verifier.verify(jwt(validPayload(),"revoked")),(e:any)=>e.code==="AUTHENTICATION_REQUIRED");});
test("T20-S13 wrong service audience is denied",async()=>{await assert.rejects(()=>verifier.verify(jwt({...validPayload(),aud:"other"})),(e:any)=>e.code==="AUTHENTICATION_REQUIRED");});
test("T20-S14 forged service assertion signature is denied",async()=>{const other=generateKeyPairSync("ed25519");await assert.rejects(()=>verifier.verify(jwt(validPayload(),"t20-kid",other.privateKey)),(e:any)=>e.code==="AUTHENTICATION_REQUIRED");});
test("T20-S15 adapter kill switch fails closed before authentication",async()=>{
  const r=await dispatchRistoBookingApiRequest({method:"GET",url:"/v1/ristoairen/bookings",hostname:"t20-a.example.test",headers:{}},{switches:{adapterEnabled:false,projectionEnabled:false,mutationEnabled:false}} as any);assert.equal(r.status,403);
});
test("T20-S16 query rate limiter allows first 120 calls and denies 121st",async()=>{const l=new InMemoryBookingRateLimiter();const x={serviceId:"s",actorIdentityId:"a",tenantId:"t",locationId:"l",kind:"query" as const};for(let i=0;i<120;i++)assert.equal((await l.consume(x)).allowed,true);assert.equal((await l.consume(x)).allowed,false);});
test("T20-S17 mutation rate limiter allows first 60 calls and denies 61st",async()=>{const l=new InMemoryBookingRateLimiter();const x={serviceId:"s2",actorIdentityId:"a",tenantId:"t",locationId:"l",kind:"mutation" as const};for(let i=0;i<60;i++)assert.equal((await l.consume(x)).allowed,true);assert.equal((await l.consume(x)).allowed,false);});
test("T20-S18 responsabile permission set excludes create and generic update",async()=>{const r=securityContext({actorIdentityId:T20.responsabileA,tenantId:T20.tenantA,locationId:T20.locationA1,role:"responsabile",permissions:["booking.read","booking.status.update"]});await assert.rejects(()=>domainService.create(r,{source:"T20",partySize:2,bookingDate:"2026-09-03",bookingTimeLocal:"20:00",expectedDurationMinutes:90,customerNameSnapshot:"X"},"denied"),(e:any)=>e.code==="PERMISSION_DENIED");await assert.rejects(()=>domainService.update(r,scopedBookingId,{partySize:3,rowVersion:1},"denied2"),(e:any)=>e.code==="PERMISSION_DENIED");});
test("T20-S19 generic update path cannot mutate status because status is not part of input contract/runtime SQL",async()=>{const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../../packages/persistence-postgres/src/risto-booking-repository.ts",import.meta.url),"utf8"));const updateBlock=source.slice(source.indexOf("async updateBooking"),source.indexOf("async transitionBookingStatus"));assert.doesNotMatch(updateBlock,/SET\s+status\s*=/i);});
test("T20-S20 private projection has no tenant_id/location_id fields",async()=>{const b=await domainService.get(managerA(),scopedBookingId);assert.equal(Object.hasOwn(b,"tenantId"),false);assert.equal(Object.hasOwn(b,"locationId"),false);assert.equal(Object.hasOwn(b,"tenant_id"),false);assert.equal(Object.hasOwn(b,"location_id"),false);});
test("T20-S21 audit/outbox payloads do not contain phone/email/notes/special requests",async()=>{const r=await pool.query("SELECT payload::text p FROM events.outbox_events WHERE tenant_id=$1 UNION ALL SELECT metadata::text FROM audit.audit_events WHERE tenant_id=$1",[T20.tenantA]);for(const row of r.rows)assert.doesNotMatch(row.p,/phone_snapshot|email_snapshot|special_requests|secret|token/i);});
