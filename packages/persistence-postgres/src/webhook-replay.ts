import type { Pool } from "pg";
import type {
  WebhookReplayReservationStatus,
  WebhookReconcileClaimStatus,
  WebhookReplayStore
} from "../../integrations/src/webhook-replay.ts";

export class PostgresWebhookReplayStore implements WebhookReplayStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async reserve(input: Readonly<{
    providerKey: string;
    providerEventId: string;
    eventType: string;
    payloadDigest: string;
    receivedAt: string;
  }>): Promise<Readonly<{ receiptId: string; status: WebhookReplayReservationStatus; attemptCount: number }>> {
    const result = await this.pool.query(
      `SELECT receipt_id::text AS "receiptId",
              reservation_status AS status,
              attempt_count AS "attemptCount"
         FROM events.reserve_provider_webhook_receipt($1,$2,$3,$4,$5::timestamptz)`,
      [input.providerKey, input.providerEventId, input.eventType, input.payloadDigest, input.receivedAt]
    );
    if (result.rowCount !== 1) throw new Error("WEBHOOK_REPLAY_RESERVATION_FAILED");
    return Object.freeze({
      receiptId: String(result.rows[0].receiptId),
      status: String(result.rows[0].status) as WebhookReplayReservationStatus,
      attemptCount: Number(result.rows[0].attemptCount)
    });
  }

  async markProcessed(receiptId: string, processedAt: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT events.mark_provider_webhook_processed($1::uuid,$2::timestamptz) AS changed`,
      [receiptId, processedAt]
    );
    return result.rows[0]?.changed === true;
  }

  async markFailed(receiptId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT events.mark_provider_webhook_failed($1::uuid) AS changed`,
      [receiptId]
    );
    return result.rows[0]?.changed === true;
  }

  async claimFailed(input: Readonly<{
    providerKey: string;
    providerEventId: string;
    payloadDigest: string;
    attemptedAt: string;
  }>): Promise<Readonly<{ receiptId: string | null; status: WebhookReconcileClaimStatus; attemptCount: number }>> {
    const result = await this.pool.query(
      `SELECT receipt_id::text AS "receiptId",
              claim_status AS status,
              attempt_count AS "attemptCount"
         FROM events.claim_provider_webhook_reconcile($1,$2,$3,$4::timestamptz)`,
      [input.providerKey, input.providerEventId, input.payloadDigest, input.attemptedAt]
    );
    if (result.rowCount !== 1) throw new Error("WEBHOOK_RECONCILE_CLAIM_FAILED");
    return Object.freeze({
      receiptId: result.rows[0].receiptId == null ? null : String(result.rows[0].receiptId),
      status: String(result.rows[0].status) as WebhookReconcileClaimStatus,
      attemptCount: Number(result.rows[0].attemptCount)
    });
  }
}
