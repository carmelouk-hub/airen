import { AppError } from "../packages/shared-contracts/src/index.ts";
import type { SecretProvider } from "../packages/integrations/src/index.ts";
import type { TenantPaymentGatewayConnectionProjectionV1 } from "../packages/ristoairen/src/airenpay/index.ts";

export type StripeAuthorizationProofFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type StripeAuthorizationProofProjection = Readonly<{
  id: string;
  status: "requires_capture";
  livemode: false;
  amount: number;
  currency: string;
  amountCapturable: number;
}>;

export type ConfirmStripeTestAuthorizationProofInput = Readonly<{
  connection: TenantPaymentGatewayConnectionProjectionV1;
  providerReference: string;
  paymentMethodFixture: "pm_card_visa";
  idempotencyKey: string;
  secretProvider: SecretProvider;
  fetchImpl?: StripeAuthorizationProofFetch;
  apiBaseUrl?: string;
  timeoutMs?: number;
}>;

const TEST_RETURN_URL = "https://example.com/airenpay-stripe-test-authorization-proof-return";

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.length) throw new AppError("INTERNAL_ERROR", `Stripe authorization proof missing ${field}`);
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new AppError("INTERNAL_ERROR", `Stripe authorization proof missing ${field}`);
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new AppError("INTERNAL_ERROR", `Stripe authorization proof has invalid ${field}`);
  return value as number;
}

function safeStripeError(status: number, body: unknown): AppError {
  const error = body && typeof body === "object" && "error" in body && (body as { error?: unknown }).error && typeof (body as { error: unknown }).error === "object"
    ? (body as { error: Record<string, unknown> }).error
    : undefined;
  const details: Record<string, unknown> = { provider: "stripe", httpStatus: status };
  if (typeof error?.type === "string") details.providerErrorType = error.type;
  if (typeof error?.code === "string") details.providerErrorCode = error.code;
  if (typeof error?.decline_code === "string") details.providerDeclineCode = error.decline_code;
  if (status === 401 || status === 403) return new AppError("AUTHENTICATION_REQUIRED", "Stripe TEST authorization proof rejected authentication/authorization", details);
  if (status >= 400 && status < 500) return new AppError("VALIDATION_FAILED", "Stripe TEST authorization proof rejected the request", details);
  return new AppError("INTERNAL_ERROR", "Stripe TEST authorization proof request failed", details);
}

function validateBoundary(input: ConfirmStripeTestAuthorizationProofInput): void {
  if (input.connection.providerType !== "STRIPE" || input.connection.mode !== "TEST" || input.connection.status !== "ACTIVE") {
    throw new AppError("PERMISSION_DENIED", "Stripe authorization proof accepts ACTIVE TEST Stripe connections only");
  }
  if (!input.providerReference.startsWith("pi_")) {
    throw new AppError("VALIDATION_FAILED", "Stripe authorization proof requires a PaymentIntent reference");
  }
  if (input.paymentMethodFixture !== "pm_card_visa") {
    throw new AppError("PERMISSION_DENIED", "Stripe authorization proof only permits the fixed pm_card_visa TEST fixture");
  }
  if (!input.idempotencyKey.length || input.idempotencyKey.length > 255) {
    throw new AppError("VALIDATION_FAILED", "Stripe authorization proof idempotency key is invalid");
  }
}

export async function confirmStripeTestAuthorizationForProof(input: ConfirmStripeTestAuthorizationProofInput): Promise<StripeAuthorizationProofProjection> {
  validateBoundary(input);
  const secret = await input.secretProvider.resolve(input.connection.credentialSecretRef);
  return secret.use(async rawCredential => {
    if (!(rawCredential.startsWith("sk_test_") || rawCredential.startsWith("rk_test_"))) {
      throw new AppError("PERMISSION_DENIED", "Stripe authorization proof rejected non-TEST credential material");
    }

    const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const apiBaseUrl = (input.apiBaseUrl ?? "https://api.stripe.com/v1").replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
    try {
      const body = new URLSearchParams({
        payment_method: input.paymentMethodFixture,
        return_url: TEST_RETURN_URL
      });
      const response = await fetchImpl(`${apiBaseUrl}/payment_intents/${encodeURIComponent(input.providerReference)}/confirm`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${rawCredential}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": input.idempotencyKey
        },
        body: body.toString()
      });

      const text = await response.text();
      let parsed: unknown = null;
      if (text.length) {
        try { parsed = JSON.parse(text); }
        catch { throw new AppError("INTERNAL_ERROR", "Stripe TEST authorization proof returned non-JSON response", { provider: "stripe", httpStatus: response.status }); }
      }
      if (!response.ok) throw safeStripeError(response.status, parsed);
      if (!parsed || typeof parsed !== "object") throw new AppError("INTERNAL_ERROR", "Stripe TEST authorization proof response is invalid");

      const value = parsed as Record<string, unknown>;
      const id = requiredString(value.id, "PaymentIntent.id");
      const status = requiredString(value.status, "PaymentIntent.status");
      const livemode = requiredBoolean(value.livemode, "PaymentIntent.livemode");
      const amount = requiredInteger(value.amount, "PaymentIntent.amount");
      const currency = requiredString(value.currency, "PaymentIntent.currency");
      const amountCapturable = requiredInteger(value.amount_capturable, "PaymentIntent.amount_capturable");

      if (id !== input.providerReference) throw new AppError("CONFLICT", "Stripe authorization proof reference changed during confirmation");
      if (livemode) throw new AppError("PERMISSION_DENIED", "Stripe LIVE object rejected by authorization proof");
      if (status !== "requires_capture") throw new AppError("CONFLICT", "Stripe authorization proof did not reach requires_capture");
      if (amountCapturable <= 0) throw new AppError("CONFLICT", "Stripe authorization proof returned no capturable amount");

      return Object.freeze({ id, status: "requires_capture", livemode: false, amount, currency, amountCapturable });
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new AppError("INTERNAL_ERROR", "Stripe TEST authorization proof timed out", { provider: "stripe" });
      throw new AppError("INTERNAL_ERROR", "Stripe TEST authorization proof request failed", { provider: "stripe" });
    } finally {
      clearTimeout(timeout);
    }
  });
}
