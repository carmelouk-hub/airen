import { requirePermission } from "../../../authorization/src/index.ts";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";

export const RISTOAIREN_ENTITLEMENT = "vertical.ristoairen";
export const GOLDEN_DINNER_ENVIRONMENT = "TEST_TEMPORARY" as const;

export const GOLDEN_DINNER_STEPS = [
  "PARTY_RECORDED",
  "DEMAND_ACCEPTED",
  "PARTY_SEATED",
  "SERVICE_SESSION_OPENED",
  "ORDER_SUBMITTED",
  "KITCHEN_READY",
  "BAR_READY",
  "ORDER_SERVED",
  "PAYMENT_RECORDED",
  "SERVICE_SESSION_CLOSED",
  "MANAGER_REVIEWED",
  "STELLA_PROPOSAL_CREATED"
] as const;

export type GoldenDinnerStep = typeof GOLDEN_DINNER_STEPS[number];
export type GoldenDinnerArrivalMode = "BOOKING" | "QUEUE";
export type GoldenDinnerActor = "GUEST" | "FOH" | "KITCHEN" | "BAR" | "CASHIER" | "MANAGER" | "STELLA";

export const GOLDEN_DINNER_PERMISSION_BY_STEP: Readonly<Record<GoldenDinnerStep, string>> = Object.freeze({
  PARTY_RECORDED: "guest.party.upsert",
  DEMAND_ACCEPTED: "reservation.create",
  PARTY_SEATED: "floor.seat",
  SERVICE_SESSION_OPENED: "service.session.open",
  ORDER_SUBMITTED: "order.submit",
  KITCHEN_READY: "production.ticket.progress",
  BAR_READY: "production.ticket.progress",
  ORDER_SERVED: "service.serve",
  PAYMENT_RECORDED: "pos.payment.record",
  SERVICE_SESSION_CLOSED: "service.session.close",
  MANAGER_REVIEWED: "operations.review",
  STELLA_PROPOSAL_CREATED: "intelligence.proposal.create"
});

export const GOLDEN_DINNER_ACTOR_BY_STEP: Readonly<Record<GoldenDinnerStep, GoldenDinnerActor>> = Object.freeze({
  PARTY_RECORDED: "GUEST",
  DEMAND_ACCEPTED: "GUEST",
  PARTY_SEATED: "FOH",
  SERVICE_SESSION_OPENED: "FOH",
  ORDER_SUBMITTED: "FOH",
  KITCHEN_READY: "KITCHEN",
  BAR_READY: "BAR",
  ORDER_SERVED: "FOH",
  PAYMENT_RECORDED: "CASHIER",
  SERVICE_SESSION_CLOSED: "FOH",
  MANAGER_REVIEWED: "MANAGER",
  STELLA_PROPOSAL_CREATED: "STELLA"
});

export type GoldenDinnerContextSet = Readonly<Record<GoldenDinnerActor, SecurityContext>>;

export type GoldenDinnerInput = Readonly<{
  journeyId: string;
  arrivalMode: GoldenDinnerArrivalMode;
  partySize: number;
  guestCredentialReference: string;
  tableId: string;
  menuVersionId: string;
  kitchenItemId: string;
  barItemId: string;
  totalAmount: string;
  currency: string;
  idempotencyKey: string;
}>;

export type GoldenDinnerStageResult = Readonly<{
  step: GoldenDinnerStep;
  resourceType: string;
  resourceId: string;
  eventType: string;
  sequence: number;
  occurredAt: string;
  actorIdentityId: string;
}>;

export type GoldenDinnerSnapshot = Readonly<{
  journeyId: string;
  tenantId: string;
  locationId: string;
  correlationId: string;
  environmentClass: typeof GOLDEN_DINNER_ENVIRONMENT;
  partyId: string;
  demandReferenceId: string;
  serviceSessionId: string;
  orderId: string;
  kitchenTicketId: string;
  barTicketId: string;
  paymentId: string;
  managerReviewId: string;
  proposalId: string;
  proposalStatus: "PENDING_APPROVAL";
  timeline: readonly GoldenDinnerStageResult[];
}>;

type Scope = Readonly<{ journeyId: string; tenantId: string; locationId: string; correlationId: string; idempotencyKey: string }>;

