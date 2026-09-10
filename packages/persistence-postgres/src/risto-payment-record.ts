import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent, SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  OrderForPayment,
  PaymentForRecord,
  PaymentRecordTransaction
} from "../../ristoairen/src/pos/payment-record.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function paymentFromRow(row: Record<string, unknown>): PaymentForRecord {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    locationId: String(row.locationId),
    orderId: String(row.orderId),
    paymentMethod: String(row.paymentMethod) as PaymentForRecord["paymentMethod"],
    amount: String(row.amount),
    currency: String(row.currency),
    status: String(row.status),
    ...(row.providerReference == null ? {} : { providerReference: String(row.providerReference) }),
    receivedAt: new Date(String(row.receivedAt)).toISOString(),
    recordedBy: String(row.recordedBy),
    idempotencyKey: String(row.idempotencyKey),
    metadataSanitized: Object.freeze((row.metadataSanitized ?? {}) as Record<string, unknown>),
    rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass)
  });
}

export class PostgresPaymentRecordTransaction implements PaymentRecordTransaction {
  private readonly client: PoolClient;
  private readonly context: SecurityContext;

  constructor(client: PoolClient, context: SecurityContext) {
    this.client = client;
    this.context = context;
  }

  async getOrderForPayment(orderId: string): Promise<OrderForPayment | null> {
    // Serialize all settlement decisions for one Order without granting UPDATE on Order rows.
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`risto:payment:order:${orderId}`]
    );
    const result = await this.client.query(
      `SELECT id::text AS id,
              tenant_id::text AS "tenantId",
              location_id::text AS "locationId",
              currency,
              trim_scale(total)::text AS total,
              version AS "rowVersion",
              environment_class AS "environmentClass"
         FROM ristoairen.orders
        WHERE id = $1::uuid`,
      [orderId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return Object.freeze({
      id: String(row.id),
      tenantId: String(row.tenantId),
      locationId: String(row.locationId),
      currency: String(row.currency),
      total: String(row.total),
      rowVersion: Number(row.rowVersion),
      environmentClass: String(row.environmentClass)
    });
  }

  async findPaymentByIdempotencyKey(idempotencyKey: string): Promise<PaymentForRecord | null> {
    // Serialize retry races before the first read. The database unique key is the second line of defence.
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`risto:payment:idem:${this.context.tenantId}:${this.context.locationId}:${idempotencyKey}`]
    );
    const result = await this.client.query(
      `SELECT id::text AS id,
              tenant_id::text AS "tenantId",
              location_id::text AS "locationId",
              order_id::text AS "orderId",
              payment_method AS "paymentMethod",
              amount::text AS amount,
              currency,
              status,
              provider_reference AS "providerReference",
              received_at AS "receivedAt",
              recorded_by::text AS "recordedBy",
              idempotency_key AS "idempotencyKey",
              metadata_sanitized AS "metadataSanitized",
              row_version AS "rowVersion",
              environment_class AS "environmentClass"
         FROM ristoairen.payments
        WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    return result.rows[0] ? paymentFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async listEffectivePaymentsForOrder(orderId: string): Promise<readonly PaymentForRecord[]> {
    // RECORDED is the only local-ledger effective state certified by MAT-012/013/014.
    // Provider capture/refund states stay outside this gate until separately frozen.
    const result = await this.client.query(
      `SELECT id::text AS id,
              tenant_id::text AS "tenantId",
              location_id::text AS "locationId",
              order_id::text AS "orderId",
              payment_method AS "paymentMethod",
              amount::text AS amount,
              currency,
              status,
              provider_reference AS "providerReference",
              received_at AS "receivedAt",
              recorded_by::text AS "recordedBy",
              idempotency_key AS "idempotencyKey",
              metadata_sanitized AS "metadataSanitized",
              row_version AS "rowVersion",
              environment_class AS "environmentClass"
         FROM ristoairen.payments
        WHERE order_id = $1::uuid
          AND status = 'RECORDED'
          AND refund_of_payment_id IS NULL
        ORDER BY received_at, id`,
      [orderId]
    );
    return Object.freeze(result.rows.map((row) => paymentFromRow(row as Record<string, unknown>)));
  }

  async insertPayment(payment: Omit<PaymentForRecord, "id">): Promise<PaymentForRecord> {
    const result = await this.client.query(
      `INSERT INTO ristoairen.payments
        (tenant_id, location_id, order_id, payment_method, amount, currency, status,
         provider_reference, received_at, recorded_by, idempotency_key,
         metadata_sanitized, row_version, environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::numeric,$6,$7,$8,$9::timestamptz,$10::uuid,$11,$12::jsonb,$13,$14)
       RETURNING id::text AS id,
                 tenant_id::text AS "tenantId",
                 location_id::text AS "locationId",
                 order_id::text AS "orderId",
                 payment_method AS "paymentMethod",
                 amount::text AS amount,
                 currency,
                 status,
                 provider_reference AS "providerReference",
                 received_at AS "receivedAt",
                 recorded_by::text AS "recordedBy",
                 idempotency_key AS "idempotencyKey",
                 metadata_sanitized AS "metadataSanitized",
                 row_version AS "rowVersion",
                 environment_class AS "environmentClass"`,
      [
        payment.tenantId,
        payment.locationId,
        payment.orderId,
        payment.paymentMethod,
        payment.amount,
        payment.currency,
        payment.status,
        payment.providerReference ?? null,
        payment.receivedAt,
        payment.recordedBy,
        payment.idempotencyKey,
        JSON.stringify(payment.metadataSanitized),
        payment.rowVersion,
        payment.environmentClass
      ]
    );
    return paymentFromRow(result.rows[0] as Record<string, unknown>);
  }

  async audit(record: AuditRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_events
        (tenant_id, location_id, actor_identity_id, actor_kind, action_key,
         resource_type, resource_id, correlation_id, outcome, metadata)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'user',$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        record.tenantId,
        record.locationId,
        record.actorIdentityId,
        record.actionKey,
        record.resourceType ?? null,
        record.resourceId ?? null,
        record.correlationId,
        record.outcome,
        JSON.stringify(record.metadata ?? {})
      ]
    );
  }

  async outbox(event: DomainEvent & { tenantId: string; locationId: string; correlationId: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO events.outbox_events
        (tenant_id, location_id, event_type, aggregate_type, aggregate_id,
         payload_version, payload, correlation_id)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        event.tenantId,
        event.locationId,
        event.eventType,
        event.aggregateType,
        event.aggregateId,
        event.payloadVersion,
        JSON.stringify(event.payload),
        event.correlationId
      ]
    );
  }
}

export class PostgresPaymentRecordUnitOfWork implements UnitOfWork<PaymentRecordTransaction> {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: PaymentRecordTransaction) => Promise<T>, context?: SecurityContext): Promise<T> {
    if (!context) throw new Error("SecurityContext is required for RISTOAIREN payment mutations");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
      );
      const result = await fn(new PostgresPaymentRecordTransaction(client, context));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
