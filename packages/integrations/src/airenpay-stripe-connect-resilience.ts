import type { WebhookFrameworkDependencies, WebhookReceiveResult } from "./webhook-replay.ts";
import { receiveProviderWebhook, reconcileProviderWebhook } from "./webhook-replay.ts";
import {
  dispatchNextOutboxMessage,
  type OutboxDeliveryResult,
  type OutboxDispatcherDependencies
} from "./outbox-delivery.ts";
import {
  AirenPayStripeConnectDirectChargeAdapter,
  type AirenPayApplicationFeePolicyV1,
  type StripeConnectDirectChargeEvidence
} from "./airenpay-stripe-connect-direct-charge.ts";
import type { AirenPayTrustedProviderConnectionV1 } from "../../airenpay/src/index.ts";

export type AirenPayConnectIdempotencyReservation = Readonly<{
  key: string;
  fingerprint: string;
  status: "NEW" | "COMPLETED" | "IN_FLIGHT" | "CONFLICT";
  result?: StripeConnectDirectChargeEvidence;
}>;

export interface AirenPayConnectIdempotencyStore {
  reserve(input: Readonly<{ key: string; fingerprint: string }>): Promise<AirenPayConnectIdempotencyReservation>;
  complete(input: Readonly<{ key: string; fingerprint: string; result: StripeConnectDirectChargeEvidence }>): Promise<void>;
}

export type AirenPayConnectResilientChargeInput = Readonly<{
  trustedConnection: AirenPayTrustedProviderConnectionV1;
  directChargeAdapter: AirenPayStripeConnectDirectChargeAdapter;
  idempotencyStore: AirenPayConnectIdempotencyStore;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  applicationFee: AirenPayApplicationFeePolicyV1;
}>;

function chargeFingerprint(input: AirenPayConnectResilientChargeInput): string {
  return JSON.stringify({
    tenantId: input.trustedConnection.gateway.tenantId,
    providerConnectionId: input.trustedConnection.gateway.id,
    providerAccountReference: input.trustedConnection.gateway.providerAccountReference,
    amountMinor: input.amountMinor,
    currency: input.currency,
    applicationFee: input.applicationFee
  });
}

export async function executeIdempotentStripeConnectDirectChargeV1(
  input: AirenPayConnectResilientChargeInput
): Promise<Readonly<{ status: "EXECUTED" | "REPLAYED"; evidence: StripeConnectDirectChargeEvidence }>> {
  if (!input.idempotencyKey.trim()) throw new Error("AIRENPAY_CONNECT_IDEMPOTENCY_KEY_REQUIRED");
  const fingerprint = chargeFingerprint(input);
  const reservation = await input.idempotencyStore.reserve({ key: input.idempotencyKey, fingerprint });

  if (reservation.status === "CONFLICT") throw new Error("AIRENPAY_CONNECT_IDEMPOTENCY_CONFLICT");
  if (reservation.status === "IN_FLIGHT") throw new Error("AIRENPAY_CONNECT_IDEMPOTENCY_IN_FLIGHT");
  if (reservation.status === "COMPLETED") {
    if (!reservation.result) throw new Error("AIRENPAY_CONNECT_IDEMPOTENCY_RESULT_MISSING");
    return Object.freeze({ status: "REPLAYED", evidence: reservation.result });
  }

  const evidence = await input.directChargeAdapter.createSandboxDirectCharge({
    trustedConnection: input.trustedConnection,
    amountMinor: input.amountMinor,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    applicationFee: input.applicationFee
  });

  await input.idempotencyStore.complete({ key: input.idempotencyKey, fingerprint, result: evidence });
  return Object.freeze({ status: "EXECUTED", evidence });
}

export async function drainConnectOutboxUntilTerminalV1(input: Readonly<{
  dependencies: OutboxDispatcherDependencies;
  maxDispatches: number;
}>): Promise<readonly OutboxDeliveryResult[]> {
  if (!Number.isInteger(input.maxDispatches) || input.maxDispatches < 1 || input.maxDispatches > 100) {
    throw new Error("AIRENPAY_CONNECT_OUTBOX_MAX_DISPATCHES_INVALID");
  }

  const results: OutboxDeliveryResult[] = [];
  for (let index = 0; index < input.maxDispatches; index += 1) {
    const result = await dispatchNextOutboxMessage(input.dependencies);
    results.push(result);
    if (result.status === "empty" || result.status === "delivered" || result.status === "dead_letter") break;
  }
  return Object.freeze(results);
}

export async function receiveOrRecoverStripeConnectWebhookV1(input: Readonly<{
  dependencies: WebhookFrameworkDependencies;
  request: Parameters<typeof receiveProviderWebhook>[1];
  recoveryRequest?: Parameters<typeof reconcileProviderWebhook>[1];
}>): Promise<Readonly<{ initial?: WebhookReceiveResult; recovered?: WebhookReceiveResult; failureCode?: string }>> {
  try {
    const initial = await receiveProviderWebhook(input.dependencies, input.request);
    return Object.freeze({ initial });
  } catch (error) {
    const failureCode = error instanceof Error ? error.message : "WEBHOOK_UNKNOWN_FAILURE";
    if (failureCode !== "WEBHOOK_PROCESSING_FAILED" || !input.recoveryRequest) {
      return Object.freeze({ failureCode });
    }
    const recovered = await reconcileProviderWebhook(input.dependencies, input.recoveryRequest);
    return Object.freeze({ failureCode, recovered });
  }
}
