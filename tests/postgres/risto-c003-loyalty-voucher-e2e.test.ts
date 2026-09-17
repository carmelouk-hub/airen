import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { LoyaltyVoucherApplicationService } from "../../packages/ristoairen/src/loyalty-voucher/application-service.ts";
import { LOYALTY_VOUCHER_PERMISSIONS } from "../../packages/ristoairen/src/loyalty-voucher/contracts.ts";
import { PostgresRistoLoyaltyVoucherRepository } from "../../packages/persistence-postgres/src/risto-loyalty-voucher.ts";
import { dispatchPublicLoyaltyVoucherApiRequest } from "../../apps/api/src/public-loyalty-voucher-api.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString:DATABASE_URL, max:8 });

const TENANT = "c0031000-0000-4000-8000-000000000001";
const LOCATION = "c0031000-0000-4000-8000-000000000002";
const OTHER_TENANT = "c0032000-0000-4000-8000-000000000001";
const OTHER_LOCATION = "c0032000-0000-4000-8000-000000000002";
const PASS = "c0031000-0000-4000-8000-000000000003";
const OTHER_PASS = "c0032000-0000-4000-8000-000000000003";
const ACTOR = "c0031000-0000-4000-8000-000000000004";
const CREDENTIAL = Buffer.alloc(32,0x51).toString("base64url");
const WRONG_CREDENTIAL = Buffer.alloc(32,0x52).toString("base64url");
const hash = (value:string) => createHash("sha256").update(Buffer.from(value,"base64url")).digest("hex");

const resolver = Object.freeze({
  async resolveFromHostname(hostname:string) {
    if (hostname === "c003.example.test") return Object.freeze({ tenantId:TENANT,locationId:LOCATION,hostname,canonicalOrigin:`https://${hostname}` });
    if (hostname === "other.example.test") return Object.freeze({ tenantId:OTHER_TENANT,locationId:OTHER_LOCATION,hostname,canonicalOrigin:`https://${hostname}` });
    return null;
  }
});
const repository = new PostgresRistoLoyaltyVoucherRepository(pool);
const service = new LoyaltyVoucherApplicationService(Object.freeze({ tenantResolver:resolver, repository }));

