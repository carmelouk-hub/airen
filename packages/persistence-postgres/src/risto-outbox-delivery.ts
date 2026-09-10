import { Pool, type PoolClient } from "pg";
import type {
  OutboxDeliveryMessage,
  OutboxDeliveryStore
} from "../../integrations/src/outbox-delivery.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function outboxMessageFromRow(row: Record<string, unknown>): OutboxDeliveryMessage {
  return Object.freeze({
    id: String(row.id),
    ...(row.tenantId == null ? {} : { tenantId: String(row.tenantId) }),
    ...(row.locationId == null ? {} : { locationId: String(row.locationId) }),
    eventType: String(row.eventType),
    aggregateType: String(row.aggregateType),
    aggregateId: String(row.aggregateId),
    payloadVersion: Number(row.payloadVersion),
    payload: Object.freeze(structuredClone((row.payload ?? {}) as Record<string, unknown>)),
    correlationId: String(row.correlationId),
    attemptCount: Number(row.attemptCount)
  });
}

export class PostgresOutboxDeliveryStore implements OutboxDeliveryStore {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_outbox_worker") {
    this.pool = pool;
    this.assumeRole = assertRoleIdentifier(assumeRole);
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${this.assumeRole}`);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimNext(): Promise<OutboxDeliveryMessage | null> {
    return this.transaction(async (client) => {
      const result = await client.query(
        `SELECT id::text AS id,
                tenant_id::text AS "tenantId",
                location_id::text AS "locationId",
                event_type AS "eventType",
                aggregate_type AS "aggregateType",
                aggregate_id AS "aggregateId",
                payload_version AS "payloadVersion",
                payload,
                correlation_id AS "correlationId",
                attempt_count AS "attemptCount"
           FROM events.claim_next_outbox_event()`
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? outboxMessageFromRow(row) : null;
    });
  }

  async markDelivered(messageId: string, deliveredAtIso: string): Promise<void> {
    await this.transaction(async (client) => {
      const result = await client.query(
        `SELECT events.mark_outbox_event_delivered($1::uuid, $2::timestamptz) AS changed`,
        [messageId, deliveredAtIso]
      );
      if (result.rows[0]?.changed !== true) {
        throw new Error("OUTBOX_STATE_CONFLICT: delivery acknowledgement rejected");
      }
    });
  }

  async markFailed(
    messageId: string,
    outcome: Readonly<{ terminal: boolean; reasonCode: "ADAPTER_DELIVERY_FAILED" }>
  ): Promise<void> {
    if (outcome.reasonCode !== "ADAPTER_DELIVERY_FAILED") {
      throw new Error("OUTBOX_FAILURE_REASON_REJECTED");
    }
    await this.transaction(async (client) => {
      const result = await client.query(
        `SELECT events.mark_outbox_event_failed($1::uuid, $2::boolean) AS changed`,
        [messageId, outcome.terminal]
      );
      if (result.rows[0]?.changed !== true) {
        throw new Error("OUTBOX_STATE_CONFLICT: failure acknowledgement rejected");
      }
    });
  }
}
