import { createHash } from "node:crypto";
import { AppError, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import {
  BOOKING_FUNCTION_IDS,
  type BookingCreateInputV1, type BookingMutationResultV1, type BookingPrivateListResultV1, type BookingPrivateProjectionV1,
  type BookingProductAccessGuard, type BookingQueryInputV1, type BookingReadRepository, type BookingStatusTransitionInputV1,
  type BookingUnitOfWork, type BookingUpdateInputV1, type IdempotencyScope
} from "./contracts.ts";
import {
  requireBookingCreate, requireBookingRead, requireBookingStatusUpdate, requireBookingUpdate,
  validateBookingCreate, validateBookingQuery, validateBookingUpdate, validateStatusTransition
} from "./policy.ts";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}
export function bookingSemanticHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
function idempotencyScope(context: SecurityContext, canonicalFunctionId: IdempotencyScope["canonicalFunctionId"], idempotencyKey: string, payload: unknown): IdempotencyScope {
  const key = idempotencyKey.trim();
  if (!key || key.length > 200) throw new AppError("VALIDATION_FAILED", "A valid idempotency-key is required");
  return Object.freeze({ actorIdentityId: context.actorIdentityId, tenantId: context.tenantId, locationId: context.locationId, canonicalFunctionId, idempotencyKey: key, semanticHash: bookingSemanticHash(payload) });
}
async function assertProductAccess(guard: BookingProductAccessGuard, context: SecurityContext): Promise<void> { await guard.assertBookingAccess(context); }

export class BookingApplicationService {
  private readonly reads: BookingReadRepository;
  private readonly uow: BookingUnitOfWork;
  private readonly productAccess: BookingProductAccessGuard;
  constructor(reads: BookingReadRepository, uow: BookingUnitOfWork, productAccess: BookingProductAccessGuard) {
    this.reads = reads; this.uow = uow; this.productAccess = productAccess;
  }
  async query(context: SecurityContext, input: BookingQueryInputV1): Promise<BookingPrivateListResultV1> {
    requireBookingRead(context); await assertProductAccess(this.productAccess, context); return this.reads.query(context, validateBookingQuery(input));
  }
  async get(context: SecurityContext, bookingId: UUID): Promise<BookingPrivateProjectionV1> {
    requireBookingRead(context); await assertProductAccess(this.productAccess, context);
    const booking = await this.reads.findVisibleById(context, bookingId);
    if (!booking) throw new AppError("NOT_FOUND", "RESOURCE_NOT_FOUND_OR_NOT_VISIBLE");
    return booking;
  }
  async create(context: SecurityContext, input: BookingCreateInputV1, idempotencyKey: string): Promise<BookingMutationResultV1> {
    requireBookingCreate(context); await assertProductAccess(this.productAccess, context);
    const validated = validateBookingCreate(input); const scope = idempotencyScope(context, BOOKING_FUNCTION_IDS.create, idempotencyKey, validated);
    return this.uow.transaction(context, async (tx) => {
      const claim = await tx.claimIdempotency(scope); if (claim.kind === "REPLAY") return Object.freeze({ ...claim.result, replayed: true });
      const booking = await tx.insertBooking(validated, context); const result = Object.freeze({ booking, replayed: false });
      await tx.appendAudit({ eventType:"BOOKING_CREATED", bookingId:booking.id, actorIdentityId:context.actorIdentityId, tenantId:context.tenantId, locationId:context.locationId, correlationId:context.correlationId, metadata:Object.freeze({source:booking.source,result:"success"}) });
      await tx.appendOutbox({ eventType:"booking.created.v1", bookingId:booking.id, tenantId:context.tenantId, locationId:context.locationId, correlationId:context.correlationId, payload:Object.freeze({booking_id:booking.id,status:booking.status,starts_at:booking.startsAt,party_size:booking.partySize}) });
      await tx.completeIdempotency(scope,result); return result;
    });
  }
  async update(context: SecurityContext, bookingId: UUID, input: BookingUpdateInputV1, idempotencyKey: string): Promise<BookingMutationResultV1> {
    requireBookingUpdate(context); await assertProductAccess(this.productAccess, context);
    const validated=validateBookingUpdate(input); const scope=idempotencyScope(context,BOOKING_FUNCTION_IDS.update,idempotencyKey,{bookingId,...validated});
    return this.uow.transaction(context,async(tx)=>{
      const claim=await tx.claimIdempotency(scope); if(claim.kind==="REPLAY") return Object.freeze({...claim.result,replayed:true});
      const current=await tx.findVisibleById(bookingId); if(!current) throw new AppError("NOT_FOUND","RESOURCE_NOT_FOUND_OR_NOT_VISIBLE");
      const booking=await tx.updateBooking(bookingId,validated,context); const changedFieldNames=Object.keys(validated).filter(k=>k!=="rowVersion").sort(); const result=Object.freeze({booking,replayed:false});
      await tx.appendAudit({eventType:"BOOKING_UPDATED",bookingId,actorIdentityId:context.actorIdentityId,tenantId:context.tenantId,locationId:context.locationId,correlationId:context.correlationId,metadata:Object.freeze({changed_field_names:changedFieldNames,result:"success"})});
      await tx.appendOutbox({eventType:"booking.updated.v1",bookingId,tenantId:context.tenantId,locationId:context.locationId,correlationId:context.correlationId,payload:Object.freeze({booking_id:bookingId,changed_field_names:changedFieldNames})});
      await tx.completeIdempotency(scope,result); return result;
    });
  }
  async transitionStatus(context: SecurityContext, bookingId: UUID, input: BookingStatusTransitionInputV1, idempotencyKey: string): Promise<BookingMutationResultV1> {
    requireBookingStatusUpdate(context); await assertProductAccess(this.productAccess, context);
    const scope=idempotencyScope(context,BOOKING_FUNCTION_IDS.statusUpdate,idempotencyKey,{bookingId,...input});
    return this.uow.transaction(context,async(tx)=>{
      const claim=await tx.claimIdempotency(scope); if(claim.kind==="REPLAY") return Object.freeze({...claim.result,replayed:true});
      const current=await tx.findVisibleById(bookingId); if(!current) throw new AppError("NOT_FOUND","RESOURCE_NOT_FOUND_OR_NOT_VISIBLE"); validateStatusTransition(current.status,input);
      const booking=await tx.transitionBookingStatus(bookingId,current.status,input,context); const result=Object.freeze({booking,replayed:false});
      await tx.appendAudit({eventType:"BOOKING_STATUS_CHANGED",bookingId,actorIdentityId:context.actorIdentityId,tenantId:context.tenantId,locationId:context.locationId,correlationId:context.correlationId,metadata:Object.freeze({from_status:current.status,to_status:booking.status,reason_code:input.reason??null,result:"success"})});
      await tx.appendOutbox({eventType:"booking.status_changed.v1",bookingId,tenantId:context.tenantId,locationId:context.locationId,correlationId:context.correlationId,payload:Object.freeze({booking_id:bookingId,from_status:current.status,to_status:booking.status})});
      await tx.completeIdempotency(scope,result); return result;
    });
  }
}
