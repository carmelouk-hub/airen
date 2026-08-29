import { AppError } from "../../shared-contracts/src/index.ts";
import {
  type AirenPayGatewayOperationContextV1,
  type AirenPayGatewayOperationResultV1,
  type AirenPayMoneyV1,
  type AirenPayNormalizedWebhookEventV1,
  type AirenPayOrchestrationStatus,
  type AirenPayTransactionStatusResultV1,
  type AirenPayWebhookRequestV1,
  type PaymentGatewayPort,
  type TenantPaymentGatewayConnectionProjectionV1,
  validateAirenPayGatewayOperationContext,
  validateAirenPayMoney,
  validateAirenPayNormalizedWebhookEvent,
  validateAirenPayWebhookRequest,
  validateTenantPaymentGatewayConnection
} from "../../ristoairen/src/airenpay/index.ts";

export type StripeSetupIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "canceled"
  | "succeeded";

export type StripePaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded";

export type StripeRefundStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled";

export type StripeSetupIntentProjection = Readonly<{
  id: string;
  status: StripeSetupIntentStatus;
  clientSecret?: string;
  livemode: boolean;
}>;

export type StripePaymentIntentProjection = Readonly<{
  id: string;
  status: StripePaymentIntentStatus;
  clientSecret?: string;
  amount: number;
  currency: string;
  amountCapturable?: number;
  livemode: boolean;
}>;

export type StripeRefundProjection = Readonly<{
  id: string;
  status: StripeRefundStatus;
  paymentIntentId: string;
  amount: number;
  currency: string;
  livemode: boolean;
}>;

export type StripeVerifiedWebhookProjection = Readonly<{
  id: string;
  type: string;
  providerReference: string;
  created: number;
  livemode: boolean;
  amount?: number;
  currency?: string;
}>;

export type StripeRequestOptions = Readonly<{ idempotencyKey: string }>;

export interface StripeAirenPayTestClientPort {
  createSetupIntent(
    params: Readonly<{
      usage: "off_session";
      automaticPaymentMethods: Readonly<{ enabled: true }>;
      metadata: Readonly<Record<string, string>>;
    }>,
    options: StripeRequestOptions
  ): Promise<StripeSetupIntentProjection>;

  createPaymentIntent(
    params: Readonly<{
      amount: number;
      currency: string;
      captureMethod: "automatic" | "manual";
      automaticPaymentMethods: Readonly<{ enabled: true }>;
      metadata: Readonly<Record<string, string>>;
    }>,
    options: StripeRequestOptions
  ): Promise<StripePaymentIntentProjection>;

  capturePaymentIntent(
    providerReference: string,
    params: Readonly<{ amountToCapture?: number }>,
    options: StripeRequestOptions
  ): Promise<StripePaymentIntentProjection>;

  cancelPaymentIntent(providerReference: string, options: StripeRequestOptions): Promise<StripePaymentIntentProjection>;

  createRefund(
    params: Readonly<{ paymentIntent: string; amount?: number }>,
    options: StripeRequestOptions
  ): Promise<StripeRefundProjection>;

  retrieveSetupIntent(providerReference: string): Promise<StripeSetupIntentProjection>;
  retrievePaymentIntent(providerReference: string): Promise<StripePaymentIntentProjection>;

  verifyWebhook(
    rawBody: Uint8Array,
    signature: string,
    connection: TenantPaymentGatewayConnectionProjectionV1
  ): Promise<StripeVerifiedWebhookProjection>;
}

export interface StripeAirenPayTestClientFactory {
  forConnection(connection: TenantPaymentGatewayConnectionProjectionV1): Promise<StripeAirenPayTestClientPort>;
}

