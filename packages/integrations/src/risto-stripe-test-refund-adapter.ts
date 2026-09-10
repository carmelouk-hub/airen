import { AppError } from "../../shared-contracts/src/index.ts";
import type { SecretProvider } from "./index.ts";
import type { OutboxDeliveryAdapter, OutboxDeliveryMessage } from "./outbox-delivery.ts";

export const RISTO_PROVIDER_REFUND_EVENT = "RISTOAIREN_PROVIDER_REFUND_REQUESTED";
export const RISTO_STRIPE_TEST_PROVIDER_KEY = "stripe";

export type StripeTestRefundFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type StripeTestRefundAdapterOptions = Readonly<{
  secretProvider: SecretProvider;
  credentialSecretRef: Parameters<SecretProvider["resolve"]>[0];
  fetchImpl?: StripeTestRefundFetch;
  apiBaseUrl?: string;
  timeoutMs?: number;
}>;

type RefundIntent = Readonly<{
  providerSourceReference: string;
  amountMinor: number;
  currencyLower: string;
  idempotencyKey: string;
}>;

const REFUND_STATUSES = new Set(["pending", "requires_action", "succeeded", "failed", "canceled"]);

function invalid(message: string): never {
  throw new AppError("VALIDATION_FAILED", message);
}

function requiredPayloadString(payload: Readonly<Record<string, unknown>>, field: string, max = 255): string {
  const value = payload[field];
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid(`Refund dispatch ${field} is invalid`);
  return value.trim();
}

function amountMinor(value: string): number {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) invalid("Refund dispatch amount is invalid");
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) invalid("Refund dispatch amount is outside supported range");
  return Number(minor);
}

function ensureTestCredential(value: string): string {
  if (!(value.startsWith("sk_test_") || value.startsWith("rk_test_"))) {
    throw new AppError("PERMISSION_DENIED", "Stripe TEST refund adapter rejected non-TEST credential material");
  }
  return value;
}

function refundIntent(message: OutboxDeliveryMessage): RefundIntent {
  if (message.eventType !== RISTO_PROVIDER_REFUND_EVENT) invalid("Unsupported outbox event for Stripe TEST refund adapter");
  if (message.aggregateType !== "ProviderRefundSaga" || !message.aggregateId) invalid("Refund dispatch aggregate is invalid");
  if (!message.tenantId || !message.locationId) invalid("Refund dispatch trusted scope is missing");

  const providerKey = requiredPayloadString(message.payload, "providerKey", 64).toLowerCase();
  if (providerKey !== RISTO_STRIPE_TEST_PROVIDER_KEY) invalid("Refund dispatch providerKey is not Stripe");
  const providerSourceReference = requiredPayloadString(message.payload, "providerSourceReference", 255);
  if (!providerSourceReference.startsWith("pi_")) invalid("Stripe refund source must be a PaymentIntent reference");
  const amount = requiredPayloadString(message.payload, "amount", 64);
  const currency = requiredPayloadString(message.payload, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) invalid("Refund dispatch currency is invalid");
  const idempotencyKey = requiredPayloadString(message.payload, "idempotencyKey", 240);
  const expectedIdempotency = `provider-refund:${providerKey}:${requiredPayloadString(message.payload, "refundPaymentId", 64)}`;
  if (idempotencyKey !== expectedIdempotency) {
    throw new AppError("IDEMPOTENCY_CONFLICT", "Refund dispatch idempotency key does not match canonical saga identity");
  }

  return Object.freeze({
    providerSourceReference,
    amountMinor: amountMinor(amount),
    currencyLower: currency.toLowerCase(),
    idempotencyKey
  });
}