export interface GoldenDinnerServices {
  party: Readonly<{ record(context: SecurityContext, input: Scope & Readonly<{ partySize: number; guestCredentialReference: string }>): Promise<GoldenDinnerStageResult & Readonly<{ partyId: string }>> }>;
  demand: Readonly<{ accept(context: SecurityContext, input: Scope & Readonly<{ arrivalMode: GoldenDinnerArrivalMode; partyId: string; partySize: number; guestCredentialReference: string }>): Promise<GoldenDinnerStageResult & Readonly<{ demandReferenceId: string }>> }>;
  seating: Readonly<{ seat(context: SecurityContext, input: Scope & Readonly<{ partyId: string; demandReferenceId: string; tableId: string }>): Promise<GoldenDinnerStageResult> }>;
  session: Readonly<{
    open(context: SecurityContext, input: Scope & Readonly<{ partyId: string; tableId: string }>): Promise<GoldenDinnerStageResult & Readonly<{ serviceSessionId: string }>>;
    close(context: SecurityContext, input: Scope & Readonly<{ serviceSessionId: string; orderId: string; paymentId: string }>): Promise<GoldenDinnerStageResult>;
  }>;
  order: Readonly<{ submit(context: SecurityContext, input: Scope & Readonly<{ serviceSessionId: string; menuVersionId: string; kitchenItemId: string; barItemId: string; totalAmount: string; currency: string }>): Promise<GoldenDinnerStageResult & Readonly<{ orderId: string; kitchenTicketId: string; barTicketId: string }>> }>;
  production: Readonly<{ ready(context: SecurityContext, input: Scope & Readonly<{ orderId: string; ticketId: string; station: "KITCHEN" | "BAR" }>): Promise<GoldenDinnerStageResult> }>;
  service: Readonly<{ serve(context: SecurityContext, input: Scope & Readonly<{ orderId: string; kitchenTicketId: string; barTicketId: string }>): Promise<GoldenDinnerStageResult> }>;
  settlement: Readonly<{ settle(context: SecurityContext, input: Scope & Readonly<{ orderId: string; amount: string; currency: string }>): Promise<GoldenDinnerStageResult & Readonly<{ paymentId: string }>> }>;
  review: Readonly<{ record(context: SecurityContext, input: Scope & Readonly<{ serviceSessionId: string; orderId: string; paymentId: string }>): Promise<GoldenDinnerStageResult & Readonly<{ managerReviewId: string }>> }>;
  stella: Readonly<{ propose(context: SecurityContext, input: Scope & Readonly<{ serviceSessionId: string; orderId: string; managerReviewId: string }>): Promise<GoldenDinnerStageResult & Readonly<{ proposalId: string; proposalStatus: "PENDING_APPROVAL" }>> }>;
}

export type GoldenDinnerDependencies = Readonly<{
  services: GoldenDinnerServices;
  now?: () => string;
}>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validation(message: string): never { throw new AppError("VALIDATION_FAILED", message); }
function conflict(message: string): never { throw new AppError("CONFLICT", message); }
function uuid(value: string, field: string): string { const normalized=value?.trim(); if(!UUID_RE.test(normalized)) validation(`${field} is invalid`); return normalized.toLowerCase(); }
function text(value: string, field: string, max: number): string { const normalized=value?.trim(); if(!normalized||normalized.length>max) validation(`${field} is invalid`); return normalized; }
function money(value: string): string { const normalized=value?.trim(); if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(normalized)||Number(normalized)<=0) validation("totalAmount is invalid"); return normalized; }
function currency(value: string): string { const normalized=value?.trim().toUpperCase(); if(!/^[A-Z]{3}$/.test(normalized)) validation("currency is invalid"); return normalized; }

function commonScope(context: SecurityContext, input: Readonly<{ journeyId: string; idempotencyKey: string }>): Scope {
  return Object.freeze({
    journeyId: input.journeyId,
    tenantId: context.tenantId,
    locationId: context.locationId,
    correlationId: context.correlationId,
    idempotencyKey: input.idempotencyKey
  });
}

