import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type PlatformSecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { createPlan, createSubscription, cancelSubscription, type BillingLifecycleUnitOfWork, type BillingLifecycleTransaction } from "../../packages/billing/src/index.ts";

const ACTOR = "aaaaaaaa-1111-4111-8111-111111111111";
const TENANT = "bbbbbbbb-1111-4111-8111-111111111111";
const PLAN = "cccccccc-1111-4111-8111-111111111111";
const SUB = "dddddddd-1111-4111-8111-111111111111";
const context = (permissions: string[]): PlatformSecurityContext => ({scopeKind:"platform",correlationId:"r3e-contract",actorIdentityId:ACTOR,platformRoles:["platform_admin"],platformPermissions:permissions});

const neverUow: BillingLifecycleUnitOfWork = { async transaction() { throw new Error("UOW_SHOULD_NOT_RUN"); } };

test("R3-E application contract rejects missing platform permission before persistence",async()=>{
  await assert.rejects(
    ()=>createPlan({idempotencyKey:"r3e-plan-contract-v1",slug:"starter",name:"Starter",currency:"eur",priceMinor:1000,billingPeriod:"monthly"},{context:context([]),unitOfWork:neverUow}),
    (e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED"
  );
});

test("R3-E application contract validates billing inputs before persistence",async()=>{
  await assert.rejects(
    ()=>createPlan({idempotencyKey:"r3e-plan-contract-v2",slug:"Bad Slug",name:"Starter",currency:"EUR",priceMinor:1000,billingPeriod:"monthly"},{context:context(["platform.plans.create"]),unitOfWork:neverUow}),
    (e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"
  );
  await assert.rejects(
    ()=>createSubscription({idempotencyKey:"r3e-sub-contract-v1",tenantId:TENANT,planId:PLAN,startsAt:"2026-08-23T00:00:00Z",currentPeriodEnd:"2026-08-22T00:00:00Z"},{context:context(["platform.subscriptions.create"]),unitOfWork:neverUow}),
    (e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"
  );
  await assert.rejects(
    ()=>cancelSubscription({idempotencyKey:"r3e-cancel-contract-v1",subscriptionId:SUB,mode:"immediate",reasonCode:"X"},{context:context(["platform.subscriptions.cancel"]),unitOfWork:neverUow}),
    (e:unknown)=>e instanceof AppError&&e.code==="VALIDATION_FAILED"
  );
});

test("R3-E create Plan normalizes commercial inputs before transaction",async()=>{
  let captured: Record<string,unknown> | undefined;
  const uow: BillingLifecycleUnitOfWork = {
    async transaction<T>(fn: (tx: BillingLifecycleTransaction)=>Promise<T>) {
      const tx: BillingLifecycleTransaction = {
        async mutatePlan(input) {
          captured = input;
          return {action:"create",replayed:false,plan:{id:PLAN,slug:String(input.slug),name:String(input.name),status:"draft",currency:String(input.currency),priceMinor:Number(input.priceMinor),billingPeriod:input.billingPeriod!,defaultTrialDays:Number(input.defaultTrialDays),createdAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString()}};
        },
        async createSubscription(){ throw new Error("unexpected"); },
        async mutateSubscription(){ throw new Error("unexpected"); }
      };
      return fn(tx);
    }
  };
  const result = await createPlan({idempotencyKey:"r3e-plan-contract-v3",slug:"  Pro-Annual  ",name:"  Pro Annual  ",currency:"eur",priceMinor:120000,billingPeriod:"annual",defaultTrialDays:14},{context:context(["platform.plans.create"]),unitOfWork:uow});
  assert.equal(result.plan.slug,"pro-annual");
  assert.equal(captured?.currency,"EUR");
  assert.equal(captured?.name,"Pro Annual");
  assert.equal(captured?.defaultTrialDays,14);
});
