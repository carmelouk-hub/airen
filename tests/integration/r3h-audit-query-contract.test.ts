import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type PlatformSecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { queryPlatformAudit, type PlatformAuditQueryStore, type PlatformAuditStoreInput } from "../../packages/audit-events/src/index.ts";

const admin:PlatformSecurityContext={
  scopeKind:"platform",
  correlationId:"r3h-app",
  actorIdentityId:"b8000000-0000-4000-8000-000000000001",
  platformRoles:["platform_admin"],
  platformPermissions:["platform.audit.read"]
};

test("R3-H application contract enforces platform permission, bounded windows and cursor/filter binding",async()=>{
  let captured:PlatformAuditStoreInput|undefined;
  const rows=[
    {id:"b8100000-0000-4000-8000-000000000003",tenantId:"b8200000-0000-4000-8000-000000000001",actorKind:"user",actionKey:"booking.read",correlationId:"flow-1",outcome:"success" as const,metadata:{safe:true},createdAt:"2026-08-23T10:00:00.000Z"},
    {id:"b8100000-0000-4000-8000-000000000002",tenantId:"b8200000-0000-4000-8000-000000000001",actorKind:"user",actionKey:"booking.read",correlationId:"flow-1",outcome:"success" as const,metadata:{safe:true},createdAt:"2026-08-23T09:00:00.000Z"}
  ];
  const store:PlatformAuditQueryStore={async queryPlatformAudit(input){captured=input;return rows;}};

  const page=await queryPlatformAudit({
    createdFrom:"2026-08-01T00:00:00Z",
    createdUntil:"2026-08-24T00:00:00Z",
    tenantId:"B8200000-0000-4000-8000-000000000001",
    actorKind:" USER ",
    actionKey:" BOOKING.READ ",
    limit:1
  },{context:admin,store});
  assert.equal(captured?.tenantId,"b8200000-0000-4000-8000-000000000001");
  assert.equal(captured?.actorKind,"user");
  assert.equal(captured?.actionKey,"booking.read");
  assert.equal(page.items.length,1);
  assert.ok(page.nextCursor);

  await assert.rejects(
    ()=>queryPlatformAudit({createdFrom:"2026-08-01T00:00:00Z",createdUntil:"2026-08-24T00:00:00Z",tenantId:"b8200000-0000-4000-8000-000000000001",actorKind:"user",actionKey:"different.action",cursor:page.nextCursor},{context:admin,store}),
    (e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"
  );
  await assert.rejects(
    ()=>queryPlatformAudit({createdFrom:"2026-08-01T00:00:00Z",createdUntil:"2026-08-24T00:00:00Z"},{context:{...admin,platformPermissions:[]},store}),
    (e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED"
  );
  await assert.rejects(
    ()=>queryPlatformAudit({createdFrom:"2026-08-24T00:00:00Z",createdUntil:"2026-08-01T00:00:00Z"},{context:admin,store}),
    (e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"
  );
  await assert.rejects(
    ()=>queryPlatformAudit({createdFrom:"2026-01-01T00:00:00Z",createdUntil:"2026-08-01T00:00:00Z"},{context:admin,store}),
    (e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"
  );
  await assert.rejects(
    ()=>queryPlatformAudit({createdFrom:"2026-08-01T00:00:00Z",createdUntil:"2026-08-24T00:00:00Z",locationId:"b8300000-0000-4000-8000-000000000001"},{context:admin,store}),
    (e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"
  );
  await assert.rejects(
    ()=>queryPlatformAudit({createdFrom:"2026-08-01T00:00:00Z",createdUntil:"2026-08-24T00:00:00Z",limit:101},{context:admin,store}),
    (e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"
  );
});