function stripeConnection(input: TenantPaymentGatewayConnectionProjectionV1): TenantPaymentGatewayConnectionProjectionV1 {
  const connection = validateTenantPaymentGatewayConnection(input);
  if (connection.providerType !== "STRIPE") {
    throw new AppError("VALIDATION_FAILED", "Stripe AIRenPay adapter requires provider_type=STRIPE");
  }
  if (connection.mode !== "TEST") {
    throw new AppError("PERMISSION_DENIED", "Stripe AIRenPay Gate D adapter is TEST-only");
  }
  if (connection.status !== "ACTIVE") {
    throw new AppError("CONFLICT", "Stripe AIRenPay connection is not active");
  }
  return connection;
}

function operationContext(input: AirenPayGatewayOperationContextV1): AirenPayGatewayOperationContextV1 {
  const context = validateAirenPayGatewayOperationContext(input);
  stripeConnection(context.connection);
  return context;
}

function stripeIdempotencyKey(context: AirenPayGatewayOperationContextV1, operation: string): string {
  const key = `${context.idempotencyKey}:stripe:${operation}`;
  if (key.length > 255) throw new AppError("VALIDATION_FAILED", "Derived Stripe idempotency key exceeds 255 characters");
  return key;
}

function metadata(context: AirenPayGatewayOperationContextV1): Readonly<Record<string, string>> {
  return Object.freeze({
    airen_orchestration_id: context.orchestrationId,
    airen_correlation_id: context.correlationId
  });
}

function assertTestObject(livemode: boolean): void {
  if (livemode) throw new AppError("PERMISSION_DENIED", "Stripe LIVE object rejected by TEST-only AIRenPay adapter");
}

function clientAction(clientSecret: string | undefined, status: AirenPayOrchestrationStatus) {
  if (!clientSecret || status === "GUARANTEE_SATISFIED" || status === "CAPTURED" || status === "RELEASED" || status === "REFUNDED") return undefined;
  return Object.freeze({ kind: "CLIENT_CONFIRMATION" as const, opaqueReference: clientSecret });
}

function setupStatus(status: StripeSetupIntentStatus): AirenPayOrchestrationStatus {
  switch (status) {
    case "succeeded": return "GUARANTEE_SATISFIED";
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action": return "CUSTOMER_ACTION_REQUIRED";
    case "processing": return "PROVIDER_PENDING";
    case "canceled": return "CANCELLED";
  }
}

function paymentStatus(status: StripePaymentIntentStatus): AirenPayOrchestrationStatus {
  switch (status) {
    case "succeeded":
    case "requires_capture": return "GUARANTEE_SATISFIED";
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action": return "CUSTOMER_ACTION_REQUIRED";
    case "processing": return "PROVIDER_PENDING";
    case "canceled": return "CANCELLED";
  }
}

function refundStatus(status: StripeRefundStatus): AirenPayOrchestrationStatus {
  switch (status) {
    case "succeeded": return "REFUNDED";
    case "pending":
    case "requires_action": return "PROVIDER_PENDING";
    case "canceled": return "CANCELLED";
    case "failed": return "FAILED";
  }
}

function setupResult(intent: StripeSetupIntentProjection): AirenPayGatewayOperationResultV1 {
  assertTestObject(intent.livemode);
  const status = setupStatus(intent.status);
  return Object.freeze({
    providerReference: intent.id,
    status,
    clientAction: clientAction(intent.clientSecret, status),
    providerMetadata: Object.freeze({ stripeObject: "setup_intent", stripeStatus: intent.status, livemode: false })
  });
}

function paymentResult(intent: StripePaymentIntentProjection, overrideStatus?: AirenPayOrchestrationStatus): AirenPayGatewayOperationResultV1 {
  assertTestObject(intent.livemode);
  const status = overrideStatus ?? paymentStatus(intent.status);
  return Object.freeze({
    providerReference: intent.id,
    status,
    clientAction: clientAction(intent.clientSecret, status),
    providerMetadata: Object.freeze({ stripeObject: "payment_intent", stripeStatus: intent.status, livemode: false })
  });
}

function moneyFromPayment(intent: StripePaymentIntentProjection): AirenPayMoneyV1 {
  return Object.freeze({ amountMinor: intent.amount, currency: intent.currency.toUpperCase() });
}

