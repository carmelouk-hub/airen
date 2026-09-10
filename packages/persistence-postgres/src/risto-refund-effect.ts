import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent, SecurityContext } from "../../shared-contracts/src/index.ts";
import type { RefundRequestRecord } from "../../ristoairen/src/pos/refund-request.ts";
import type {
  PaymentForRefundEffect,
  RefundChildPayment,
  RefundEffectTransaction
} from "../../ristoairen/src/pos/refund-effect.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function refundRequestFromRow(row: Record<string, unknown>): RefundRequestRecord {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    locationId: String(row.locationId),
    paymentId: String(row.paymentId),
    orderId: String(row.orderId),
    requestedAmount: String(row.requestedAmount),
    currency: String(row.currency),
    reason: String(row.reason),
    requestedByIdentityId: String(row.requestedByIdentityId),
    requestedAt: new Date(String(row.requestedAt)).toISOString(),
    requestIdempotencyKey: String(row.requestIdempotencyKey),
    originalPaymentRowVersion: Number(row.originalPaymentRowVersion),
    status: String(row.status) as RefundRequestRecord["status"],
    ...(row.approvedByIdentityId == null ? {} : { approvedByIdentityId: String(row.approvedByIdentityId) }),
    ...(row.approvedAt == null ? {} : { approvedAt: new Date(String(row.approvedAt)).toISOString() }),
    ...(row.rejectedByIdentityId == null ? {} : { rejectedByIdentityId: String(row.rejectedByIdentityId) }),
    ...(row.rejectedAt == null ? {} : { rejectedAt: new Date(String(row.rejectedAt)).toISOString() }),
    ...(row.rejectionReason == null ? {} : { rejectionReason: String(row.rejectionReason) }),
    rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass)
  });
}

function paymentFromRow(row: Record<string, unknown>): PaymentForRefundEffect {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    locationId: String(row.locationId),
    orderId: String(row.orderId),
    paymentMethod: String(row.paymentMethod),
    amount: String(row.amount),
    currency: String(row.currency),
    status: String(row.status),
    ...(row.providerReference == null ? {} : { providerReference: String(row.providerReference) }),
    receivedAt: new Date(String(row.receivedAt)).toISOString(),
    recordedBy: String(row.recordedBy),
    ...(row.refundOfPaymentId == null ? {} : { refundOfPaymentId: String(row.refundOfPaymentId) }),
    idempotencyKey: String(row.idempotencyKey),
    metadataSanitized: Object.freeze((row.metadataSanitized ?? {}) as Record<string, unknown>),
    rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass)
  });
}

const REFUND_REQUEST_SELECT = `SELECT id::text AS id,
  tenant_id::text AS "tenantId", location_id::text AS "locationId",
  payment_id::text AS "paymentId", order_id::text AS "orderId",
  requested_amount::text AS "requestedAmount", currency, reason,
  requested_by_identity_id::text AS "requestedByIdentityId", requested_at AS "requestedAt",
  request_idempotency_key AS "requestIdempotencyKey",
  original_payment_row_version AS "originalPaymentRowVersion", status,
  approved_by_identity_id::text AS "approvedByIdentityId", approved_at AS "approvedAt",
  rejected_by_identity_id::text AS "rejectedByIdentityId", rejected_at AS "rejectedAt",
  rejection_reason AS "rejectionReason", row_version AS "rowVersion",
  environment_class AS "environmentClass"
FROM ristoairen.refund_requests`;

const PAYMENT_SELECT = `SELECT id::text AS id,
  tenant_id::text AS "tenantId", location_id::text AS "locationId",
  order_id::text AS "orderId", payment_method AS "paymentMethod",
  amount::text AS amount, currency, status,
  provider_reference AS "providerReference", received_at AS "receivedAt",
  recorded_by::text AS "recordedBy", refund_of_payment_id::text AS "refundOfPaymentId",
  idempotency_key AS "idempotencyKey", metadata_sanitized AS "metadataSanitized",
  row_version AS "rowVersion", environment_class AS "environmentClass"
FROM ristoairen.payments`;

