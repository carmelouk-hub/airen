import { AppError, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { bookingSemanticHash } from "./application-service.ts";
import type { BookingProductAccessGuard } from "./contracts.ts";
import {
  BOOKING_HOLD_FUNCTION_IDS,
  type BookingGuaranteePolicyProjectionV1,
  type BookingHoldCancelInputV1,
  type BookingHoldCreateInputV1,
  type BookingHoldIdempotencyScope,
  type BookingHoldMutationResultV1,
  type BookingHoldUnitOfWork
} from "./hold-contracts.ts";
import {
  initialBookingHoldStatus,
  requireBookingHoldCancel,
  requireBookingHoldCreate,
  selectBookingGuaranteePolicy,
  validateBookingHoldCancel,
  validateBookingHoldCreate,
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

async function assertProductAccess(guard: BookingProductAccessGuard, context: SecurityContext): Promise<void> {
  await guard.assertBookingAccess(context);
}

function assertCreateReplay(result: unknown): asserts result is BookingHoldMutationResultV1 {
  if (!result || typeof result !== "object" || !("hold" in result)) {
    throw new AppError("INTERNAL_ERROR", "BookingHold idempotency result type mismatch");
  }
}

function selectedPolicyMetadata(policy: BookingGuaranteePolicyProjectionV1): Readonly<Record<string, unknown>> {
  return Object.freeze({
    guarantee_policy_id: policy.id,
    guarantee_mode: policy.guaranteeMode,
    policy_priority: policy.priority
  });
}

export class BookingHoldApplicationService {
  private readonly uow: BookingHoldUnitOfWork;
  private readonly productAccess: BookingProductAccessGuard;

  constructor(uow: BookingHoldUnitOfWork, productAccess: BookingProductAccessGuard) {
    this.uow = uow;
    this.productAccess = productAccess;
  }

  async create(context: SecurityContext, input: BookingHoldCreateInputV1, idempotencyKey: string): Promise<BookingHoldMutationResultV1> {
    requireBookingHoldCreate(context);
    await assertProductAccess(this.productAccess, context);
    const validated = validateBookingHoldCreate(input);
    const scope = idempotencyScope(context, BOOKING_HOLD_FUNCTION_IDS.create, idempotencyKey, validated);

    return this.uow.transaction(context, async (tx) => {
      const claim = await tx.claimHoldIdempotency(scope);
      if (claim.kind === "REPLAY") {
        assertCreateReplay(claim.result);
        return Object.freeze({ hold: claim.result.hold, replayed: true });
      }

      const candidates = await tx.listGuaranteePolicies(validated, context);
      const policy = selectBookingGuaranteePolicy(candidates, validated);
      const created = await tx.insertHold(validated, policy, context);
      if (created.status !== "CREATED") throw new AppError("INTERNAL_ERROR", "BookingHold persistence must begin in CREATED state");

      const targetStatus = initialBookingHoldStatus(policy.guaranteeMode);
      validateBookingHoldTransition(created.status, targetStatus);
      const hold = await tx.transitionHoldStatus(
        created.id,
        created.status,
        targetStatus,
        created.rowVersion,
        undefined,
        context
      );
      const result = Object.freeze({ hold, replayed: false });

      await tx.appendHoldAudit({
        eventType: "BOOKING_HOLD_CREATED",
        holdId: hold.id,
        actorIdentityId: context.actorIdentityId,
        tenantId: context.tenantId,
        locationId: context.locationId,
        correlationId: context.correlationId,
        metadata: Object.freeze({
          source_channel: hold.sourceChannel,
          resource_key: hold.resourceKey,
          final_status: hold.status,
          ...selectedPolicyMetadata(policy),
          result: "success"
        })
      });
      await tx.appendHoldOutbox({
        eventType: "booking.hold.created.v1",
        holdId: hold.id,
        tenantId: context.tenantId,
        locationId: context.locationId,
        correlationId: context.correlationId,
        payload: Object.freeze({
          hold_id: hold.id,
          status: hold.status,
          starts_at: hold.startsAt,
          capacity_claim: hold.capacityClaim,
          expires_at: hold.expiresAt,
          guarantee_mode: hold.guaranteeMode
        })
      });
      await tx.completeHoldIdempotency(scope, result);
      return result;
    });
  }

  async cancel(
    context: SecurityContext,
    holdId: UUID,
    input: BookingHoldCancelInputV1,
    idempotencyKey: string
  ): Promise<BookingHoldMutationResultV1> {
    requireBookingHoldCancel(context);
    await assertProductAccess(this.productAccess, context);
    const validated = validateBookingHoldCancel(input);
    const scope = idempotencyScope(context, BOOKING_HOLD_FUNCTION_IDS.cancel, idempotencyKey, { holdId, ...validated });

    return this.uow.transaction(context, async (tx) => {
      const claim = await tx.claimHoldIdempotency(scope);
      if (claim.kind === "REPLAY") {
        assertCreateReplay(claim.result);
        return Object.freeze({ hold: claim.result.hold, replayed: true });
      }

      const current = await tx.findVisibleHoldById(holdId);
      if (!current) throw new AppError("NOT_FOUND", "RESOURCE_NOT_FOUND_OR_NOT_VISIBLE");
      validateBookingHoldTransition(current.status, "CANCELLED");
      const hold = await tx.transitionHoldStatus(
        holdId,
        current.status,
        "CANCELLED",
        validated.rowVersion,
        validated.reason,
        context
      );
      const result = Object.freeze({ hold, replayed: false });

      await tx.appendHoldAudit({
        eventType: "BOOKING_HOLD_CANCELLED",
        holdId,
        actorIdentityId: context.actorIdentityId,
        tenantId: context.tenantId,
        locationId: context.locationId,
        correlationId: context.correlationId,
        metadata: Object.freeze({ from_status: current.status, reason_code: validated.reason ?? null, result: "success" })
      });
      await tx.appendHoldOutbox({
        eventType: "booking.hold.cancelled.v1",
        holdId,
        tenantId: context.tenantId,
        locationId: context.locationId,
        correlationId: context.correlationId,
        payload: Object.freeze({ hold_id: holdId, from_status: current.status, to_status: hold.status })
      });
      await tx.completeHoldIdempotency(scope, result);
      return result;
    });
  }
}
