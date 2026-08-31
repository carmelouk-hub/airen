import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../shared-contracts/src/index.ts";
import type { TenantPaymentGatewayConnectionProjectionV1 } from "../../ristoairen/src/airenpay/index.ts";
import type { SecretProvider } from "./index.ts";
import type {
  StripeAirenPayTestClientFactory,
  StripeAirenPayTestClientPort,
  StripePaymentIntentProjection,
  StripePaymentIntentStatus,
  StripeRefundProjection,
  StripeRefundStatus,
  StripeRequestOptions,
  StripeSetupIntentProjection,
  StripeSetupIntentStatus,
  StripeVerifiedWebhookProjection
} from "./stripe-airenpay-test-adapter.ts";

export type StripeAirenPayFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type StripeAirenPayTestHttpClientFactoryOptions = Readonly<{
  secretProvider: SecretProvider;
  fetchImpl?: StripeAirenPayFetch;
  apiBaseUrl?: string;
  timeoutMs?: number;
  webhookToleranceSeconds?: number;
  now?: () => number;
}>;

export type StripeRefundReadbackProjection = StripeRefundProjection & Readonly<{
  chargeId: string;
}>;

const SETUP_STATUSES = new Set<StripeSetupIntentStatus>([
  "requires_payment_method", "requires_confirmation", "requires_action", "processing", "canceled", "succeeded"
]);
const PAYMENT_STATUSES = new Set<StripePaymentIntentStatus>([
  "requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled", "succeeded"
]);
const REFUND_STATUSES = new Set<StripeRefundStatus>(["pending", "requires_action", "succeeded", "failed", "canceled"]);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.length) throw new AppError("INTERNAL_ERROR", `Stripe response missing ${field}`);
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new AppError("INTERNAL_ERROR", `Stripe response missing ${field}`);
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new AppError("INTERNAL_ERROR", `Stripe response has invalid ${field}`);
  return value as number;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function setupProjection(value: unknown): StripeSetupIntentProjection {
  if (!value || typeof value !== "object") throw new AppError("INTERNAL_ERROR", "Stripe SetupIntent response is invalid");
  const input = value as Record<string, unknown>;
  const status = requiredString(input.status, "SetupIntent.status") as StripeSetupIntentStatus;
  if (!SETUP_STATUSES.has(status)) throw new AppError("INTERNAL_ERROR", "Stripe SetupIntent status is unsupported");
  return Object.freeze({
    id: requiredString(input.id, "SetupIntent.id"),
    status,
    clientSecret: optionalString(input.client_secret),
    livemode: requiredBoolean(input.livemode, "SetupIntent.livemode")
  });
}

function paymentProjection(value: unknown): StripePaymentIntentProjection {
  if (!value || typeof value !== "object") throw new AppError("INTERNAL_ERROR", "Stripe PaymentIntent response is invalid");
  const input = value as Record<string, unknown>;
  const status = requiredString(input.status, "PaymentIntent.status") as StripePaymentIntentStatus;
  if (!PAYMENT_STATUSES.has(status)) throw new AppError("INTERNAL_ERROR", "Stripe PaymentIntent status is unsupported");
  return Object.freeze({
    id: requiredString(input.id, "PaymentIntent.id"),
    status,
    clientSecret: optionalString(input.client_secret),
    amount: requiredInteger(input.amount, "PaymentIntent.amount"),
    currency: requiredString(input.currency, "PaymentIntent.currency"),
    amountCapturable: optionalInteger(input.amount_capturable),
    livemode: requiredBoolean(input.livemode, "PaymentIntent.livemode")
  });
}

