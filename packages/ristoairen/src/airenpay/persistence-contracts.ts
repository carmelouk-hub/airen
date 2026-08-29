import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";
import type {
  AirenPayGuaranteeRequestV1,
  AirenPayNormalizedWebhookEventV1,
  AirenPayOrchestrationProjectionV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "./contracts.ts";

export type AirenPayCreateOrchestrationResultV1 = Readonly<{
  orchestration: AirenPayOrchestrationProjectionV1;
  replayed: boolean;
}>;

export type AirenPayWebhookRecordResultV1 = Readonly<{
  webhookEventId: UUID;
  orchestrationId: UUID;
  replayed: boolean;
}>;

export interface AirenPayPersistencePort {
  listGatewayConnections(context: SecurityContext): Promise<readonly TenantPaymentGatewayConnectionProjectionV1[]>;
  findVisibleOrchestrationById(context: SecurityContext, orchestrationId: UUID): Promise<AirenPayOrchestrationProjectionV1 | null>;
  createOrchestration(
    context: SecurityContext,
    request: AirenPayGuaranteeRequestV1,
    connection: TenantPaymentGatewayConnectionProjectionV1,
    idempotencyKey: string
  ): Promise<AirenPayCreateOrchestrationResultV1>;
  recordNormalizedWebhookEvent(
    context: SecurityContext,
    connectionId: UUID,
    event: AirenPayNormalizedWebhookEventV1
  ): Promise<AirenPayWebhookRecordResultV1>;
}
