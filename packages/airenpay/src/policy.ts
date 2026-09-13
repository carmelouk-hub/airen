import { AppError, type SecurityContext, type SecretRef } from "../../shared-contracts/src/index.ts";
import { BOOKING_GUARANTEE_MODES, type BookingGuaranteeMode } from "../../booking-core/src/hold-contracts.ts";
import {
  AIRENPAY_CAPABILITIES,
  AIRENPAY_CONNECTION_MODES,
  AIRENPAY_CONNECTION_STATUSES,
  AIRENPAY_NORMALIZED_WEBHOOK_EVENTS,
  AIRENPAY_ORCHESTRATION_STATUSES,
  type AirenPayCapability,
  type AirenPayGuaranteeRequestV1,
  type AirenPayGatewayOperationContextV1,
  type AirenPayMoneyV1,
  type AirenPayNormalizedWebhookEventV1,
  type AirenPayOrchestrationStatus,
  type AirenPayWebhookRequestV1,
  type TenantPaymentGatewayConnectionProjectionV1
} from "./contracts.ts";

const CLIENT_SCOPE_KEYS = new Set(["tenantId", "tenant_id", "locationId", "location_id"]);
const PLAINTEXT_SECRET_KEYS = new Set([
  "secret",
  "apiKey",
  "api_key",
  "password",
  "accessToken",
  "access_token",
  "privateKey",
  "private_key",
  "clientSecret",
  "client_secret",
  "webhookSecret",
  "webhook_secret"
]);
const SENSITIVE_METADATA_KEY = /(secret|password|token|private[_-]?key|client[_-]?secret|cvv|cvc|\bpan\b|card[_-]?number)/i;

export const AIRENPAY_CAPABILITY_BY_GUARANTEE_MODE: Readonly<Record<Exclude<BookingGuaranteeMode, "NONE">, AirenPayCapability>> = Object.freeze({
  PAYMENT_METHOD_GUARANTEE: "PAYMENT_METHOD_SETUP",
  DEPOSIT: "DEPOSIT_PAYMENT",
  FULL_PREPAYMENT: "FULL_PREPAYMENT",
  AUTHORIZATION_HOLD: "AUTHORIZATION_HOLD"
});

export const AIRENPAY_ORCHESTRATION_ALLOWED_TRANSITIONS: Readonly<Record<AirenPayOrchestrationStatus, readonly AirenPayOrchestrationStatus[]>> = Object.freeze({
  CREATED: ["PROVIDER_PENDING", "CUSTOMER_ACTION_REQUIRED", "GUARANTEE_SATISFIED", "FAILED", "CANCELLED"],
  PROVIDER_PENDING: ["CUSTOMER_ACTION_REQUIRED", "GUARANTEE_SATISFIED", "FAILED", "CANCELLED", "EXPIRED"],
  CUSTOMER_ACTION_REQUIRED: ["PROVIDER_PENDING", "GUARANTEE_SATISFIED", "FAILED", "CANCELLED", "EXPIRED"],
  GUARANTEE_SATISFIED: ["CAPTURED", "RELEASED", "REFUNDED"],
  CAPTURED: ["REFUNDED"],
  RELEASED: [],
  REFUNDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: []
});

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AppError("VALIDATION_FAILED", `${field} is required`);
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AppError("VALIDATION_FAILED", `${field} must be a positive safe integer`);
  return value;
}

function positiveRowVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new AppError("VALIDATION_FAILED", "row_version must be a positive safe integer");
  return value;
}

function validIsoInstant(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new AppError("VALIDATION_FAILED", `${field} must be a valid ISO timestamp`);
  return value;
}

function rejectClientScopeSpoof(input: object): void {
  for (const key of Object.keys(input)) {
    if (CLIENT_SCOPE_KEYS.has(key)) throw new AppError("TENANT_SCOPE_VIOLATION", "Provider/client payload cannot assert Tenant or Location scope");
  }
}

function rejectPlaintextConnectionSecrets(input: object): void {
  for (const key of Object.keys(input)) {
    if (PLAINTEXT_SECRET_KEYS.has(key)) throw new AppError("VALIDATION_FAILED", "Plaintext payment gateway credentials are forbidden; use SecretRef only");
  }
}

export function validateAirenPayMoney(input: AirenPayMoneyV1): AirenPayMoneyV1 {
  positiveInteger(input.amountMinor, "amount_minor");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new AppError("VALIDATION_FAILED", "currency must be an uppercase ISO-style three-letter code");
  return Object.freeze({ amountMinor: input.amountMinor, currency: input.currency });
}

export function validateAirenPaySecretRef(input: SecretRef, field: string): SecretRef {
  if (!input || typeof input !== "object") throw new AppError("VALIDATION_FAILED", `${field} must be a SecretRef`);
  const provider = nonEmpty(input.provider, `${field}.provider`);
  const key = nonEmpty(input.key, `${field}.key`);
  const version = input.version?.trim() || undefined;
  return Object.freeze({ provider, key, version });
}