function refundProjection(value: unknown): StripeRefundReadbackProjection {
  if (!value || typeof value !== "object") throw new AppError("INTERNAL_ERROR", "Stripe Refund response is invalid");
  const input = value as Record<string, unknown>;
  const status = requiredString(input.status, "Refund.status") as StripeRefundStatus;
  if (!REFUND_STATUSES.has(status)) throw new AppError("INTERNAL_ERROR", "Stripe Refund status is unsupported");
  if (input.livemode === true) throw new AppError("PERMISSION_DENIED", "Stripe LIVE Refund rejected by TEST-only HTTP client");
  if (input.livemode !== undefined && typeof input.livemode !== "boolean") {
    throw new AppError("INTERNAL_ERROR", "Stripe Refund response has invalid livemode");
  }
  return Object.freeze({
    id: requiredString(input.id, "Refund.id"),
    status,
    paymentIntentId: requiredString(input.payment_intent, "Refund.payment_intent"),
    chargeId: requiredString(input.charge, "Refund.charge"),
    amount: requiredInteger(input.amount, "Refund.amount"),
    currency: requiredString(input.currency, "Refund.currency"),
    // Stripe's real Refund response does not expose livemode. This projection is TEST-only
    // because factory connection mode and credential material are both fail-closed before I/O.
    livemode: false
  });
}

function ensureTestCredential(value: string): string {
  if (!(value.startsWith("sk_test_") || value.startsWith("rk_test_"))) {
    throw new AppError("PERMISSION_DENIED", "Stripe AIRenPay TEST client rejected non-TEST credential material");
  }
  return value;
}

function formBody(entries: readonly [string, string | number | boolean | undefined][]): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of entries) if (value !== undefined) body.append(key, String(value));
  return body;
}

function metadataEntries(metadata: Readonly<Record<string, string>>): [string, string][] {
  return Object.entries(metadata).map(([key, value]) => [`metadata[${key}]`, value]);
}

function safeStripeError(status: number, body: unknown): AppError {
  const error = body && typeof body === "object" && "error" in body && (body as { error?: unknown }).error && typeof (body as { error: unknown }).error === "object"
    ? (body as { error: Record<string, unknown> }).error
    : undefined;
  const details: Record<string, unknown> = { provider: "stripe", httpStatus: status };
  if (typeof error?.type === "string") details.providerErrorType = error.type;
  if (typeof error?.code === "string") details.providerErrorCode = error.code;
  if (typeof error?.decline_code === "string") details.providerDeclineCode = error.decline_code;
  if (status === 401 || status === 403) return new AppError("AUTHENTICATION_REQUIRED", "Stripe TEST provider rejected authentication/authorization", details);
  if (status === 409) return new AppError("CONFLICT", "Stripe TEST provider reported a conflict", details);
  if (status >= 400 && status < 500) return new AppError("VALIDATION_FAILED", "Stripe TEST provider rejected the request", details);
  return new AppError("INTERNAL_ERROR", "Stripe TEST provider request failed", details);
}

function parseSignature(header: string): { timestamp: number; v1: string[] } {
  let timestamp: number | undefined;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && /^\d+$/.test(value ?? "")) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/i.test(value ?? "")) v1.push(value!.toLowerCase());
  }
  if (!Number.isSafeInteger(timestamp) || !v1.length) throw new AppError("VALIDATION_FAILED", "Stripe-Signature header is malformed");
  return { timestamp: timestamp!, v1 };
}

function constantTimeHexEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifiedWebhookProjection(value: unknown): StripeVerifiedWebhookProjection {
  if (!value || typeof value !== "object") throw new AppError("VALIDATION_FAILED", "Stripe webhook event is invalid");
  const event = value as Record<string, unknown>;
  const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : undefined;
  const object = data?.object && typeof data.object === "object" ? data.object as Record<string, unknown> : undefined;
  if (!object) throw new AppError("VALIDATION_FAILED", "Stripe webhook event object is missing");
  const type = requiredString(event.type, "Event.type");
  let providerReference: string;
  let amount: number | undefined;
  let currency: string | undefined;
  if (type === "charge.refunded") {
    providerReference = requiredString(object.payment_intent, "Charge.payment_intent");
    amount = optionalInteger(object.amount_refunded);
    currency = optionalString(object.currency);
  } else {
    providerReference = requiredString(object.id, "Event.data.object.id");
    amount = optionalInteger(object.amount);
    currency = optionalString(object.currency);
  }
  return Object.freeze({
    id: requiredString(event.id, "Event.id"),
    type,
    providerReference,
    created: requiredInteger(event.created, "Event.created"),
    livemode: requiredBoolean(event.livemode, "Event.livemode"),
    amount,
    currency
  });
}

