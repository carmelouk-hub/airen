import type { ProviderWebhookHandler, VerifiedProviderWebhookEvent } from "../../../integrations/src/webhook-replay.ts";
import type { UnitOfWork } from "../../../audit-events/src/index.ts";
import type { SecurityContext } from "../../../shared-contracts/src/index.ts";
import {
  recordPayment,
  type PaymentRecordInput,
  type PaymentRecordResult,
  type PaymentRecordTransaction
} from "./payment-record.ts";

export type TrustedProviderCaptureLookup = Readonly<{
  providerEventId: string;
  eventType: string;
}>;

/**
 * Server-owned capture resolution prepared from trusted AIRenOS/application state.
 * It is deliberately resolved by provider event identity/type only: providerPayload
 * can be used by a concrete adapter for verification/interpretation later, but it
 * cannot directly supply Tenant, Location, actor, order, amount, currency or permissions.
 */
export type TrustedProviderCaptureResolution = Readonly<{
  securityContext: SecurityContext;
  payment: PaymentRecordInput;
}>;

export type TrustedProviderCaptureResolver = Readonly<{
  resolve(lookup: TrustedProviderCaptureLookup): Promise<TrustedProviderCaptureResolution | null>;
}>;

export type ProviderPaymentCaptureDependencies = Readonly<{
  resolver: TrustedProviderCaptureResolver;
  unitOfWork: UnitOfWork<PaymentRecordTransaction>;
  now?: () => string;
  onRecorded?: (result: PaymentRecordResult, event: TrustedProviderCaptureLookup) => Promise<void> | void;
}>;

function trustedLookup(event: VerifiedProviderWebhookEvent): TrustedProviderCaptureLookup {
  return Object.freeze({
    providerEventId: event.providerEventId,
    eventType: event.eventType
  });
}

function validateResolution(resolution: TrustedProviderCaptureResolution): void {
  if (!resolution.securityContext?.tenantId || !resolution.securityContext?.locationId) {
    throw new Error("PROVIDER_CAPTURE_SECURITY_CONTEXT_INVALID");
  }
  if (!resolution.securityContext.actorIdentityId || !resolution.securityContext.correlationId) {
    throw new Error("PROVIDER_CAPTURE_SECURITY_CONTEXT_INVALID");
  }
  if (!resolution.payment?.orderId || !resolution.payment.idempotencyKey) {
    throw new Error("PROVIDER_CAPTURE_COMMAND_INVALID");
  }
}

/**
 * MAT-019 composition boundary.
 *
 * The verified webhook event is reduced to provider event identity + event type before
 * entering the trusted resolver. Financial command fields and AIRenOS SecurityContext
 * come exclusively from server-owned resolution. The canonical payment.record service
 * remains the sole authority for authorization, outstanding balance, idempotency, audit
 * and durable Payment mutation.
 */
export function createProviderPaymentCaptureHandler(
  dependencies: ProviderPaymentCaptureDependencies
): ProviderWebhookHandler {
  return async (event: VerifiedProviderWebhookEvent): Promise<void> => {
    const lookup = trustedLookup(event);
    const resolution = await dependencies.resolver.resolve(lookup);
    if (!resolution) throw new Error("PROVIDER_CAPTURE_BINDING_NOT_FOUND");
    validateResolution(resolution);

    const result = await recordPayment(
      resolution.securityContext,
      resolution.payment,
      { unitOfWork: dependencies.unitOfWork, ...(dependencies.now ? { now: dependencies.now } : {}) }
    );

    await dependencies.onRecorded?.(result, lookup);
  };
}