function webhookEvent(input: StripeVerifiedWebhookProjection): AirenPayNormalizedWebhookEventV1 {
  assertTestObject(input.livemode);
  const occurredAt = new Date(input.created * 1000).toISOString();
  let eventType: AirenPayNormalizedWebhookEventV1["eventType"];
  let status: AirenPayOrchestrationStatus;
  switch (input.type) {
    case "setup_intent.succeeded":
      eventType = "SETUP_SUCCEEDED";
      status = "GUARANTEE_SATISFIED";
      break;
    case "payment_intent.succeeded":
      eventType = "PAYMENT_SUCCEEDED";
      status = "GUARANTEE_SATISFIED";
      break;
    case "payment_intent.amount_capturable_updated":
      eventType = "AUTHORIZATION_SUCCEEDED";
      status = "GUARANTEE_SATISFIED";
      break;
    case "payment_intent.requires_action":
      eventType = "ACTION_REQUIRED";
      status = "CUSTOMER_ACTION_REQUIRED";
      break;
    case "payment_intent.payment_failed":
      eventType = "FAILED";
      status = "FAILED";
      break;
    case "payment_intent.canceled":
      eventType = "CANCELLED";
      status = "CANCELLED";
      break;
    case "charge.refunded":
      eventType = "REFUND_SUCCEEDED";
      status = "REFUNDED";
      break;
    default:
      throw new AppError("VALIDATION_FAILED", "Unsupported Stripe webhook event for AIRenPay Gate D");
  }
  return validateAirenPayNormalizedWebhookEvent({
    providerEventId: input.id,
    providerReference: input.providerReference,
    eventType,
    status,
    occurredAt,
    amount: input.amount !== undefined && input.currency
      ? { amountMinor: input.amount, currency: input.currency.toUpperCase() }
      : undefined,
    providerMetadata: Object.freeze({ stripeEventType: input.type, livemode: false })
  });
}

export class StripeAirenPayTestAdapter implements PaymentGatewayPort {
  constructor(private readonly clients: StripeAirenPayTestClientFactory) {}

  private async client(context: AirenPayGatewayOperationContextV1): Promise<{ context: AirenPayGatewayOperationContextV1; client: StripeAirenPayTestClientPort }> {
    const validated = operationContext(context);
    return { context: validated, client: await this.clients.forConnection(stripeConnection(validated.connection)) };
  }

  async createPaymentMethodSetup(context: AirenPayGatewayOperationContextV1): Promise<AirenPayGatewayOperationResultV1> {
    const resolved = await this.client(context);
    const intent = await resolved.client.createSetupIntent({
      usage: "off_session",
      automaticPaymentMethods: Object.freeze({ enabled: true }),
      metadata: metadata(resolved.context)
    }, { idempotencyKey: stripeIdempotencyKey(resolved.context, "setup") });
    return setupResult(intent);
  }

  private async createPayment(context: AirenPayGatewayOperationContextV1, amount: AirenPayMoneyV1, captureMethod: "automatic" | "manual", operation: string) {
    const resolved = await this.client(context);
    const money = validateAirenPayMoney(amount);
    const intent = await resolved.client.createPaymentIntent({
      amount: money.amountMinor,
      currency: money.currency.toLowerCase(),
      captureMethod,
      automaticPaymentMethods: Object.freeze({ enabled: true }),
      metadata: metadata(resolved.context)
    }, { idempotencyKey: stripeIdempotencyKey(resolved.context, operation) });
    return paymentResult(intent);
  }

  createDepositPayment(context: AirenPayGatewayOperationContextV1, amount: AirenPayMoneyV1) {
    return this.createPayment(context, amount, "automatic", "deposit");
  }

  createFullPrepayment(context: AirenPayGatewayOperationContextV1, amount: AirenPayMoneyV1) {
    return this.createPayment(context, amount, "automatic", "full-prepayment");
  }