export class PostgresRefundEffectTransaction implements RefundEffectTransaction {
  private readonly client: PoolClient;
  private readonly context: SecurityContext;

  constructor(client: PoolClient, context: SecurityContext) {
    this.client = client;
    this.context = context;
  }

  async getRefundRequestForEffect(refundRequestId: string): Promise<RefundRequestRecord | null> {
    const result = await this.client.query(
      `${REFUND_REQUEST_SELECT} WHERE id=$1::uuid FOR UPDATE`,
      [refundRequestId]
    );
    return result.rows[0] ? refundRequestFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async getOriginalPaymentForRefundEffect(paymentId: string): Promise<PaymentForRefundEffect | null> {
    // Serialize all refund-balance decisions for one original Payment without mutating it.
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`risto:refund:effect:payment:${paymentId}`]
    );
    const result = await this.client.query(
      `${PAYMENT_SELECT}
       WHERE id=$1::uuid
         AND refund_of_payment_id IS NULL`,
      [paymentId]
    );
    return result.rows[0] ? paymentFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async findRefundEffectByIdempotencyKey(idempotencyKey: string): Promise<PaymentForRefundEffect | null> {
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`risto:refund:effect:idem:${this.context.tenantId}:${this.context.locationId}:${idempotencyKey}`]
    );
    const result = await this.client.query(
      `${PAYMENT_SELECT} WHERE idempotency_key=$1`,
      [idempotencyKey]
    );
    return result.rows[0] ? paymentFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async listRefundChildren(paymentId: string): Promise<readonly RefundChildPayment[]> {
    const result = await this.client.query(
      `SELECT id::text AS id,
              tenant_id::text AS "tenantId", location_id::text AS "locationId",
              amount::text AS amount, currency,
              refund_of_payment_id::text AS "refundOfPaymentId"
         FROM ristoairen.payments
        WHERE refund_of_payment_id=$1::uuid
        ORDER BY received_at,id`,
      [paymentId]
    );
    return Object.freeze(result.rows.map((row: Record<string, unknown>) => Object.freeze({
      id: String(row.id),
      tenantId: String(row.tenantId),
      locationId: String(row.locationId),
      amount: String(row.amount),
      currency: String(row.currency),
      refundOfPaymentId: String(row.refundOfPaymentId)
    })));
  }

  async insertCompensatingPayment(payment: Omit<PaymentForRefundEffect, "id">): Promise<PaymentForRefundEffect> {
    const result = await this.client.query(
      `INSERT INTO ristoairen.payments
       (tenant_id,location_id,order_id,payment_method,amount,currency,status,
        provider_reference,received_at,recorded_by,refund_of_payment_id,idempotency_key,
        metadata_sanitized,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::numeric,$6,$7,$8,$9::timestamptz,$10::uuid,$11::uuid,$12,$13::jsonb,$14,$15)
       RETURNING id::text AS id,
         tenant_id::text AS "tenantId", location_id::text AS "locationId",
         order_id::text AS "orderId", payment_method AS "paymentMethod",
         amount::text AS amount, currency, status,
         provider_reference AS "providerReference", received_at AS "receivedAt",
         recorded_by::text AS "recordedBy", refund_of_payment_id::text AS "refundOfPaymentId",
         idempotency_key AS "idempotencyKey", metadata_sanitized AS "metadataSanitized",
         row_version AS "rowVersion", environment_class AS "environmentClass"`,
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
        payment.refundOfPaymentId ?? null,
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
       (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
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

  async outbox(_event: DomainEvent & { tenantId: string; locationId: string; correlationId: string }): Promise<void> {
    throw new Error("REFUND_EFFECT_PROVIDER_OUTBOX_OUT_OF_SCOPE");
  }
}

export class PostgresRefundEffectUnitOfWork implements UnitOfWork<RefundEffectTransaction> {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: RefundEffectTransaction) => Promise<T>, context?: SecurityContext): Promise<T> {
    if (!context) throw new Error("SecurityContext is required for RISTOAIREN refund effect");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
      );
      const result = await fn(new PostgresRefundEffectTransaction(client, context));
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