export function validateTenantPaymentGatewayConnection(
  input: TenantPaymentGatewayConnectionProjectionV1
): TenantPaymentGatewayConnectionProjectionV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("VALIDATION_FAILED", "Payment gateway connection must be an object");
  rejectPlaintextConnectionSecrets(input);
  nonEmpty(input.id, "connection.id");
  nonEmpty(input.tenantId, "connection.tenant_id");
  if (input.locationId !== undefined) nonEmpty(input.locationId, "connection.location_id");
  const providerType = nonEmpty(input.providerType, "provider_type").toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(providerType)) throw new AppError("VALIDATION_FAILED", "provider_type must be a canonical provider identifier");
  nonEmpty(input.providerAccountReference, "provider_account_reference");
  if (!AIRENPAY_CONNECTION_MODES.includes(input.mode)) throw new AppError("VALIDATION_FAILED", "Unknown payment gateway connection mode");
  if (!AIRENPAY_CONNECTION_STATUSES.includes(input.status)) throw new AppError("VALIDATION_FAILED", "Unknown payment gateway connection status");
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) throw new AppError("VALIDATION_FAILED", "At least one payment gateway capability is required");
  const capabilities = [...new Set(input.capabilities)];
  if (capabilities.length !== input.capabilities.length) throw new AppError("VALIDATION_FAILED", "Payment gateway capabilities must be unique");
  for (const capability of capabilities) {
    if (!AIRENPAY_CAPABILITIES.includes(capability)) throw new AppError("VALIDATION_FAILED", "Unknown payment gateway capability");
  }
  const credentialSecretRef = validateAirenPaySecretRef(input.credentialSecretRef, "credential_secret_ref");
  const webhookSecretRef = input.webhookSecretRef ? validateAirenPaySecretRef(input.webhookSecretRef, "webhook_secret_ref") : undefined;
  const webhookConfigurationReference = input.webhookConfigurationReference?.trim() || undefined;
  if (capabilities.includes("WEBHOOK_VERIFICATION") && !webhookSecretRef && !webhookConfigurationReference) {
    throw new AppError("VALIDATION_FAILED", "Webhook verification capability requires a secret or trusted webhook configuration reference");
  }
  validIsoInstant(input.createdAt, "created_at");
  validIsoInstant(input.updatedAt, "updated_at");
  positiveRowVersion(input.rowVersion);
  return Object.freeze({
    ...input,
    providerType,
    capabilities: Object.freeze(capabilities),
    credentialSecretRef,
    webhookSecretRef,
    webhookConfigurationReference
  });
}

export function assertGateCTestPaymentConnection(connection: TenantPaymentGatewayConnectionProjectionV1): void {
  if (connection.mode !== "TEST") throw new AppError("PERMISSION_DENIED", "LIVE payment gateway connections are not authorized in Gate C");
  if (connection.status !== "ACTIVE") throw new AppError("CONFLICT", "Payment gateway connection is not active");
}

export function requiredAirenPayCapability(guaranteeMode: BookingGuaranteeMode): AirenPayCapability {
  if (!BOOKING_GUARANTEE_MODES.includes(guaranteeMode)) throw new AppError("VALIDATION_FAILED", "Unknown Booking guarantee mode");
  if (guaranteeMode === "NONE") throw new AppError("VALIDATION_FAILED", "Guarantee mode NONE does not require AIRenPay");
  return AIRENPAY_CAPABILITY_BY_GUARANTEE_MODE[guaranteeMode];
}

export function validateAirenPayGuaranteeRequest(input: AirenPayGuaranteeRequestV1): AirenPayGuaranteeRequestV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("VALIDATION_FAILED", "AIRenPay guarantee request must be an object");
  rejectClientScopeSpoof(input);
  nonEmpty(input.bookingHoldId, "booking_hold_id");
  requiredAirenPayCapability(input.guaranteeMode);
  const amountRequired = input.guaranteeMode === "DEPOSIT" || input.guaranteeMode === "FULL_PREPAYMENT" || input.guaranteeMode === "AUTHORIZATION_HOLD";
  if (amountRequired && !input.financialTerms) throw new AppError("VALIDATION_FAILED", "Financial terms are required for this guarantee mode");
  if (!amountRequired && input.financialTerms) throw new AppError("VALIDATION_FAILED", "PAYMENT_METHOD_GUARANTEE must not carry an amount");
  return Object.freeze({
    bookingHoldId: input.bookingHoldId,
    guaranteeMode: input.guaranteeMode,
    financialTerms: input.financialTerms ? validateAirenPayMoney(input.financialTerms) : undefined
  });
}

