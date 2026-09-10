import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent, SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  PaymentForRefundRequest,
  RefundLineagePayment,
  RefundRequestRecord,
  RefundRequestTransaction
} from "../../ristoairen/src/pos/refund-request.ts";

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

export class PostgresRefundRequestTransaction implements RefundRequestTransaction {
  private readonly client: PoolClient;
  private readonly context: SecurityContext;

  constructor(client: PoolClient, context: SecurityContext) {
    this.client = client;
    this.context = context;
  }

  async getPaymentForRefundRequest(paymentId: string): Promise<PaymentForRefundRequest | null> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`risto:refund:payment:${paymentId}`]);
    const result = await this.client.query(
      `SELECT p.id::text AS id, p.tenant_id::text AS "tenantId", p.location_id::text AS "locationId",
              p.order_id::text AS "orderId", p.payment_method AS "paymentMethod", p.amount::text AS amount,
              p.currency, p.refund_of_payment_id::text AS "refundOfPaymentId",
              p.row_version AS "rowVersion", p.environment_class AS "environmentClass"
         FROM ristoairen.payments p
         JOIN ristoairen.orders o ON o.tenant_id=p.tenant_id AND o.location_id=p.location_id AND o.id=p.order_id
        WHERE p.id=$1::uuid AND o.currency=p.currency`, [paymentId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return Object.freeze({ id:String(row.id), tenantId:String(row.tenantId), locationId:String(row.locationId), orderId:String(row.orderId), paymentMethod:String(row.paymentMethod), amount:String(row.amount), currency:String(row.currency), ...(row.refundOfPaymentId == null ? {} : { refundOfPaymentId:String(row.refundOfPaymentId) }), rowVersion:Number(row.rowVersion), environmentClass:String(row.environmentClass) });
  }

  async listRefundLineage(paymentId: string): Promise<readonly RefundLineagePayment[]> {
    const result = await this.client.query(
      `SELECT id::text AS id, tenant_id::text AS "tenantId", location_id::text AS "locationId",
              amount::text AS amount, currency, refund_of_payment_id::text AS "refundOfPaymentId"
         FROM ristoairen.payments WHERE refund_of_payment_id=$1::uuid ORDER BY received_at,id`, [paymentId]
    );
    return Object.freeze(result.rows.map((row: Record<string, unknown>) => Object.freeze({ id:String(row.id), tenantId:String(row.tenantId), locationId:String(row.locationId), amount:String(row.amount), currency:String(row.currency), refundOfPaymentId:String(row.refundOfPaymentId) })));
  }

  async findRefundRequestByIdempotencyKey(idempotencyKey: string): Promise<RefundRequestRecord | null> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`risto:refund:request:idem:${this.context.tenantId}:${this.context.locationId}:${idempotencyKey}`]);
    const result = await this.client.query(`${REFUND_REQUEST_SELECT} WHERE request_idempotency_key=$1`, [idempotencyKey]);
    return result.rows[0] ? refundRequestFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async insertRefundRequest(request: Omit<RefundRequestRecord, "id">): Promise<RefundRequestRecord> {
    const result = await this.client.query(
      `INSERT INTO ristoairen.refund_requests
       (tenant_id,location_id,payment_id,order_id,requested_amount,currency,reason,
        requested_by_identity_id,requested_at,request_idempotency_key,original_payment_row_version,
        status,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::numeric,$6,$7,$8::uuid,$9::timestamptz,$10,$11,$12,$13,$14)
       RETURNING id::text AS id, tenant_id::text AS "tenantId", location_id::text AS "locationId",
        payment_id::text AS "paymentId", order_id::text AS "orderId", requested_amount::text AS "requestedAmount",
        currency, reason, requested_by_identity_id::text AS "requestedByIdentityId", requested_at AS "requestedAt",
        request_idempotency_key AS "requestIdempotencyKey", original_payment_row_version AS "originalPaymentRowVersion",
        status, approved_by_identity_id::text AS "approvedByIdentityId", approved_at AS "approvedAt",
        rejected_by_identity_id::text AS "rejectedByIdentityId", rejected_at AS "rejectedAt", rejection_reason AS "rejectionReason",
        row_version AS "rowVersion", environment_class AS "environmentClass"`,
      [request.tenantId,request.locationId,request.paymentId,request.orderId,request.requestedAmount,request.currency,request.reason,request.requestedByIdentityId,request.requestedAt,request.requestIdempotencyKey,request.originalPaymentRowVersion,request.status,request.rowVersion,request.environmentClass]
    );
    return refundRequestFromRow(result.rows[0] as Record<string, unknown>);
  }

  async getRefundRequestForApproval(refundRequestId: string): Promise<RefundRequestRecord | null> {
    const result = await this.client.query(`${REFUND_REQUEST_SELECT} WHERE id=$1::uuid FOR UPDATE`, [refundRequestId]);
    return result.rows[0] ? refundRequestFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async approveRefundRequest(refundRequestId: string, expectedRowVersion: number, approverIdentityId: string, approvedAt: string): Promise<RefundRequestRecord | null> {
    const result = await this.client.query(
      `UPDATE ristoairen.refund_requests
          SET status='APPROVED', approved_by_identity_id=$3::uuid, approved_at=$4::timestamptz,
              row_version=row_version+1, updated_at=now()
        WHERE id=$1::uuid AND status='PENDING_APPROVAL' AND row_version=$2
        RETURNING id::text AS id, tenant_id::text AS "tenantId", location_id::text AS "locationId",
          payment_id::text AS "paymentId", order_id::text AS "orderId", requested_amount::text AS "requestedAmount",
          currency, reason, requested_by_identity_id::text AS "requestedByIdentityId", requested_at AS "requestedAt",
          request_idempotency_key AS "requestIdempotencyKey", original_payment_row_version AS "originalPaymentRowVersion",
          status, approved_by_identity_id::text AS "approvedByIdentityId", approved_at AS "approvedAt",
          rejected_by_identity_id::text AS "rejectedByIdentityId", rejected_at AS "rejectedAt", rejection_reason AS "rejectionReason",
          row_version AS "rowVersion", environment_class AS "environmentClass"`,
      [refundRequestId, expectedRowVersion, approverIdentityId, approvedAt]
    );
    return result.rows[0] ? refundRequestFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async audit(record: AuditRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_events
       (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'user',$4,$5,$6,$7,$8,$9::jsonb)`,
      [record.tenantId,record.locationId,record.actorIdentityId,record.actionKey,record.resourceType ?? null,record.resourceId ?? null,record.correlationId,record.outcome,JSON.stringify(record.metadata ?? {})]
    );
  }

  async outbox(_event: DomainEvent & { tenantId: string; locationId: string; correlationId: string }): Promise<void> {
    throw new Error("REFUND_APPROVAL_OUTBOX_WRITE_OUT_OF_SCOPE");
  }
}

export class PostgresRefundRequestUnitOfWork implements UnitOfWork<RefundRequestTransaction> {
  private readonly pool: Pool;
  private readonly assumeRole: string;
  constructor(pool: Pool, assumeRole = "airen_app") { this.pool=pool; this.assumeRole=assumeRole; }

  async transaction<T>(fn: (tx: RefundRequestTransaction) => Promise<T>, context?: SecurityContext): Promise<T> {
    if (!context) throw new Error("SecurityContext is required for RISTOAIREN refund workflow");
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query("SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)", [context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]);
      const result=await fn(new PostgresRefundRequestTransaction(client, context));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