  createAuthorizationHold(context: AirenPayGatewayOperationContextV1, amount: AirenPayMoneyV1) {
    return this.createPayment(context, amount, "manual", "authorization-hold");
  }

  async captureAuthorization(context: AirenPayGatewayOperationContextV1, providerReference: string, amount?: AirenPayMoneyV1) {
    const resolved = await this.client(context);
    const money = amount ? validateAirenPayMoney(amount) : undefined;
    const intent = await resolved.client.capturePaymentIntent(providerReference, {
      amountToCapture: money?.amountMinor
    }, { idempotencyKey: stripeIdempotencyKey(resolved.context, "capture") });
    return paymentResult(intent, intent.status === "succeeded" ? "CAPTURED" : undefined);
  }

  async releaseAuthorization(context: AirenPayGatewayOperationContextV1, providerReference: string) {
    const resolved = await this.client(context);
    const intent = await resolved.client.cancelPaymentIntent(providerReference, {
      idempotencyKey: stripeIdempotencyKey(resolved.context, "release")
    });
    assertTestObject(intent.livemode);
    if (intent.status !== "canceled") throw new AppError("CONFLICT", "Stripe authorization release did not reach canceled state");
    return paymentResult(intent, "RELEASED");
  }

  async refundPayment(context: AirenPayGatewayOperationContextV1, providerReference: string, amount?: AirenPayMoneyV1) {
    const resolved = await this.client(context);
    const money = amount ? validateAirenPayMoney(amount) : undefined;
    const refund = await resolved.client.createRefund({
      paymentIntent: providerReference,
      amount: money?.amountMinor
    }, { idempotencyKey: stripeIdempotencyKey(resolved.context, "refund") });
    assertTestObject(refund.livemode);
    return Object.freeze({
      providerReference: refund.paymentIntentId,
      status: refundStatus(refund.status),
      providerMetadata: Object.freeze({ stripeObject: "refund", stripeRefundReference: refund.id, stripeStatus: refund.status, livemode: false })
    });
  }

  async getTransactionStatus(context: AirenPayGatewayOperationContextV1, providerReference: string): Promise<AirenPayTransactionStatusResultV1> {
    const resolved = await this.client(context);
    if (providerReference.startsWith("seti_")) {
      const setup = await resolved.client.retrieveSetupIntent(providerReference);
      assertTestObject(setup.livemode);
      return Object.freeze({
        providerReference: setup.id,
        status: setupStatus(setup.status),
        providerMetadata: Object.freeze({ stripeObject: "setup_intent", stripeStatus: setup.status, livemode: false })
      });
    }
    const payment = await resolved.client.retrievePaymentIntent(providerReference);
    assertTestObject(payment.livemode);
    return Object.freeze({
      providerReference: payment.id,
      status: paymentStatus(payment.status),
      amount: moneyFromPayment(payment),
      providerMetadata: Object.freeze({ stripeObject: "payment_intent", stripeStatus: payment.status, livemode: false })
    });
  }

  async verifyAndNormalizeWebhook(request: AirenPayWebhookRequestV1, connection: TenantPaymentGatewayConnectionProjectionV1): Promise<AirenPayNormalizedWebhookEventV1> {
    const validatedRequest = validateAirenPayWebhookRequest(request);
    const validatedConnection = stripeConnection(connection);
    if (validatedRequest.connectionId !== validatedConnection.id) throw new AppError("TENANT_SCOPE_VIOLATION", "Webhook connection id does not match resolved Stripe connection");
    if (!validatedConnection.webhookSecretRef && !validatedConnection.webhookConfigurationReference) {
      throw new AppError("VALIDATION_FAILED", "Stripe webhook verification material is required");
    }
    const signature = validatedRequest.headers["stripe-signature"]?.trim();
    if (!signature) throw new AppError("VALIDATION_FAILED", "Stripe-Signature header is required");
    const client = await this.clients.forConnection(validatedConnection);
    const verified = await client.verifyWebhook(validatedRequest.rawBody, signature, validatedConnection);
    return webhookEvent(verified);
  }
}
