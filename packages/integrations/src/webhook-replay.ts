import { createHash } from "node:crypto";

export const WEBHOOK_PROCESSING_FAILURE_REASON = "WEBHOOK_PROCESSING_FAILED" as const;

export type ProviderWebhookRequest = Readonly<{
  rawBody: string | Uint8Array;
  headers: Readonly<Record<string, string | undefined>>;
}>;

export type VerifiedProviderWebhookEvent = Readonly<{
  providerEventId: string;
  eventType: string;
  providerPayload: unknown;
}>;

export type WebhookSignatureVerifier = Readonly<{
  verify(request: ProviderWebhookRequest): Promise<VerifiedProviderWebhookEvent>;
}>;

export type WebhookReplayReservationStatus =
  | "new"
  | "duplicate_processed"
  | "duplicate_failed"
  | "duplicate_in_flight"
  | "conflict";

export type WebhookReconcileClaimStatus =
  | "reconcile_claimed"
  | "duplicate_processed"
  | "duplicate_in_flight"
  | "conflict"
  | "missing"
  | "failed_unclaimed";

export type WebhookReplayStore = Readonly<{
  reserve(input: Readonly<{
    providerKey: string;
    providerEventId: string;
    eventType: string;
    payloadDigest: string;
    receivedAt: string;
  }>): Promise<Readonly<{ receiptId: string; status: WebhookReplayReservationStatus; attemptCount: number }>>;
  markProcessed(receiptId: string, processedAt: string): Promise<boolean>;
  markFailed(receiptId: string): Promise<boolean>;
  claimFailed(input: Readonly<{
    providerKey: string;
    providerEventId: string;
    payloadDigest: string;
    attemptedAt: string;
  }>): Promise<Readonly<{ receiptId: string | null; status: WebhookReconcileClaimStatus; attemptCount: number }>>;
}>;

export type ProviderWebhookHandler = (
  event: VerifiedProviderWebhookEvent
) => Promise<void>;

export type WebhookFrameworkDependencies = Readonly<{
  providerKey: string;
  verifier: WebhookSignatureVerifier;
  replayStore: WebhookReplayStore;
  handler: ProviderWebhookHandler;
  now?: () => string;
}>;

export type WebhookReceiveResult = Readonly<{
  status: "processed" | "duplicate_acknowledged";
  receiptId: string;
  providerEventId: string;
  attemptCount: number;
}>;

function requireConfiguration(condition: boolean, detail: string): void {
  if (!condition) throw new Error(`WEBHOOK_CONFIGURATION_INVALID: ${detail}`);
}

function validateProviderKey(providerKey: string): void {
  requireConfiguration(/^[a-z0-9][a-z0-9._-]{0,63}$/.test(providerKey), "providerKey is invalid");
}

function validateVerifiedEvent(event: VerifiedProviderWebhookEvent): void {
  requireConfiguration(
    typeof event.providerEventId === "string" && event.providerEventId.trim().length >= 1 && event.providerEventId.length <= 240,
    "verified providerEventId is invalid"
  );
  requireConfiguration(
    typeof event.eventType === "string" && event.eventType.trim().length >= 1 && event.eventType.length <= 240,
    "verified eventType is invalid"
  );
}

function bodyBytes(rawBody: string | Uint8Array): Uint8Array {
  return typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Uint8Array.from(rawBody);
}

export function digestProviderWebhookBody(rawBody: string | Uint8Array): string {
  return createHash("sha256").update(bodyBytes(rawBody)).digest("hex");
}

async function verifySanitized(
  verifier: WebhookSignatureVerifier,
  request: ProviderWebhookRequest
): Promise<VerifiedProviderWebhookEvent> {
  try {
    const verified = await verifier.verify(
      Object.freeze({
        rawBody: typeof request.rawBody === "string" ? request.rawBody : Uint8Array.from(request.rawBody),
        headers: Object.freeze({ ...request.headers })
      })
    );
    validateVerifiedEvent(verified);
    return Object.freeze({ ...verified });
  } catch {
    throw new Error("WEBHOOK_SIGNATURE_INVALID");
  }
}

