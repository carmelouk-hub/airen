import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent, SecurityContext } from "../../shared-contracts/src/index.ts";
import {
  PROVIDER_REFUND_DISPATCH_EVENT,
  type ProviderRefundMaterial,
  type ProviderRefundSagaRecord,
  type ProviderRefundSagaTransaction
} from "../../ristoairen/src/pos/provider-refund-saga.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function sagaFromRow(row: Record<string, unknown>): ProviderRefundSagaRecord {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    locationId: String(row.locationId),
    refundRequestId: String(row.refundRequestId),
    refundPaymentId: String(row.refundPaymentId),
    originalPaymentId: String(row.originalPaymentId),
    providerKey: String(row.providerKey),
    providerSourceReference: String(row.providerSourceReference),
    idempotencyKey: String(row.idempotencyKey),
    status: String(row.status) as ProviderRefundSagaRecord["status"],
    ...(row.providerRefundReference == null ? {} : { providerRefundReference: String(row.providerRefundReference) }),
    ...(row.providerEventId == null ? {} : { providerEventId: String(row.providerEventId) }),
    ...(row.resultCode == null ? {} : { resultCode: String(row.resultCode) }),
    rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass),
    ...(row.reconciledAt == null ? {} : { reconciledAt: new Date(String(row.reconciledAt)).toISOString() })
  });
}

const SAGA_SELECT = `SELECT id::text AS id,
 tenant_id::text AS "tenantId", location_id::text AS "locationId",
 refund_request_id::text AS "refundRequestId", refund_payment_id::text AS "refundPaymentId",
 original_payment_id::text AS "originalPaymentId", provider_key AS "providerKey",
 provider_source_reference AS "providerSourceReference", idempotency_key AS "idempotencyKey",
 status, provider_refund_reference AS "providerRefundReference", provider_event_id AS "providerEventId",
 result_code AS "resultCode", row_version AS "rowVersion", environment_class AS "environmentClass",
 reconciled_at AS "reconciledAt"
 FROM ristoairen.provider_refund_sagas`;

export class PostgresProviderRefundSagaTransaction implements ProviderRefundSagaTransaction {
  private readonly client: PoolClient;
  private readonly context: SecurityContext;

  constructor(client: PoolClient, context: SecurityContext) {
    this.client = client;
    this.context = context;
  }

