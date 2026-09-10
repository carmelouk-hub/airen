import { Pool, type PoolClient } from "pg";
import type { UnitOfWork } from "../../audit-events/src/index.ts";
import type { SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  PaymentForRefundRequest,
  RefundLineagePayment,
  RefundRequestTransaction
} from "../../ristoairen/src/pos/refund-request.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

export class PostgresRefundRequestTransaction implements RefundRequestTransaction {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async getPaymentForRefundRequest(paymentId: string): Promise<PaymentForRefundRequest | null> {
    // Shared advisory lock namespace is reserved for the future refund.approve effect so
    // request validation and approval can serialize on the same original Payment.
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`risto:refund:payment:${paymentId}`]
    );
    const result = await this.client.query(
      `SELECT p.id::text AS id,
              p.tenant_id::text AS "tenantId",
              p.location_id::text AS "locationId",
              p.order_id::text AS "orderId",
              p.payment_method AS "paymentMethod",
              p.amount::text AS amount,
              p.currency,
              p.refund_of_payment_id::text AS "refundOfPaymentId",
              p.row_version AS "rowVersion",
              p.environment_class AS "environmentClass"
         FROM ristoairen.payments p
         JOIN ristoairen.orders o
           ON o.tenant_id = p.tenant_id
          AND o.location_id = p.location_id
          AND o.id = p.order_id
        WHERE p.id = $1::uuid
          AND o.currency = p.currency`,
      [paymentId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return Object.freeze({
      id: String(row.id),
      tenantId: String(row.tenantId),
      locationId: String(row.locationId),
      orderId: String(row.orderId),
      paymentMethod: String(row.paymentMethod),
      amount: String(row.amount),
      currency: String(row.currency),
      ...(row.refundOfPaymentId == null ? {} : { refundOfPaymentId: String(row.refundOfPaymentId) }),
      rowVersion: Number(row.rowVersion),
      environmentClass: String(row.environmentClass)
    });
  }

  async listRefundLineage(paymentId: string): Promise<readonly RefundLineagePayment[]> {
    // Conservative accounting: every append-only child with refund_of_payment_id reduces
    // refundable balance irrespective of its free-form status label. This can fail closed
    // but cannot authorize an over-refund before refund lifecycle states are frozen.
    const result = await this.client.query(
      `SELECT id::text AS id,
              tenant_id::text AS "tenantId",
              location_id::text AS "locationId",
              amount::text AS amount,
              currency,
              refund_of_payment_id::text AS "refundOfPaymentId"
         FROM ristoairen.payments
        WHERE refund_of_payment_id = $1::uuid
        ORDER BY received_at, id`,
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

  async audit(): Promise<void> {
    // MAT-020 intentionally creates no durable request state and no audit-as-authority.
    // The UnitOfWork interface exposes audit/outbox through TransactionContext, but the
    // request-only service does not call either method.
    throw new Error("REFUND_REQUEST_AUDIT_WRITE_OUT_OF_SCOPE");
  }

  async outbox(): Promise<void> {
    throw new Error("REFUND_REQUEST_OUTBOX_WRITE_OUT_OF_SCOPE");
  }
}

export class PostgresRefundRequestUnitOfWork implements UnitOfWork<RefundRequestTransaction> {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: RefundRequestTransaction) => Promise<T>, context?: SecurityContext): Promise<T> {
    if (!context) throw new Error("SecurityContext is required for RISTOAIREN refund requests");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
      );
      const result = await fn(new PostgresRefundRequestTransaction(client));
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
