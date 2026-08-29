import type { SecretRef, UUID } from "../../../shared-contracts/src/index.ts";
import type { BookingGuaranteeMode } from "../booking/hold-contracts.ts";

export const AIRENPAY_CONNECTION_MODES = ["TEST", "LIVE"] as const;
export type AirenPayConnectionMode = (typeof AIRENPAY_CONNECTION_MODES)[number];

export const AIRENPAY_CONNECTION_STATUSES = ["ACTIVE", "DISABLED", "REVOKED"] as const;
export type AirenPayConnectionStatus = (typeof AIRENPAY_CONNECTION_STATUSES)[number];

export const AIRENPAY_CAPABILITIES = [
  "PAYMENT_METHOD_SETUP",
  "DEPOSIT_PAYMENT",
  "FULL_PREPAYMENT",
  "AUTHORIZATION_HOLD",
  "CAPTURE_AUTHORIZATION",
  "RELEASE_AUTHORIZATION",
  "REFUND_PAYMENT",
  "TRANSACTION_STATUS",
  "WEBHOOK_VERIFICATION"
] as const;
export type AirenPayCapability = (typeof AIRENPAY_CAPABILITIES)[number];

export const AIRENPAY_ORCHESTRATION_STATUSES = [
  "CREATED",
  "PROVIDER_PENDING",
  "CUSTOMER_ACTION_REQUIRED",
  "GUARANTEE_SATISFIED",
  "CAPTURED",
  "RELEASED",
  "REFUNDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED"
] as const;
export type AirenPayOrchestrationStatus = (typeof AIRENPAY_ORCHESTRATION_STATUSES)[number];

export const AIRENPAY_NORMALIZED_WEBHOOK_EVENTS = [
  "SETUP_SUCCEEDED",
  "PAYMENT_SUCCEEDED",
  "AUTHORIZATION_SUCCEEDED",
  "CAPTURE_SUCCEEDED",
  "RELEASE_SUCCEEDED",
  "REFUND_SUCCEEDED",
  "ACTION_REQUIRED",
  "FAILED",
  "CANCELLED",
  "EXPIRED"
] as const;
export type AirenPayNormalizedWebhookEventType = (typeof AIRENPAY_NORMALIZED_WEBHOOK_EVENTS)[number];

export type AirenPayMoneyV1 = Readonly<{
  amountMinor: number;
  currency: string;
}>;

export type TenantPaymentGatewayConnectionProjectionV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId?: UUID;
  providerType: string;
  providerAccountReference: string;
  capabilities: readonly AirenPayCapability[];
  mode: AirenPayConnectionMode;
  credentialSecretRef: SecretRef;
  webhookSecretRef?: SecretRef;
  webhookConfigurationReference?: string;
  status: AirenPayConnectionStatus;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}>;

export type AirenPayGuaranteeRequestV1 = Readonly<{
  bookingHoldId: UUID;
  guaranteeMode: Exclude<BookingGuaranteeMode, "NONE">;
  financialTerms?: AirenPayMoneyV1;
}>;

export type AirenPayClientActionV1 = Readonly<{
  kind: "NONE" | "REDIRECT" | "CLIENT_CONFIRMATION";
  opaqueReference?: string;
  expiresAt?: string;
}>;

export type AirenPayGatewayOperationContextV1 = Readonly<{
  orchestrationId: UUID;
  correlationId: string;
  idempotencyKey: string;
  connection: TenantPaymentGatewayConnectionProjectionV1;
}>;

export type AirenPayGatewayOperationResultV1 = Readonly<{
  providerReference: string;
  status: AirenPayOrchestrationStatus;
  clientAction?: AirenPayClientActionV1;
  authorizationExpiresAt?: string;
  providerMetadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type AirenPayTransactionStatusResultV1 = Readonly<{
  providerReference: string;
  status: AirenPayOrchestrationStatus;
  authorizationExpiresAt?: string;
  amount?: AirenPayMoneyV1;
  providerMetadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type AirenPayWebhookRequestV1 = Readonly<{
  connectionId: UUID;
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string | undefined>>;
  receivedAt: string;
}>;

export type AirenPayNormalizedWebhookEventV1 = Readonly<{
  providerEventId: string;
  providerReference: string;
  eventType: AirenPayNormalizedWebhookEventType;
  status: AirenPayOrchestrationStatus;
  occurredAt: string;
  amount?: AirenPayMoneyV1;
  authorizationExpiresAt?: string;
  providerMetadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type AirenPayOrchestrationProjectionV1 = Readonly<{
  id: UUID;
  tenantId: UUID;
  locationId: UUID;
  bookingHoldId: UUID;
  bookingId?: UUID;
  guaranteeMode: Exclude<BookingGuaranteeMode, "NONE">;
  providerType: string;
  providerConnectionId: UUID;
  providerCustomerReference?: string;
  providerPaymentMethodReference?: string;
  providerTransactionReference?: string;
  amount?: AirenPayMoneyV1;
  orchestrationStatus: AirenPayOrchestrationStatus;
  authorizationExpiresAt?: string;
  guaranteedAt?: string;
  paidAt?: string;
  authorizedAt?: string;
  capturedAt?: string;
  refundedAt?: string;
  releasedAt?: string;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}>;

export interface PaymentGatewayPort {
  createPaymentMethodSetup(context: AirenPayGatewayOperationContextV1): Promise<AirenPayGatewayOperationResultV1>;
  createDepositPayment(context: AirenPayGatewayOperationContextV1, amount: AirenPayMoneyV1): Promise<AirenPayGatewayOperationResultV1>;
  createFullPrepayment(context: AirenPayGatewayOperationContextV1, amount: AirenPayMoneyV1): Promise<AirenPayGatewayOperationResultV1>;
  createAuthorizationHold(context: AirenPayGatewayOperationContextV1, amount: AirenPayMoneyV1): Promise<AirenPayGatewayOperationResultV1>;
  captureAuthorization(context: AirenPayGatewayOperationContextV1, providerReference: string, amount?: AirenPayMoneyV1): Promise<AirenPayGatewayOperationResultV1>;
  releaseAuthorization(context: AirenPayGatewayOperationContextV1, providerReference: string): Promise<AirenPayGatewayOperationResultV1>;
  refundPayment(context: AirenPayGatewayOperationContextV1, providerReference: string, amount?: AirenPayMoneyV1): Promise<AirenPayGatewayOperationResultV1>;
  getTransactionStatus(context: AirenPayGatewayOperationContextV1, providerReference: string): Promise<AirenPayTransactionStatusResultV1>;
  verifyAndNormalizeWebhook(request: AirenPayWebhookRequestV1, connection: TenantPaymentGatewayConnectionProjectionV1): Promise<AirenPayNormalizedWebhookEventV1>;
}