  async getRefundMaterial(refundRequestId: string, refundPaymentId: string): Promise<ProviderRefundMaterial | null> {
    const result = await this.client.query(
      `SELECT rr.id::text AS "refundRequestId", rr.status AS "refundRequestStatus",
              rp.id::text AS "refundPaymentId", rp.status AS "refundPaymentStatus",
              op.id::text AS "originalPaymentId", op.provider_reference AS "providerSourceReference",
              rp.amount::text AS amount, rp.currency, rp.environment_class AS "environmentClass",
              rp.metadata_sanitized->>'refundRequestId' AS "refundRequestIdFromMetadata"
         FROM ristoairen.refund_requests rr
         JOIN ristoairen.payments rp
           ON rp.tenant_id=rr.tenant_id AND rp.location_id=rr.location_id
          AND rp.refund_of_payment_id=rr.payment_id AND rp.id=$2::uuid
         JOIN ristoairen.payments op
           ON op.tenant_id=rr.tenant_id AND op.location_id=rr.location_id AND op.id=rr.payment_id
        WHERE rr.id=$1::uuid`,
      [refundRequestId, refundPaymentId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return Object.freeze({
      refundRequestId: String(row.refundRequestId),
      refundRequestStatus: String(row.refundRequestStatus),
      refundPaymentId: String(row.refundPaymentId),
      refundPaymentStatus: String(row.refundPaymentStatus),
      originalPaymentId: String(row.originalPaymentId),
      providerSourceReference: row.providerSourceReference == null ? null : String(row.providerSourceReference),
      amount: String(row.amount),
      currency: String(row.currency),
      environmentClass: String(row.environmentClass),
      refundRequestIdFromMetadata: row.refundRequestIdFromMetadata == null ? null : String(row.refundRequestIdFromMetadata)
    });
  }

  async findSagaByIdempotencyKey(idempotencyKey: string): Promise<ProviderRefundSagaRecord | null> {
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`risto:provider-refund:${this.context.tenantId}:${this.context.locationId}:${idempotencyKey}`]
    );
    const result = await this.client.query(`${SAGA_SELECT} WHERE idempotency_key=$1`, [idempotencyKey]);
    return result.rows[0] ? sagaFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async insertSaga(record: Omit<ProviderRefundSagaRecord, "id">): Promise<ProviderRefundSagaRecord> {
    const result = await this.client.query(
      `INSERT INTO ristoairen.provider_refund_sagas
       (tenant_id,location_id,refund_request_id,refund_payment_id,original_payment_id,provider_key,
        provider_source_reference,idempotency_key,status,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11)
       RETURNING id::text AS id, tenant_id::text AS "tenantId", location_id::text AS "locationId",
        refund_request_id::text AS "refundRequestId", refund_payment_id::text AS "refundPaymentId",
        original_payment_id::text AS "originalPaymentId", provider_key AS "providerKey",
        provider_source_reference AS "providerSourceReference", idempotency_key AS "idempotencyKey",
        status, provider_refund_reference AS "providerRefundReference", provider_event_id AS "providerEventId",
        result_code AS "resultCode", row_version AS "rowVersion", environment_class AS "environmentClass",
        reconciled_at AS "reconciledAt"`,
      [record.tenantId, record.locationId, record.refundRequestId, record.refundPaymentId,
       record.originalPaymentId, record.providerKey, record.providerSourceReference,
       record.idempotencyKey, record.status, record.rowVersion, record.environmentClass]
    );
    return sagaFromRow(result.rows[0] as Record<string, unknown>);
  }

  async enqueueRefundDispatch(input: Readonly<{ saga: ProviderRefundSagaRecord; amount: string; currency: string; correlationId: string }>): Promise<void> {
    await this.client.query(
      `INSERT INTO events.outbox_events
       (tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
       VALUES ($1::uuid,$2::uuid,$3,'ProviderRefundSaga',$4,1,$5::jsonb,$6)`,
      [input.saga.tenantId, input.saga.locationId, PROVIDER_REFUND_DISPATCH_EVENT, input.saga.id,
       JSON.stringify({
         providerKey: input.saga.providerKey,
         providerSourceReference: input.saga.providerSourceReference,
         refundRequestId: input.saga.refundRequestId,
         refundPaymentId: input.saga.refundPaymentId,
         amount: input.amount,
         currency: input.currency,
         idempotencyKey: input.saga.idempotencyKey
       }), input.correlationId]
    );
  }

  async getSagaForReconciliation(refundPaymentId: string): Promise<ProviderRefundSagaRecord | null> {
    const result = await this.client.query(`${SAGA_SELECT} WHERE refund_payment_id=$1::uuid FOR UPDATE`, [refundPaymentId]);
    return result.rows[0] ? sagaFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async reconcileSaga(input: Readonly<{
    sagaId: string;
    outcome: "SUCCEEDED" | "FAILED";
    providerRefundReference?: string;
    providerEventId: string;
    resultCode: string;
    reconciledAt: string;
  }>): Promise<ProviderRefundSagaRecord> {
    const result = await this.client.query(
      `UPDATE ristoairen.provider_refund_sagas
          SET status=$2,
              provider_refund_reference=$3,
              provider_event_id=$4,
              result_code=$5,
              reconciled_at=$6::timestamptz,
              row_version=row_version+1,
              updated_at=$6::timestamptz
        WHERE id=$1::uuid AND status IN ('PENDING_DISPATCH','DISPATCHED')
        RETURNING id::text AS id, tenant_id::text AS "tenantId", location_id::text AS "locationId",
          refund_request_id::text AS "refundRequestId", refund_payment_id::text AS "refundPaymentId",
          original_payment_id::text AS "originalPaymentId", provider_key AS "providerKey",
          provider_source_reference AS "providerSourceReference", idempotency_key AS "idempotencyKey",
          status, provider_refund_reference AS "providerRefundReference", provider_event_id AS "providerEventId",
          result_code AS "resultCode", row_version AS "rowVersion", environment_class AS "environmentClass",
          reconciled_at AS "reconciledAt"`,
      [input.sagaId, input.outcome, input.providerRefundReference ?? null, input.providerEventId, input.resultCode, input.reconciledAt]
    );
    if (!result.rows[0]) throw new Error("PROVIDER_REFUND_SAGA_STATE_CONFLICT");
    return sagaFromRow(result.rows[0] as Record<string, unknown>);
  }

  async audit(record: AuditRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_events
       (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'system',$4,$5,$6,$7,$8,$9::jsonb)`,
      [record.tenantId, record.locationId, record.actorIdentityId, record.actionKey,
       record.resourceType ?? null, record.resourceId ?? null, record.correlationId,
       record.outcome, JSON.stringify(record.metadata ?? {})]
    );
  }

  async outbox(_event: DomainEvent & { tenantId: string; locationId: string; correlationId: string }): Promise<void> {
    throw new Error("USE_ENQUEUE_REFUND_DISPATCH");
  }
}

export class PostgresProviderRefundSagaUnitOfWork implements UnitOfWork<ProviderRefundSagaTransaction> {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: ProviderRefundSagaTransaction) => Promise<T>, context?: SecurityContext): Promise<T> {
    if (!context) throw new Error("SecurityContext is required for provider refund saga");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
      );
      const result = await fn(new PostgresProviderRefundSagaTransaction(client, context));
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