class StripeAirenPayTestHttpClient implements StripeAirenPayTestClientPort {
  private readonly connection: TenantPaymentGatewayConnectionProjectionV1;
  private readonly secretProvider: SecretProvider;
  private readonly fetchImpl: StripeAirenPayFetch;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly webhookToleranceSeconds: number;
  private readonly now: () => number;

  constructor(connection: TenantPaymentGatewayConnectionProjectionV1, options: Required<Omit<StripeAirenPayTestHttpClientFactoryOptions, "secretProvider">> & Pick<StripeAirenPayTestHttpClientFactoryOptions, "secretProvider">) {
    this.connection = connection;
    this.secretProvider = options.secretProvider;
    this.fetchImpl = options.fetchImpl;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs;
    this.webhookToleranceSeconds = options.webhookToleranceSeconds;
    this.now = options.now;
  }

  private async request(path: string, method: "GET" | "POST", body?: URLSearchParams, options?: StripeRequestOptions): Promise<unknown> {
    const secret = await this.secretProvider.resolve(this.connection.credentialSecretRef);
    return secret.use(async rawCredential => {
      const credential = ensureTestCredential(rawCredential);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${credential}`,
            ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
            ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
          },
          body: body?.toString()
        });
        const text = await response.text();
        let parsed: unknown = null;
        if (text.length) {
          try { parsed = JSON.parse(text); }
          catch { throw new AppError("INTERNAL_ERROR", "Stripe TEST provider returned non-JSON response", { provider: "stripe", httpStatus: response.status }); }
        }
        if (!response.ok) throw safeStripeError(response.status, parsed);
        return parsed;
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Error && error.name === "AbortError") throw new AppError("INTERNAL_ERROR", "Stripe TEST provider request timed out", { provider: "stripe" });
        throw new AppError("INTERNAL_ERROR", "Stripe TEST provider request failed", { provider: "stripe" });
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  async createSetupIntent(params: Parameters<StripeAirenPayTestClientPort["createSetupIntent"]>[0], options: StripeRequestOptions): Promise<StripeSetupIntentProjection> {
    const body = formBody([
      ["usage", params.usage],
      ["automatic_payment_methods[enabled]", params.automaticPaymentMethods.enabled],
      ...metadataEntries(params.metadata)
    ]);
    return setupProjection(await this.request("/setup_intents", "POST", body, options));
  }

  async createPaymentIntent(params: Parameters<StripeAirenPayTestClientPort["createPaymentIntent"]>[0], options: StripeRequestOptions): Promise<StripePaymentIntentProjection> {
    const body = formBody([
      ["amount", params.amount], ["currency", params.currency], ["capture_method", params.captureMethod],
      ["automatic_payment_methods[enabled]", params.automaticPaymentMethods.enabled], ...metadataEntries(params.metadata)
    ]);
    return paymentProjection(await this.request("/payment_intents", "POST", body, options));
  }

  async capturePaymentIntent(providerReference: string, params: Parameters<StripeAirenPayTestClientPort["capturePaymentIntent"]>[1], options: StripeRequestOptions): Promise<StripePaymentIntentProjection> {
    const body = formBody([["amount_to_capture", params.amountToCapture]]);
    return paymentProjection(await this.request(`/payment_intents/${encodeURIComponent(providerReference)}/capture`, "POST", body, options));
  }

  async cancelPaymentIntent(providerReference: string, options: StripeRequestOptions): Promise<StripePaymentIntentProjection> {
    return paymentProjection(await this.request(`/payment_intents/${encodeURIComponent(providerReference)}/cancel`, "POST", new URLSearchParams(), options));
  }

  async createRefund(params: Parameters<StripeAirenPayTestClientPort["createRefund"]>[0], options: StripeRequestOptions): Promise<StripeRefundProjection> {
    const body = formBody([["payment_intent", params.paymentIntent], ["amount", params.amount]]);
    return refundProjection(await this.request("/refunds", "POST", body, options));
  }

  async retrieveSetupIntent(providerReference: string): Promise<StripeSetupIntentProjection> {
    return setupProjection(await this.request(`/setup_intents/${encodeURIComponent(providerReference)}`, "GET"));
  }

  async retrievePaymentIntent(providerReference: string): Promise<StripePaymentIntentProjection> {
    return paymentProjection(await this.request(`/payment_intents/${encodeURIComponent(providerReference)}`, "GET"));
  }

  async retrieveRefund(refundReference: string): Promise<StripeRefundReadbackProjection> {
    return refundProjection(await this.request(`/refunds/${encodeURIComponent(refundReference)}`, "GET"));
  }

  async verifyWebhook(rawBody: Uint8Array, signature: string, connection: TenantPaymentGatewayConnectionProjectionV1): Promise<StripeVerifiedWebhookProjection> {
    if (connection.id !== this.connection.id) throw new AppError("TENANT_SCOPE_VIOLATION", "Stripe webhook connection does not match active client connection");
    if (!connection.webhookSecretRef) throw new AppError("VALIDATION_FAILED", "Stripe webhook SecretRef is required for HTTP client verification");
    const parsedSignature = parseSignature(signature);
    const nowSeconds = Math.floor(this.now() / 1000);
    if (Math.abs(nowSeconds - parsedSignature.timestamp) > this.webhookToleranceSeconds) {
      throw new AppError("VALIDATION_FAILED", "Stripe webhook timestamp is outside allowed tolerance");
    }
    const secret = await this.secretProvider.resolve(connection.webhookSecretRef);
    return secret.use(rawWebhookSecret => {
      if (!rawWebhookSecret.startsWith("whsec_")) throw new AppError("PERMISSION_DENIED", "Stripe webhook secret material is invalid");
      const expected = createHmac("sha256", rawWebhookSecret)
        .update(String(parsedSignature.timestamp))
        .update(".")
        .update(rawBody)
        .digest("hex");
      if (!parsedSignature.v1.some(candidate => constantTimeHexEqual(candidate, expected))) {
        throw new AppError("AUTHENTICATION_REQUIRED", "Stripe webhook signature verification failed");
      }
      let parsed: unknown;
      try { parsed = JSON.parse(Buffer.from(rawBody).toString("utf8")); }
      catch { throw new AppError("VALIDATION_FAILED", "Stripe webhook payload is not valid JSON"); }
      const projection = verifiedWebhookProjection(parsed);
      if (projection.livemode) throw new AppError("PERMISSION_DENIED", "Stripe LIVE webhook rejected by TEST-only HTTP client");
      return projection;
    });
  }
}

export class StripeAirenPayTestHttpClientFactory implements StripeAirenPayTestClientFactory {
  private readonly options: Required<Omit<StripeAirenPayTestHttpClientFactoryOptions, "secretProvider">> & Pick<StripeAirenPayTestHttpClientFactoryOptions, "secretProvider">;

  constructor(options: StripeAirenPayTestHttpClientFactoryOptions) {
    this.options = {
      secretProvider: options.secretProvider,
      fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      apiBaseUrl: options.apiBaseUrl ?? "https://api.stripe.com/v1",
      timeoutMs: options.timeoutMs ?? 10_000,
      webhookToleranceSeconds: options.webhookToleranceSeconds ?? 300,
      now: options.now ?? Date.now
    };
  }

  private validatedClient(connection: TenantPaymentGatewayConnectionProjectionV1): StripeAirenPayTestHttpClient {
    if (connection.providerType !== "STRIPE" || connection.mode !== "TEST" || connection.status !== "ACTIVE") {
      throw new AppError("PERMISSION_DENIED", "Stripe AIRenPay HTTP client factory accepts ACTIVE TEST Stripe connections only");
    }
    return new StripeAirenPayTestHttpClient(connection, this.options);
  }

  async forConnection(connection: TenantPaymentGatewayConnectionProjectionV1): Promise<StripeAirenPayTestClientPort> {
    return this.validatedClient(connection);
  }

  async retrieveRefundForProof(connection: TenantPaymentGatewayConnectionProjectionV1, refundReference: string): Promise<StripeRefundReadbackProjection> {
    return this.validatedClient(connection).retrieveRefund(refundReference);
  }
}