function assertContextSet(contexts: GoldenDinnerContextSet): Readonly<{ tenantId: string; locationId: string; correlationId: string }> {
  const anchor=contexts.GUEST;
  if(!anchor) validation("GUEST context is required");
  for(const actor of ["GUEST","FOH","KITCHEN","BAR","CASHIER","MANAGER","STELLA"] as const){
    const context=contexts[actor];
    if(!context) validation(`${actor} context is required`);
    if(context.tenantId!==anchor.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", `${actor} context tenant mismatch`);
    if(context.locationId!==anchor.locationId) throw new AppError("LOCATION_SCOPE_VIOLATION", `${actor} context location mismatch`);
    if(context.correlationId!==anchor.correlationId) conflict(`${actor} context correlation mismatch`);
  }
  if(!contexts.STELLA.platformRoles.includes("AI_STELLA")) throw new AppError("PERMISSION_DENIED", "STELLA context must be the AI_STELLA service actor");
  for(const actor of ["GUEST","FOH","KITCHEN","BAR","CASHIER","MANAGER"] as const){
    if(contexts[actor].platformRoles.includes("AI_STELLA")) throw new AppError("PERMISSION_DENIED", `${actor} step cannot use AI_STELLA authority`);
  }
  return Object.freeze({tenantId:anchor.tenantId,locationId:anchor.locationId,correlationId:anchor.correlationId});
}

/** Each call is intentionally repeated at the individual service boundary. */
export function authorizeGoldenDinnerStep(context: SecurityContext, step: GoldenDinnerStep): void {
  if(!context.entitlements.includes(RISTOAIREN_ENTITLEMENT)) throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${RISTOAIREN_ENTITLEMENT}`);
  if(!context.tenantMembershipId&&!context.platformPermissions.includes("platform.override_tenant_scope")) throw new AppError("MEMBERSHIP_REQUIRED", "Active Tenant membership is required for Golden Dinner runtime");
  if(!context.locationMembershipId&&!context.permissions.includes("tenant.location.all")&&!context.platformPermissions.includes("platform.override_tenant_scope")) throw new AppError("LOCATION_MEMBERSHIP_REQUIRED", "Authorized Location scope is required for Golden Dinner runtime");
  const expectedActor=GOLDEN_DINNER_ACTOR_BY_STEP[step];
  if(expectedActor==="STELLA"&&!context.platformRoles.includes("AI_STELLA")) throw new AppError("PERMISSION_DENIED", "STELLA step requires AI_STELLA actor");
  if(expectedActor!=="STELLA"&&context.platformRoles.includes("AI_STELLA")) throw new AppError("PERMISSION_DENIED", "AI_STELLA cannot mutate Golden Dinner Core");
  requirePermission(context,GOLDEN_DINNER_PERMISSION_BY_STEP[step],{tenantId:context.tenantId,locationId:context.locationId});
}

function assertStage(result: GoldenDinnerStageResult, step: GoldenDinnerStep, sequence: number, context: SecurityContext): GoldenDinnerStageResult {
  if(result.step!==step||result.sequence!==sequence) throw new AppError("INTERNAL_ERROR", `Invalid ${step} service result`);
  if(result.actorIdentityId!==context.actorIdentityId) throw new AppError("INTERNAL_ERROR", `${step} actor evidence mismatch`);
  if(!result.resourceId?.trim()||!result.resourceType?.trim()||!result.eventType?.trim()||!Number.isFinite(Date.parse(result.occurredAt))) throw new AppError("INTERNAL_ERROR", `${step} evidence is incomplete`);
  return Object.freeze(result);
}

export async function runGoldenDinner(
  contexts: GoldenDinnerContextSet,
  rawInput: GoldenDinnerInput,
  dependencies: GoldenDinnerDependencies
): Promise<GoldenDinnerSnapshot> {
  const scope=assertContextSet(contexts);
  const input=Object.freeze({
    journeyId:uuid(rawInput.journeyId,"journeyId"),
    arrivalMode:rawInput.arrivalMode,
    partySize:rawInput.partySize,
    guestCredentialReference:text(rawInput.guestCredentialReference,"guestCredentialReference",240),
    tableId:uuid(rawInput.tableId,"tableId"),
    menuVersionId:uuid(rawInput.menuVersionId,"menuVersionId"),
    kitchenItemId:uuid(rawInput.kitchenItemId,"kitchenItemId"),
    barItemId:uuid(rawInput.barItemId,"barItemId"),
    totalAmount:money(rawInput.totalAmount),
    currency:currency(rawInput.currency),
    idempotencyKey:text(rawInput.idempotencyKey,"idempotencyKey",160)
  });
  if(!["BOOKING","QUEUE"].includes(input.arrivalMode)) validation("arrivalMode is invalid");
  if(!Number.isInteger(input.partySize)||input.partySize<1||input.partySize>100) validation("partySize is invalid");

  const timeline:GoldenDinnerStageResult[]=[];
  const call=async <T extends GoldenDinnerStageResult>(step:GoldenDinnerStep,context:SecurityContext,sequence:number,operation:()=>Promise<T>):Promise<T>=>{
    authorizeGoldenDinnerStep(context,step);
    const result=await operation();
    timeline.push(assertStage(result,step,sequence,context));
    return result;
  };
  const key=(step:GoldenDinnerStep)=>`${input.idempotencyKey}:${step.toLowerCase()}`;

  const party=await call("PARTY_RECORDED",contexts.GUEST,1,()=>dependencies.services.party.record(contexts.GUEST,{...commonScope(contexts.GUEST,{journeyId:input.journeyId,idempotencyKey:key("PARTY_RECORDED")}),partySize:input.partySize,guestCredentialReference:input.guestCredentialReference}));
  const demand=await call("DEMAND_ACCEPTED",contexts.GUEST,2,()=>dependencies.services.demand.accept(contexts.GUEST,{...commonScope(contexts.GUEST,{journeyId:input.journeyId,idempotencyKey:key("DEMAND_ACCEPTED")}),arrivalMode:input.arrivalMode,partyId:party.partyId,partySize:input.partySize,guestCredentialReference:input.guestCredentialReference}));
  await call("PARTY_SEATED",contexts.FOH,3,()=>dependencies.services.seating.seat(contexts.FOH,{...commonScope(contexts.FOH,{journeyId:input.journeyId,idempotencyKey:key("PARTY_SEATED")}),partyId:party.partyId,demandReferenceId:demand.demandReferenceId,tableId:input.tableId}));
  const session=await call("SERVICE_SESSION_OPENED",contexts.FOH,4,()=>dependencies.services.session.open(contexts.FOH,{...commonScope(contexts.FOH,{journeyId:input.journeyId,idempotencyKey:key("SERVICE_SESSION_OPENED")}),partyId:party.partyId,tableId:input.tableId}));
  const order=await call("ORDER_SUBMITTED",contexts.FOH,5,()=>dependencies.services.order.submit(contexts.FOH,{...commonScope(contexts.FOH,{journeyId:input.journeyId,idempotencyKey:key("ORDER_SUBMITTED")}),serviceSessionId:session.serviceSessionId,menuVersionId:input.menuVersionId,kitchenItemId:input.kitchenItemId,barItemId:input.barItemId,totalAmount:input.totalAmount,currency:input.currency}));
  await call("KITCHEN_READY",contexts.KITCHEN,6,()=>dependencies.services.production.ready(contexts.KITCHEN,{...commonScope(contexts.KITCHEN,{journeyId:input.journeyId,idempotencyKey:key("KITCHEN_READY")}),orderId:order.orderId,ticketId:order.kitchenTicketId,station:"KITCHEN"}));
  await call("BAR_READY",contexts.BAR,7,()=>dependencies.services.production.ready(contexts.BAR,{...commonScope(contexts.BAR,{journeyId:input.journeyId,idempotencyKey:key("BAR_READY")}),orderId:order.orderId,ticketId:order.barTicketId,station:"BAR"}));
  await call("ORDER_SERVED",contexts.FOH,8,()=>dependencies.services.service.serve(contexts.FOH,{...commonScope(contexts.FOH,{journeyId:input.journeyId,idempotencyKey:key("ORDER_SERVED")}),orderId:order.orderId,kitchenTicketId:order.kitchenTicketId,barTicketId:order.barTicketId}));
  const payment=await call("PAYMENT_RECORDED",contexts.CASHIER,9,()=>dependencies.services.settlement.settle(contexts.CASHIER,{...commonScope(contexts.CASHIER,{journeyId:input.journeyId,idempotencyKey:key("PAYMENT_RECORDED")}),orderId:order.orderId,amount:input.totalAmount,currency:input.currency}));
  await call("SERVICE_SESSION_CLOSED",contexts.FOH,10,()=>dependencies.services.session.close(contexts.FOH,{...commonScope(contexts.FOH,{journeyId:input.journeyId,idempotencyKey:key("SERVICE_SESSION_CLOSED")}),serviceSessionId:session.serviceSessionId,orderId:order.orderId,paymentId:payment.paymentId}));
  const review=await call("MANAGER_REVIEWED",contexts.MANAGER,11,()=>dependencies.services.review.record(contexts.MANAGER,{...commonScope(contexts.MANAGER,{journeyId:input.journeyId,idempotencyKey:key("MANAGER_REVIEWED")}),serviceSessionId:session.serviceSessionId,orderId:order.orderId,paymentId:payment.paymentId}));
  const proposal=await call("STELLA_PROPOSAL_CREATED",contexts.STELLA,12,()=>dependencies.services.stella.propose(contexts.STELLA,{...commonScope(contexts.STELLA,{journeyId:input.journeyId,idempotencyKey:key("STELLA_PROPOSAL_CREATED")}),serviceSessionId:session.serviceSessionId,orderId:order.orderId,managerReviewId:review.managerReviewId}));
  if(proposal.proposalStatus!=="PENDING_APPROVAL") throw new AppError("INTERNAL_ERROR", "STELLA proposal must remain pending human approval");

  const observedAt=(dependencies.now??(()=>new Date().toISOString()))();
  if(!Number.isFinite(Date.parse(observedAt))) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Server clock returned invalid timestamp");
  return Object.freeze({
    journeyId:input.journeyId,tenantId:scope.tenantId,locationId:scope.locationId,correlationId:scope.correlationId,
    environmentClass:GOLDEN_DINNER_ENVIRONMENT,partyId:party.partyId,demandReferenceId:demand.demandReferenceId,
    serviceSessionId:session.serviceSessionId,orderId:order.orderId,kitchenTicketId:order.kitchenTicketId,barTicketId:order.barTicketId,
    paymentId:payment.paymentId,managerReviewId:review.managerReviewId,proposalId:proposal.proposalId,proposalStatus:proposal.proposalStatus,
    timeline:Object.freeze([...timeline])
  });
}
