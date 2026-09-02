import { AppError, type SecurityContext, type UUID } from "../../../packages/shared-contracts/src/index.ts";
import type { AirenPayNormalizedWebhookEventV1 } from "../../../packages/airenpay/src/contracts.ts";
import type {
  AirenPayPersistencePort,
  AirenPayWebhookRecordResultV1
} from "../../../packages/airenpay/src/persistence-contracts.ts";
import {
  BookingHoldGuaranteeApplicationService,
  type BookingHoldMutationResultV1,
  type BookingHoldPrivateProjectionV1,
  type BookingHoldUnitOfWork
} from "../../../packages/booking-core/src/index.ts";

export type AirenBookingAirenPayResolution = "NO_BOOKING_TRANSITION" | "SATISFIED" | "FAILED";

export type AirenBookingAirenPayWebhookResultV1 = Readonly<{
  webhook: AirenPayWebhookRecordResultV1;
  resolution: AirenBookingAirenPayResolution;
  hold?: BookingHoldMutationResultV1;
}>;

export class AirenBookingAirenPayBridge {
  private readonly airenPay: AirenPayPersistencePort;
  private readonly holdUow: BookingHoldUnitOfWork;
  private readonly guaranteeService: BookingHoldGuaranteeApplicationService;

  constructor(
    airenPay: AirenPayPersistencePort,
    holdUow: BookingHoldUnitOfWork,
    guaranteeService: BookingHoldGuaranteeApplicationService
  ) {
    this.airenPay = airenPay;
    this.holdUow = holdUow;
    this.guaranteeService = guaranteeService;
  }

  private async visibleHold(context: SecurityContext, holdId: UUID): Promise<BookingHoldPrivateProjectionV1> {
    const hold = await this.holdUow.transaction(context, (tx) => tx.findVisibleHoldById(holdId));
    if (!hold) throw new AppError("NOT_FOUND", "RESOURCE_NOT_FOUND_OR_NOT_VISIBLE");
    return hold;
  }

  async bindOrchestration(context: SecurityContext, orchestrationId: UUID): Promise<BookingHoldMutationResultV1> {
    const orchestration = await this.airenPay.findVisibleOrchestrationById(context, orchestrationId);
    if (!orchestration) throw new AppError("NOT_FOUND", "AIRENPAY_ORCHESTRATION_NOT_VISIBLE");
    if (orchestration.tenantId !== context.tenantId || orchestration.locationId !== context.locationId) {
      throw new AppError("TENANT_SCOPE_VIOLATION", "AIRenPay orchestration is outside trusted Booking scope");
    }
    const hold = await this.visibleHold(context, orchestration.bookingHoldId);
    if (hold.guaranteeMode !== orchestration.guaranteeMode) {
      throw new AppError("CONFLICT", "AIRenPay orchestration guarantee mode does not match BookingHold");
    }
    if (hold.guaranteeRef && hold.guaranteeRef !== orchestration.id) {
      throw new AppError("CONFLICT", "BookingHold is already bound to another guarantee reference");
    }
    return this.guaranteeService.begin(
      context,
      hold.id,
      { rowVersion: hold.rowVersion, guaranteeReference: orchestration.id },
      `airen-booking:airenpay-bind:${orchestration.id}`
    );
  }

  async recordWebhookAndResolve(
    context: SecurityContext,
    connectionId: UUID,
    event: AirenPayNormalizedWebhookEventV1
  ): Promise<AirenBookingAirenPayWebhookResultV1> {
    const webhook = await this.airenPay.recordNormalizedWebhookEvent(context, connectionId, event);
    const orchestration = await this.airenPay.findVisibleOrchestrationById(context, webhook.orchestrationId);
    if (!orchestration) throw new AppError("NOT_FOUND", "AIRENPAY_ORCHESTRATION_NOT_VISIBLE_AFTER_WEBHOOK");
    if (orchestration.providerConnectionId !== connectionId || orchestration.providerTransactionReference !== event.providerReference) {
      throw new AppError("CONFLICT", "Persisted AIRenPay orchestration does not match verified webhook evidence");
    }

    const hold = await this.visibleHold(context, orchestration.bookingHoldId);
    if (hold.guaranteeMode !== orchestration.guaranteeMode) {
      throw new AppError("CONFLICT", "AIRenPay orchestration guarantee mode does not match BookingHold");
    }
    if (hold.guaranteeRef !== orchestration.id) {
      throw new AppError("CONFLICT", "BookingHold guarantee reference is not bound to the verified AIRenPay orchestration");
    }

    if (event.status === "GUARANTEE_SATISFIED") {
      const resolved = await this.guaranteeService.resolve(
        context,
        hold.id,
        { rowVersion: hold.rowVersion, guaranteeReference: orchestration.id, outcome: "SATISFIED" },
        `airen-booking:airenpay-webhook:${webhook.webhookEventId}`
      );
      return Object.freeze({ webhook, resolution: "SATISFIED", hold: resolved });
    }

    if (["FAILED", "CANCELLED", "EXPIRED"].includes(event.status)) {
      const resolved = await this.guaranteeService.resolve(
        context,
        hold.id,
        {
          rowVersion: hold.rowVersion,
          guaranteeReference: orchestration.id,
          outcome: "FAILED",
          failureReason: `AIRENPAY_${event.status}`
        },
        `airen-booking:airenpay-webhook:${webhook.webhookEventId}`
      );
      return Object.freeze({ webhook, resolution: "FAILED", hold: resolved });
    }

    return Object.freeze({ webhook, resolution: "NO_BOOKING_TRANSITION" });
  }
}