async function executeHandler(
  dependencies: WebhookFrameworkDependencies,
  event: VerifiedProviderWebhookEvent,
  receiptId: string,
  processedAt: string
): Promise<void> {
  try {
    await dependencies.handler(event);
  } catch {
    const marked = await dependencies.replayStore.markFailed(receiptId);
    if (!marked) throw new Error("WEBHOOK_RECEIPT_TRANSITION_FAILED");
    throw new Error(WEBHOOK_PROCESSING_FAILURE_REASON);
  }

  const marked = await dependencies.replayStore.markProcessed(receiptId, processedAt);
  if (!marked) throw new Error("WEBHOOK_RECEIPT_TRANSITION_FAILED");
}

/**
 * RST-F-INT-004 — provider-neutral verified callback ingress.
 * Order is intentionally strict: verify signature -> replay reservation -> handler -> terminal receipt transition.
 * providerKey is server configuration. Provider body/header values never grant Tenant, Location, role or financial authority.
 */
export async function receiveProviderWebhook(
  dependencies: WebhookFrameworkDependencies,
  request: ProviderWebhookRequest
): Promise<WebhookReceiveResult> {
  validateProviderKey(dependencies.providerKey);
  const event = await verifySanitized(dependencies.verifier, request);
  const payloadDigest = digestProviderWebhookBody(request.rawBody);
  const now = dependencies.now?.() ?? new Date().toISOString();

  const reservation = await dependencies.replayStore.reserve({
    providerKey: dependencies.providerKey,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    payloadDigest,
    receivedAt: now
  });

  if (reservation.status === "conflict") throw new Error("WEBHOOK_REPLAY_DIGEST_CONFLICT");
  if (reservation.status !== "new") {
    return Object.freeze({
      status: "duplicate_acknowledged",
      receiptId: reservation.receiptId,
      providerEventId: event.providerEventId,
      attemptCount: reservation.attemptCount
    });
  }

  await executeHandler(dependencies, event, reservation.receiptId, now);
  return Object.freeze({
    status: "processed",
    receiptId: reservation.receiptId,
    providerEventId: event.providerEventId,
    attemptCount: reservation.attemptCount
  });
}

/**
 * RST-F-INT-005 — explicit reconcile path. It re-verifies the signed request and can only reclaim
 * a durable FAILED receipt with the same provider key, provider event ID and raw-body digest.
 */
export async function reconcileProviderWebhook(
  dependencies: WebhookFrameworkDependencies,
  request: ProviderWebhookRequest
): Promise<WebhookReceiveResult> {
  validateProviderKey(dependencies.providerKey);
  const event = await verifySanitized(dependencies.verifier, request);
  const payloadDigest = digestProviderWebhookBody(request.rawBody);
  const now = dependencies.now?.() ?? new Date().toISOString();

  const claim = await dependencies.replayStore.claimFailed({
    providerKey: dependencies.providerKey,
    providerEventId: event.providerEventId,
    payloadDigest,
    attemptedAt: now
  });

  if (claim.status === "conflict") throw new Error("WEBHOOK_REPLAY_DIGEST_CONFLICT");
  if (claim.status === "missing") throw new Error("WEBHOOK_RECONCILE_RECEIPT_MISSING");
  if (claim.status === "failed_unclaimed") throw new Error("WEBHOOK_RECONCILE_CLAIM_FAILED");
  if (claim.status !== "reconcile_claimed") {
    return Object.freeze({
      status: "duplicate_acknowledged",
      receiptId: claim.receiptId ?? "",
      providerEventId: event.providerEventId,
      attemptCount: claim.attemptCount
    });
  }

  if (!claim.receiptId) throw new Error("WEBHOOK_RECONCILE_CLAIM_FAILED");
  await executeHandler(dependencies, event, claim.receiptId, now);
  return Object.freeze({
    status: "processed",
    receiptId: claim.receiptId,
    providerEventId: event.providerEventId,
    attemptCount: claim.attemptCount
  });
}