export function selectTenantPaymentGatewayConnection(
  candidates: readonly TenantPaymentGatewayConnectionProjectionV1[],
  context: SecurityContext,
  guaranteeMode: Exclude<BookingGuaranteeMode, "NONE">
): TenantPaymentGatewayConnectionProjectionV1 {
  const requiredCapability = requiredAirenPayCapability(guaranteeMode);
  const validated = candidates.map(validateTenantPaymentGatewayConnection);
  for (const connection of validated) {
    if (connection.tenantId !== context.tenantId) throw new AppError("TENANT_SCOPE_VIOLATION", "Payment gateway repository returned a cross-tenant connection");
  }
  const scoped = validated.filter((connection) => !connection.locationId || connection.locationId === context.locationId);
  const capable = scoped.filter((connection) => connection.status === "ACTIVE" && connection.capabilities.includes(requiredCapability));
  const testCapable = capable.filter((connection) => connection.mode === "TEST");
  if (!testCapable.length) {
    if (capable.some((connection) => connection.mode === "LIVE")) throw new AppError("PERMISSION_DENIED", "Only LIVE payment gateway connections satisfy the request, but Gate C is TEST-only");
    throw new AppError("CONFLICT", "PAYMENT_GATEWAY_CONNECTION_NOT_CONFIGURED");
  }
  const locationSpecific = testCapable.filter((connection) => connection.locationId === context.locationId);
  const selectedPool = locationSpecific.length ? locationSpecific : testCapable.filter((connection) => connection.locationId === undefined);
  if (selectedPool.length !== 1) throw new AppError("CONFLICT", "PAYMENT_GATEWAY_CONNECTION_AMBIGUOUS");
  const selected = selectedPool[0];
  assertGateCTestPaymentConnection(selected);
  return selected;
}

export function validateAirenPayGatewayOperationContext(input: AirenPayGatewayOperationContextV1): AirenPayGatewayOperationContextV1 {
  nonEmpty(input.orchestrationId, "orchestration_id");
  const correlationId = nonEmpty(input.correlationId, "correlation_id");
  const idempotencyKey = nonEmpty(input.idempotencyKey, "idempotency_key");
  if (idempotencyKey.length > 200) throw new AppError("VALIDATION_FAILED", "idempotency_key exceeds 200 characters");
  const connection = validateTenantPaymentGatewayConnection(input.connection);
  assertGateCTestPaymentConnection(connection);
  return Object.freeze({ orchestrationId: input.orchestrationId, correlationId, idempotencyKey, connection });
}

export function validateAirenPayOrchestrationTransition(fromStatus: AirenPayOrchestrationStatus, toStatus: AirenPayOrchestrationStatus): void {
  if (!AIRENPAY_ORCHESTRATION_STATUSES.includes(fromStatus) || !AIRENPAY_ORCHESTRATION_STATUSES.includes(toStatus)) {
    throw new AppError("VALIDATION_FAILED", "Unknown AIRenPay orchestration status");
  }
  if (!AIRENPAY_ORCHESTRATION_ALLOWED_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new AppError("CONFLICT", `AIRenPay transition ${fromStatus} -> ${toStatus} is not allowed`);
  }
}

function validateProviderMetadata(metadata: Readonly<Record<string, string | number | boolean | null>> | undefined): void {
  if (!metadata) return;
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEY.test(key)) throw new AppError("VALIDATION_FAILED", "Sensitive provider metadata is forbidden in AIRenPay normalized evidence");
    if (typeof value === "string" && value.length > 2048) throw new AppError("VALIDATION_FAILED", "Provider metadata string exceeds diagnostic limit");
  }
}

export function validateAirenPayWebhookRequest(input: AirenPayWebhookRequestV1): AirenPayWebhookRequestV1 {
  nonEmpty(input.connectionId, "connection_id");
  if (!(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0) throw new AppError("VALIDATION_FAILED", "Webhook raw body is required");
  if (input.rawBody.byteLength > 256 * 1024) throw new AppError("VALIDATION_FAILED", "Webhook raw body exceeds 256 KiB");
  validIsoInstant(input.receivedAt, "received_at");
  return input;
}

export function validateAirenPayNormalizedWebhookEvent(input: AirenPayNormalizedWebhookEventV1): AirenPayNormalizedWebhookEventV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("VALIDATION_FAILED", "Normalized webhook event must be an object");
  rejectClientScopeSpoof(input);
  nonEmpty(input.providerEventId, "provider_event_id");
  nonEmpty(input.providerReference, "provider_reference");
  if (!AIRENPAY_NORMALIZED_WEBHOOK_EVENTS.includes(input.eventType)) throw new AppError("VALIDATION_FAILED", "Unknown normalized webhook event type");
  if (!AIRENPAY_ORCHESTRATION_STATUSES.includes(input.status)) throw new AppError("VALIDATION_FAILED", "Unknown normalized AIRenPay status");
  validIsoInstant(input.occurredAt, "occurred_at");
  if (input.amount) validateAirenPayMoney(input.amount);
  if (input.authorizationExpiresAt) validIsoInstant(input.authorizationExpiresAt, "authorization_expires_at");
  validateProviderMetadata(input.providerMetadata);
  return input;
}
