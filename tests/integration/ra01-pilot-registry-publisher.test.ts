import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import {
  createPilotAttachmentProjectionPublisher,
  PILOT_ATTACHMENT_REGISTRY_PATH,
  PILOT_FOUNDATION_CREDENTIAL_HEADER,
} from "../../apps/api/src/ra01-pilot-registry-publisher.ts";

const projection = Object.freeze({
  handoffId:"a1430000-0000-4000-8000-000000000001",
  actorIdentityId:"a1430000-0000-4000-8000-000000000002",
  organizationId:"a1430000-0000-4000-8000-000000000003",
  tenantId:"a1430000-0000-4000-8000-000000000004",
  locationId:"a1430000-0000-4000-8000-000000000005",
  subscriptionId:"a1430000-0000-4000-8000-000000000006",
  productCode:"ristoairen" as const,
  entitlementKey:"vertical.ristoairen" as const,
  permissionKey:"ristoairen.access" as const,
  issuedAtIso:"2026-09-19T10:00:00.000Z",
  consumedAtIso:"2026-09-19T10:00:10.000Z",
  projectionExpiresAtIso:"2026-09-19T10:01:10.000Z",
  sourceCorrelationId:"gate143-source-correlation",
});

function env(overrides:Record<string,string|undefined>={}) {
  return {
    AIRENOS_PILOT_ATTACHMENT_REGISTRY_URL:`https://pilot.example.test${PILOT_ATTACHMENT_REGISTRY_PATH}`,
    AIRENOS_FOUNDATION_REGISTRY_SERVICE_CREDENTIAL:"opaque-foundation-test-credential",
    ...overrides,
  };
}

test("publisher sends only corrected AIRenOS authority projection to Pilot registry", async () => {
  const calls:Array<{url:string;options:RequestInit}>=[];
  const publisher=createPilotAttachmentProjectionPublisher({
    environment:env(),
    entitlements:{
      async resolveCurrentTenantEntitlements(context){
        assert.equal(context.actorIdentityId,projection.actorIdentityId);
        assert.equal(context.tenantId,projection.tenantId);
        assert.equal(context.locationId,projection.locationId);
        return [
          {entitlementKey:"vertical.ristoairen",config:{}},
          {entitlementKey:"availability.enabled",config:{}},
        ];
      },
    },
    fetchImpl:async (url,options)=>{
      calls.push({url:String(url),options:options ?? {}});
      return new Response(JSON.stringify({ok:true,state:"REGISTERED"}),{status:201,headers:{"content-type":"application/json"}});
    },
  });

  await publisher.publish(projection);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,`https://pilot.example.test${PILOT_ATTACHMENT_REGISTRY_PATH}`);
  const headers=calls[0].options.headers as Record<string,string>;
  assert.equal(headers[PILOT_FOUNDATION_CREDENTIAL_HEADER],"opaque-foundation-test-credential");
  assert.equal(headers.authorization,undefined);
  const body=JSON.parse(String(calls[0].options.body));
  assert.equal(body.sourceCorrelationId,projection.sourceCorrelationId);
  assert.equal(body.subjectId,projection.actorIdentityId);
  assert.equal(body.actorId,projection.actorIdentityId);
  assert.equal(body.tenantId,projection.tenantId);
  assert.equal(body.locationId,projection.locationId);
  assert.equal(body.attachmentPermissionKey,"ristoairen.access");
  assert.deepEqual(body.platformPermissions,[]);
  assert.deepEqual(body.entitlements,["vertical.ristoairen","availability.enabled"]);
  assert.equal(JSON.stringify(body).includes("availability.read"),false);
  assert.equal(JSON.stringify(body).includes("launchCode"),false);
});

test("publisher fails closed unless both effective AIRenOS entitlements are present", async () => {
  let calls=0;
  const publisher=createPilotAttachmentProjectionPublisher({
    environment:env(),
    entitlements:{
      async resolveCurrentTenantEntitlements(){
        return [{entitlementKey:"vertical.ristoairen",config:{}}];
      },
    },
    fetchImpl:async ()=>{
      calls+=1;
      return new Response("{}",{status:201});
    },
  });
  await assert.rejects(
    ()=>publisher.publish(projection),
    (error:unknown)=>error instanceof AppError && error.code==="ENTITLEMENT_REQUIRED"
  );
  assert.equal(calls,0);
});

test("publisher rejects non-HTTPS, credential-bearing or wrong-path Pilot registry URLs", () => {
  const entitlements={async resolveCurrentTenantEntitlements(){return [];}};
  for(const value of [
    `http://pilot.example.test${PILOT_ATTACHMENT_REGISTRY_PATH}`,
    `https://user:pass@pilot.example.test${PILOT_ATTACHMENT_REGISTRY_PATH}`,
    "https://pilot.example.test/wrong",
  ]) {
    assert.throws(
      ()=>createPilotAttachmentProjectionPublisher({environment:env({AIRENOS_PILOT_ATTACHMENT_REGISTRY_URL:value}),entitlements}),
      (error:unknown)=>error instanceof AppError && error.code==="RUNTIME_CONFIGURATION_INVALID"
    );
  }
});

test("publisher sanitizes network and Pilot rejection failures", async () => {
  const entitlements={
    async resolveCurrentTenantEntitlements(){
      return [
        {entitlementKey:"vertical.ristoairen",config:{}},
        {entitlementKey:"availability.enabled",config:{}},
      ];
    },
  };
  const network=createPilotAttachmentProjectionPublisher({
    environment:env(),entitlements,
    fetchImpl:async ()=>{throw new Error("sensitive downstream detail");},
  });
  await assert.rejects(
    ()=>network.publish(projection),
    (error:unknown)=>error instanceof AppError && error.code==="INTERNAL_ERROR" && !error.message.includes("sensitive")
  );

  const denied=createPilotAttachmentProjectionPublisher({
    environment:env(),entitlements,
    fetchImpl:async ()=>new Response(JSON.stringify({ok:false,detail:"secret"}),{status:403,headers:{"content-type":"application/json"}}),
  });
  await assert.rejects(
    ()=>denied.publish(projection),
    (error:unknown)=>error instanceof AppError && error.code==="INTERNAL_ERROR" && !error.message.includes("secret")
  );
});