function safeProviderFailure(status: number, body: unknown): AppError {
  const stripeError = body && typeof body === "object" && "error" in body && (body as { error?: unknown }).error && typeof (body as { error: unknown }).error === "object"
    ? (body as { error: Record<string, unknown> }).error
    : undefined;
  const details: Record<string, unknown> = { provider: "stripe", mode: "TEST", httpStatus: status };
  if (typeof stripeError?.type === "string") details.providerErrorType = stripeError.type;
  if (typeof stripeError?.code === "string") details.providerErrorCode = stripeError.code;
  if (status === 401 || status === 403) return new AppError("AUTHENTICATION_REQUIRED", "Stripe TEST refund provider rejected authentication/authorization", details);
  if (status === 409) return new AppError("CONFLICT", "Stripe TEST refund provider reported a conflict", details);
  if (status >= 400 && status < 500) return new AppError("VALIDATION_FAILED", "Stripe TEST refund provider rejected the request", details);
  return new AppError("INTERNAL_ERROR", "Stripe TEST refund provider request failed", details);
}

function validateRefundResponse(value: unknown, intent: RefundIntent): void {
  if (!value || typeof value !== "object") throw new AppError("INTERNAL_ERROR", "Stripe TEST refund response is invalid");
  const refund = value as Record<string, unknown>;
  if (typeof refund.id !== "string" || !refund.id.startsWith("re_")) throw new AppError("INTERNAL_ERROR", "Stripe TEST refund reference is invalid");
  if (typeof refund.status !== "string" || !REFUND_STATUSES.has(refund.status)) throw new AppError("INTERNAL_ERROR", "Stripe TEST refund status is unsupported");
  if (refund.livemode === true) throw new AppError("PERMISSION_DENIED", "Stripe LIVE refund response rejected by TEST-only adapter");
  if (refund.payment_intent !== intent.providerSourceReference) throw new AppError("CONFLICT", "Stripe TEST refund response source does not match canonical intent");
  if (!Number.isSafeInteger(refund.amount) || refund.amount !== intent.amountMinor) throw new AppError("CONFLICT", "Stripe TEST refund response amount does not match canonical intent");
  if (typeof refund.currency !== "string" || refund.currency.toLowerCase() !== intent.currencyLower) throw new AppError("CONFLICT", "Stripe TEST refund response currency does not match canonical intent");
}

export class RistoStripeTestRefundAdapter implements OutboxDeliveryAdapter {
  private readonly secretProvider: SecretProvider;
  private readonly credentialSecretRef: Parameters<SecretProvider["resolve"]>[0];
  private readonly fetchImpl: StripeTestRefundFetch;
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: StripeTestRefundAdapterOptions) {
    this.secretProvider = options.secretProvider;
    this.credentialSecretRef = options.credentialSecretRef;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.stripe.com/v1").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 60_000) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Stripe TEST refund timeoutMs is invalid");
    }
  }

  async deliver(message: OutboxDeliveryMessage): Promise<void> {
    const intent = refundIntent(message);
    const secret = await this.secretProvider.resolve(this.credentialSecretRef);
    await secret.use(async rawCredential => {
      const credential = ensureTestCredential(rawCredential);
      const body = new URLSearchParams();
      body.set("payment_intent", intent.providerSourceReference);
      body.set("amount", String(intent.amountMinor));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.apiBaseUrl}/refunds`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${credential}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": intent.idempotencyKey
          },
          body: body.toString()
        });
        const text = await response.text();
        let parsed: unknown = null;
        if (text) {
          try { parsed = JSON.parse(text); }
          catch { throw new AppError("INTERNAL_ERROR", "Stripe TEST refund provider returned non-JSON response", { provider: "stripe", mode: "TEST", httpStatus: response.status }); }
        }
        if (!response.ok) throw safeProviderFailure(response.status, parsed);
        validateRefundResponse(parsed, intent);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new AppError("INTERNAL_ERROR", "Stripe TEST refund provider request timed out", { provider: "stripe", mode: "TEST" });
        }
        throw new AppError("INTERNAL_ERROR", "Stripe TEST refund provider request failed", { provider: "stripe", mode: "TEST" });
      } finally {
        clearTimeout(timer);
      }
    });
  }
}