function context(permissions: readonly string[]): SecurityContext {
  return Object.freeze({
    correlationId:"c003-internal",
    actorIdentityId:ACTOR,
    platformRoles:[],platformPermissions:[],tenantId:TENANT,locationId:LOCATION,
    permissions,entitlements:[],
  });
}
function hasCode(code:string) { return (error:unknown) => Boolean(error && typeof error === "object" && "code" in error && (error as {code?:string}).code === code); }

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name) VALUES
      ('${TENANT}','mat041-c003','MAT041 C003 Synthetic'),
      ('${OTHER_TENANT}','mat041-c003-other','MAT041 C003 Other');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone,is_primary,status) VALUES
      ('${LOCATION}','${TENANT}','main','C003 Main','Europe/Rome',true,'active'),
      ('${OTHER_LOCATION}','${OTHER_TENANT}','main','C003 Other','Europe/Rome',true,'active');
    INSERT INTO ristoairen.customer_passes (id,tenant_id,location_id,credential_hash,status) VALUES
      ('${PASS}','${TENANT}','${LOCATION}','${hash(CREDENTIAL)}','ACTIVE'),
      ('${OTHER_PASS}','${OTHER_TENANT}','${OTHER_LOCATION}','${hash(CREDENTIAL)}','ACTIVE');
  `);
}

test.after(async () => { await pool.end(); });

test("RISTO-MAT-041 C003 governs Loyalty/Voucher value and exposes own projection only", async (t) => {
  await seed();

  await t.test("privileged value mutations require real caller permissions and do not depend on AIRenOS entitlement", async () => {
    await assert.rejects(service.earn(context([]), { customerPassId:PASS, points:100, reason:"visit" }, "earn-denied"), hasCode("PERMISSION_DENIED"));
    const loyaltyContext = context([LOYALTY_VOUCHER_PERMISSIONS.loyaltyMutate]);
    const earned = await service.earn(loyaltyContext,{ customerPassId:PASS,points:100,reason:"visit" },"earn-1");
    assert.deepEqual(earned,{ replayed:false,loyaltyPoints:100 });
    const replay = await service.earn(loyaltyContext,{ customerPassId:PASS,points:100,reason:"visit" },"earn-1");
    assert.deepEqual(replay,{ replayed:true,loyaltyPoints:100 });
    await assert.rejects(service.earn(loyaltyContext,{ customerPassId:PASS,points:101,reason:"visit" },"earn-1"),hasCode("IDEMPOTENCY_CONFLICT"));
    await assert.rejects(service.redeem(loyaltyContext,{ customerPassId:PASS,points:101,reason:"overspend" },"redeem-too-much"),hasCode("CONFLICT"));
    const redeemed = await service.redeem(loyaltyContext,{ customerPassId:PASS,points:40,reason:"reward" },"redeem-1");
    assert.equal(redeemed.loyaltyPoints,60);
  });

  await t.test("Voucher issue/redeem is append-only, permissioned and idempotent", async () => {
    const voucherContext = context([LOYALTY_VOUCHER_PERMISSIONS.voucherMutate]);
    await assert.rejects(service.issueVoucher(context([]),{ customerPassId:PASS,publicReference:"WELCOME10",label:"Welcome",currency:"EUR",valueMinor:1000,reason:"welcome" },"voucher-denied"),hasCode("PERMISSION_DENIED"));
    const issued = await service.issueVoucher(voucherContext,{ customerPassId:PASS,publicReference:"WELCOME10",label:"Welcome",currency:"EUR",valueMinor:1000,reason:"welcome" },"voucher-issue-1");
    assert.equal(issued.replayed,false);
    assert.equal((await service.issueVoucher(voucherContext,{ customerPassId:PASS,publicReference:"WELCOME10",label:"Welcome",currency:"EUR",valueMinor:1000,reason:"welcome" },"voucher-issue-1")).replayed,true);
    await service.redeemVoucher(voucherContext,{ publicReference:"WELCOME10",valueMinor:250,reason:"bill" },"voucher-redeem-1");
    await assert.rejects(service.redeemVoucher(voucherContext,{ publicReference:"WELCOME10",valueMinor:751,reason:"overspend" },"voucher-redeem-too-much"),hasCode("CONFLICT"));

    const ledger = await pool.query("SELECT entry_kind,value_delta_minor FROM ristoairen.voucher_ledger WHERE tenant_id=$1 AND location_id=$2 ORDER BY created_at,id",[TENANT,LOCATION]);
    assert.deepEqual(ledger.rows.map((row)=>[row.entry_kind,row.value_delta_minor]),[["ISSUE",1000],["REDEEM",-250]]);
    const updatePrivileges = await pool.query<{ can_update:boolean }>("SELECT has_table_privilege('airen_app','ristoairen.loyalty_ledger','UPDATE') OR has_table_privilege('airen_app','ristoairen.voucher_ledger','UPDATE') AS can_update");
    assert.equal(updatePrivileges.rows[0].can_update,false);
  });

  await t.test("public credential reads only its own minimal projection", async () => {
    const response = await dispatchPublicLoyaltyVoucherApiRequest({ method:"GET",url:"/api/public/v1/self-service/loyalty-voucher",headers:{ host:"c003.example.test","x-self-service-credential":CREDENTIAL,"x-correlation-id":"public-read" } },service);
    assert.equal(response.status,200);
    assert.equal(response.body.loyaltyPoints,60);
    assert.equal(Array.isArray(response.body.vouchers),true);
    const voucher = (response.body.vouchers as Array<Record<string,unknown>>)[0];
    assert.deepEqual(Object.keys(voucher).sort(),["currency","issuedValueMinor","label","redeemedValueMinor","reference","remainingValueMinor","status"].sort());
    assert.equal(voucher.remainingValueMinor,750);
    assert.equal("tenantId" in response.body,false);
    assert.equal("locationId" in response.body,false);
    assert.equal("id" in voucher,false);
    assert.equal("actorIdentityId" in voucher,false);
  });

  await t.test("wrong credential, cross-host use, public list and raw UUID probing fail closed", async () => {
    const wrong = await dispatchPublicLoyaltyVoucherApiRequest({ method:"GET",url:"/api/public/v1/self-service/loyalty-voucher",headers:{ host:"c003.example.test","x-self-service-credential":WRONG_CREDENTIAL } },service);
    assert.equal(wrong.status,404);

    const crossHost = await dispatchPublicLoyaltyVoucherApiRequest({ method:"GET",url:"/api/public/v1/self-service/loyalty-voucher",headers:{ host:"other.example.test","x-self-service-credential":WRONG_CREDENTIAL } },service);
    assert.equal(crossHost.status,404);

    const raw = await dispatchPublicLoyaltyVoucherApiRequest({ method:"GET",url:`/api/public/v1/self-service/loyalty-voucher/${PASS}`,headers:{ host:"c003.example.test","x-self-service-credential":CREDENTIAL } },service);
    assert.equal(raw.status,404);
    const list = await dispatchPublicLoyaltyVoucherApiRequest({ method:"GET",url:"/api/public/v1/self-service/loyalty-voucher/list",headers:{ host:"c003.example.test","x-self-service-credential":CREDENTIAL } },service);
    assert.equal(list.status,404);
  });

  await t.test("raw credential is never persisted", async () => {
    const dump = await pool.query<{ credential_hash:string }>("SELECT credential_hash FROM ristoairen.customer_passes WHERE tenant_id=$1",[TENANT]);
    assert.equal(dump.rows[0].credential_hash,hash(CREDENTIAL));
    assert.equal(dump.rows[0].credential_hash.includes(CREDENTIAL),false);
  });
});
