import { AppError, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { bookingSemanticHash } from "./application-service.ts";
import type { BookingProductAccessGuard } from "./contracts.ts";
import {
  BOOKING_HOLD_FUNCTION_IDS,
  type BookingHoldGuaranteeBeginInputV1,
  type BookingHoldGuaranteeResolutionInputV1,
  type BookingHoldIdempotencyScope,
  type BookingHoldMutationResultV1,
  type BookingHoldUnitOfWork
} from "./hold-contracts.ts";
import {
  assertBookingHoldNotExpired,
  requireBookingHoldGuaranteeUpdate,
  validateBookingHoldGuaranteeBegin,
  validateBookingHoldGuaranteeResolution,
  validateBookingHoldTransition
} from "./hold-policy.ts";

function idempotencyScope(
  context: SecurityContext,
  canonicalFunctionId: BookingHoldIdempotencyScope["canonicalFunctionId"],
  idempotencyKey: string,
  payload: unknown
): BookingHoldIdempotencyScope {
  const key = idempotencyKey.trim();
  if (!key || key.length > 200) throw new AppError("VALIDATION_FAILED", "A valid idempotency-key is required");
  return Object.freeze({
    actorIdentityId: context.actorIdentityId,
    tenantId: context.tenantId,
    locationId: context.locationId,
    canonicalFunctionId,
    idempotencyKey: key,
    semanticHash: bookingSemanticHash(payload)
  });
}

function assertMutationReplay(result: unknown): asserts result is BookingHoldMutationResultV1 {
  if (!result || typeof result !== "object" || !("hold" in result)) {
    throw new AppError("INTERNAL_ERROR", "BookingHold guarantee idempotency result type mismatch");
  }
}

export class BookingHoldGuaranteeApplicationService {
  private readonly uow: BookingHoldUnitOfWork;
  private readonly productAccess: BookingProductAccessGuard;

  constructor(uow: BookingHoldUnitOfWork, productAccess: BookingProductAccessGuard) {
    this.uow = uow;
    this.productAccess = productAccess;
  }

  async begin(
    context: SecurityContext,
    holdId: UUID,
    input: BookingHoldGuaranteeBeginInputV1,
    idempotencyKey: string
  ): Promise<BookingHoldMutationResultV1> {
    requireBookingHoldGuaranteeUpdate(context);
    await this.productAccess.assertBookingAccess(context);
    const validated = validateBookingHoldGuaranteeBegin(input);
    const scope = idempotencyScope(context, BOOKING_HOLD_FUNCTION_IDS.guaranteeBegin, idempotencyKey, { holdId, ...validated });

    return this.uow.transaction(context, async (tx) => {
      const claim = await tx.claimHoldIdempotency(scope);
      if (claim.kind === "REPLAY") {
        assertMutationReplay(claim.result);
        return Object.freeze({ hold: claim.result.hold, replayed: true });
      }

      const current = await tx.findVisibleHoldById(holdId);
      if (!current) throw new AppError("NOT_FOUND", "RESOURCE_NOT_FOUND_OR_NOT_VISIBLE");
      if (current.guaranteeMode === "NONE") throw new AppError("CONFLICT", "BookingHold does not require a financial guarantee");
      if (current.guaranteeRef && current.guaranteeRef !== validated.guaranteeReference) {
        throw new AppError("CONFLICT", "BookingHold guarantee reference mismatch");
      }
      assertBookingHoldNotExpired(current);
      validateBookingHoldTransition(current.status, "GUARANTEE_PENDING");
      const hold = await tx.transitionHoldStatus(holdId, current.status, "GUARANTEE_PENDING", validated.rowVersion, undefined, context);
      const result = Object.freeze({ hold, replayed: false });

      await tx.appendHoldAudit({
        eventType: "BOOKING_HOLD_GUARANTEE_PENDING",
        holdId,
        actorIdentityId: context.actorIdentityId,
        tenantId: context.tenantId,
        locationId: context.locationId,
        correlationId: context.correlationId,
        metadata: Object.freeze({
          from_status: current.status,
          to_status: hold.status,
          guarantee_mode: current.guaranteeMode,
          guarantee_reference: validated.guaranteeReference,
          result: "success"
        })
      });
      await tx.appendHoldOutbox({
        eventType: "booking.hold.guarantee_pending.v1",
        holdId,
        tenantId: context.tenantId,
        locationId: context.locationId,
        correlationId: context.correlationId,
        payload: Object.freeze({
          hold_id: holdId,
          status: hold.status,
          guarantee_mode: current.guaranteeMode,
          guarantee_reference: validated.guaranteeReference
        })
      });
      await tx.completeHoldIdempotency(scope, result);
      return result;
    });
  }

  async resolve(
    context: SecurityContext,
    holdId: UUID,
    input: BookingHoldGuaranteeResolutionInputV1,
    idempotencyKey: string
  ): Promise<BookingHoldMutationResultV1> {
    requireBookingHoldGuaranteeUpdate(context);
    await this.productAccess.assertBookingAccess(context);
    const validated = validateBookingHoldGuaranteeResolution(input);
    const scope = idempotencyScope(context, BOOKING_HOLD_FUNCTION_IDS.guaranteeResolve, idempotencyKey, { holdId, ...validated });

    return this.uow.transaction(context, async (tx) => {
      const claim = await tx.claimHoldIdempotency(scope);
      if (claim.kind === "REPLAY") {
        assertMutationReplay(claim.result);
        return Object.freeze({ hold: claim.result.hold, replayed: true });
      }

      const current = await tx.findVisibleHoldById(holdId);
      if (!current) throw new AppError("NOT_FOUND", "RESOURCE_NOT_FOUND_OR_NOT_VISIBLE");
      if (current.guaranteeMode === "NONE") throw new AppError("CONFLICT", "BookingHold does not require a financial guarantee");
      if (current.guaranteeRef && current.guaranteeRef !== validated.guaranteeReference) {
        throw new AppError("CONFLICT", "BookingHold guarantee reference mismatch");
      }
      assertBookingHoldNotExpired(current);
      const targetStatus = validated.outcome === "SATISFIED" ? "GUARANTEED" : "FAILED";
      validateBookingHoldTransition(current.status, targetStatus);
      const hold = await tx.transitionHoldStatus(
        holdId,
        current.status,
        targetStatus,
        validated.rowVersion,
        validated.outcome === "FAILED" ? validated.failureReason : undefined,
        context
      );
      const result = Object.freeze({ hold, replayed: false });
      const guaranteed = validated.outcome === "SATISFIED";

      await tx.appendHoldAudit({
        eventType: guaranteed ? "BOOKING_HOLD_GUARANTEED" : "BOOKING_HOLD_GUARANTEE_FAILED",
        holdId,
        actorIdentityId: context.actorIdentityId,
        tenantId: context.tenantId,
        locationId: context.locationId,
        correlationId: context.correlationId,
        metadata: Object.freeze({
          from_status: current.status,
          to_status: hold.status,
          guarantee_mode: current.guaranteeMode,
          guarantee_reference: validated.guaranteeReference,
          failure_reason: guaranteed ? null : validated.failureReason,
          result: guaranteed ? "satisfied" : "failed"
        })
      });
      await tx.appendHoldOutbox({
        eventType: guaranteed ? "booking.hold.guaranteed.v1" : "booking.hold.guarantee_failed.v1",
        holdId,
        tenantId: context.tenantId,
        locationId: context.locationId,
        correlationId: context.correlationId,
        payload: Object.freeze({
          hold_id: holdId,
          status: hold.status,
          guarantee_mode: current.guaranteeMode,
          guarantee_reference: validated.guaranteeReference,
          failure_reason: guaranteed ? null : validated.failureReason
        })
      });
      await tx.completeHoldIdempotency(scope, result);
      return result;
    });
  }
}
