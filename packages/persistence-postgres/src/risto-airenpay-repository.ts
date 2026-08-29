import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { AppError, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import type {
  AirenPayCapability,
  AirenPayGuaranteeRequestV1,
  AirenPayNormalizedWebhookEventV1,
  AirenPayOrchestrationProjectionV1,
  TenantPaymentGatewayConnectionProjectionV1
} from "../../ristoairen/src/airenpay/contracts.ts";
import type {
  AirenPayCreateOrchestrationResultV1,
  AirenPayPersistencePort,
  AirenPayWebhookRecordResultV1
} from "../../ristoairen/src/airenpay/persistence-contracts.ts";
import {
  assertGateCTestPaymentConnection,
  validateAirenPayGuaranteeRequest,
  validateAirenPayNormalizedWebhookEvent,
  validateTenantPaymentGatewayConnection
} from "../../ristoairen/src/airenpay/policy.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function semanticHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function optionalIso(value: unknown): string | undefined {
  return value == null ? undefined : iso(value);
}

function mapConnection(row: QueryResultRow): TenantPaymentGatewayConnectionProjectionV1 {
  return validateTenantPaymentGatewayConnection(Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    locationId: row.location_id == null ? undefined : String(row.location_id),
    providerType: String(row.provider_type),
    providerAccountReference: String(row.provider_account_reference),
    capabilities: Object.freeze([...(row.capabilities as string[])] as AirenPayCapability[]),
    mode: String(row.mode) as TenantPaymentGatewayConnectionProjectionV1["mode"],
    credentialSecretRef: Object.freeze({
      provider: String(row.credential_secret_provider),
      key: String(row.credential_secret_key),
      version: row.credential_secret_version == null ? undefined : String(row.credential_secret_version)
    }),
    webhookSecretRef: row.webhook_secret_key == null ? undefined : Object.freeze({
      provider: String(row.webhook_secret_provider),
      key: String(row.webhook_secret_key),
      version: row.webhook_secret_version == null ? undefined : String(row.webhook_secret_version)
    }),
    webhookConfigurationReference: row.webhook_configuration_reference == null ? undefined : String(row.webhook_configuration_reference),
    status: String(row.status) as TenantPaymentGatewayConnectionProjectionV1["status"],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    rowVersion: Number(row.row_version)
  }));
}

function mapOrchestration(row: QueryResultRow): AirenPayOrchestrationProjectionV1 {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    locationId: String(row.location_id),
    bookingHoldId: String(row.booking_hold_id),
    bookingId: row.booking_id == null ? undefined : String(row.booking_id),
    guaranteeMode: String(row.guarantee_mode) as AirenPayOrchestrationProjectionV1["guaranteeMode"],
    providerType: String(row.provider_type),
    providerConnectionId: String(row.provider_connection_id),
    providerCustomerReference: row.provider_customer_reference == null ? undefined : String(row.provider_customer_reference),
    providerPaymentMethodReference: row.provider_payment_method_reference == null ? undefined : String(row.provider_payment_method_reference),
    providerTransactionReference: row.provider_transaction_reference == null ? undefined : String(row.provider_transaction_reference),
    amount: row.amount_minor == null ? undefined : Object.freeze({ amountMinor: Number(row.amount_minor), currency: String(row.currency) }),
    orchestrationStatus: String(row.orchestration_status) as AirenPayOrchestrationProjectionV1["orchestrationStatus"],
    authorizationExpiresAt: optionalIso(row.authorization_expires_at),
    guaranteedAt: optionalIso(row.guaranteed_at),
    paidAt: optionalIso(row.paid_at),
    authorizedAt: optionalIso(row.authorized_at),
    capturedAt: optionalIso(row.captured_at),
    refundedAt: optionalIso(row.refunded_at),
    releasedAt: optionalIso(row.released_at),
    correlationId: String(row.correlation_id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    rowVersion: Number(row.row_version)
  });
}

const CONNECTION_COLUMNS = `id,tenant_id,location_id,provider_type,provider_account_reference,capabilities,mode,
 credential_secret_provider,credential_secret_key,credential_secret_version,
 webhook_secret_provider,webhook_secret_key,webhook_secret_version,webhook_configuration_reference,
 status,created_at,updated_at,row_version`;

const ORCHESTRATION_COLUMNS = `id,tenant_id,location_id,booking_hold_id,booking_id,guarantee_mode,provider_type,
 provider_connection_id,provider_customer_reference,provider_payment_method_reference,provider_transaction_reference,
 amount_minor,currency,orchestration_status,authorization_expires_at,guaranteed_at,paid_at,authorized_at,captured_at,
 refunded_at,released_at,correlation_id,created_at,updated_at,row_version`;

async function applyTrustedScope(client: PoolClient, context: SecurityContext, assumeRole: string): Promise<void> {
  await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(assumeRole)}`);
  await client.query(
    "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
    [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
  );
}

async function claimIdempotency(
  client: PoolClient,
  context: SecurityContext,
  idempotencyKey: string,
  hash: string
): Promise<{ kind: "NEW" } | { kind: "REPLAY"; result: AirenPayCreateOrchestrationResultV1 }> {
  const key = idempotencyKey.trim();
  if (!key || key.length > 200) throw new AppError("VALIDATION_FAILED", "A valid idempotency-key is required");
  const inserted = await client.query(
    `INSERT INTO foundation_idempotency_keys
      (actor_identity_id,tenant_id,location_id,canonical_function_id,idempotency_key,semantic_hash,state,lease_until,expires_at)
     VALUES ($1,$2,$3,'RST-F-PAY-001',$4,$5,'IN_PROGRESS',now()+interval '30 seconds',now()+interval '72 hours')
     ON CONFLICT DO NOTHING RETURNING id`,
    [context.actorIdentityId, context.tenantId, context.locationId, key, hash]
  );
  if (inserted.rowCount === 1) return Object.freeze({ kind: "NEW" });
  const existing = await client.query(
    `SELECT semantic_hash,state,result_json,lease_until,expires_at
       FROM foundation_idempotency_keys
      WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
        AND canonical_function_id='RST-F-PAY-001' AND idempotency_key=$4
      FOR UPDATE`,
    [context.actorIdentityId, context.tenantId, context.locationId, key]
  );
  const row = existing.rows[0] as { semantic_hash: string; state: string; result_json: AirenPayCreateOrchestrationResultV1 | null; lease_until: Date; expires_at: Date } | undefined;
  if (!row) throw new AppError("INTERNAL_ERROR", "AIRenPay idempotency row disappeared during claim");
  if (row.semantic_hash !== hash) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different AIRenPay semantic payload");
  if (row.expires_at <= new Date()) throw new AppError("CONFLICT", "Expired AIRenPay idempotency key must be retried with a new key");
  if (row.state === "COMPLETED" && row.result_json) return Object.freeze({ kind: "REPLAY", result: row.result_json });
  if (row.state === "IN_PROGRESS" && row.lease_until > new Date()) throw new AppError("CONFLICT", "AIRenPay idempotent mutation is already in progress");
  await client.query(
    `UPDATE foundation_idempotency_keys SET state='IN_PROGRESS',lease_until=now()+interval '30 seconds',updated_at=now()
      WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
        AND canonical_function_id='RST-F-PAY-001' AND idempotency_key=$4`,
    [context.actorIdentityId, context.tenantId, context.locationId, key]
  );
  return Object.freeze({ kind: "NEW" });
}

async function completeIdempotency(
  client: PoolClient,
  context: SecurityContext,
  idempotencyKey: string,
  hash: string,
  result: AirenPayCreateOrchestrationResultV1
): Promise<void> {
  const updated = await client.query(
    `UPDATE foundation_idempotency_keys
        SET state='COMPLETED',result_json=$5::jsonb,lease_until=now(),updated_at=now()
      WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
        AND canonical_function_id='RST-F-PAY-001' AND idempotency_key=$4 AND semantic_hash=$6`,
    [context.actorIdentityId, context.tenantId, context.locationId, idempotencyKey.trim(), JSON.stringify(result), hash]
  );
  if (updated.rowCount !== 1) throw new AppError("IDEMPOTENCY_CONFLICT", "AIRenPay idempotency completion scope mismatch");
}

export class PostgresAirenPayPersistence implements AirenPayPersistencePort {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  private async scoped<T>(context: SecurityContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applyTrustedScope(client, context, this.assumeRole);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listGatewayConnections(context: SecurityContext): Promise<readonly TenantPaymentGatewayConnectionProjectionV1[]> {
    return this.scoped(context, async (client) => {
      const result = await client.query(`SELECT ${CONNECTION_COLUMNS} FROM risto_payment_gateway_connections ORDER BY location_id NULLS LAST,provider_type,id`);
      return Object.freeze(result.rows.map(mapConnection));
    });
  }

  async findVisibleOrchestrationById(context: SecurityContext, orchestrationId: UUID): Promise<AirenPayOrchestrationProjectionV1 | null> {
    return this.scoped(context, async (client) => {
      const result = await client.query(`SELECT ${ORCHESTRATION_COLUMNS} FROM risto_airenpay_orchestrations WHERE id=$1`, [orchestrationId]);
      return result.rows[0] ? mapOrchestration(result.rows[0]) : null;
    });
  }

  async createOrchestration(
    context: SecurityContext,
    input: AirenPayGuaranteeRequestV1,
    suppliedConnection: TenantPaymentGatewayConnectionProjectionV1,
    idempotencyKey: string
  ): Promise<AirenPayCreateOrchestrationResultV1> {
    const request = validateAirenPayGuaranteeRequest(input);
    const supplied = validateTenantPaymentGatewayConnection(suppliedConnection);
    assertGateCTestPaymentConnection(supplied);
    if (supplied.tenantId !== context.tenantId || (supplied.locationId && supplied.locationId !== context.locationId)) {
      throw new AppError("TENANT_SCOPE_VIOLATION", "AIRenPay connection is outside trusted request scope");
    }
    const hash = semanticHash({ request, providerConnectionId: supplied.id, providerType: supplied.providerType });
    return this.scoped(context, async (client) => {
      const claim = await claimIdempotency(client, context, idempotencyKey, hash);
      if (claim.kind === "REPLAY") return Object.freeze({ ...claim.result, replayed: true });

      const connectionResult = await client.query(
        `SELECT ${CONNECTION_COLUMNS} FROM risto_payment_gateway_connections WHERE id=$1`,
        [supplied.id]
      );
      if (!connectionResult.rows[0]) throw new AppError("NOT_FOUND", "PAYMENT_GATEWAY_CONNECTION_NOT_VISIBLE");
      const connection = mapConnection(connectionResult.rows[0]);
      assertGateCTestPaymentConnection(connection);
      if (connection.providerType !== supplied.providerType) throw new AppError("CONFLICT", "Payment gateway connection provider mismatch");

      const holdResult = await client.query(
        `SELECT id,guarantee_mode,status,expires_at FROM risto_booking_holds WHERE id=$1 FOR UPDATE`,
        [request.bookingHoldId]
      );
      const hold = holdResult.rows[0] as { id: string; guarantee_mode: string; status: string; expires_at: Date } | undefined;
      if (!hold) throw new AppError("NOT_FOUND", "BOOKING_HOLD_NOT_VISIBLE");
      if (hold.guarantee_mode !== request.guaranteeMode) throw new AppError("CONFLICT", "AIRenPay guarantee mode does not match BookingHold");
      if (!["GUARANTEE_REQUIRED", "GUARANTEE_PENDING"].includes(hold.status)) throw new AppError("CONFLICT", "BookingHold is not awaiting guarantee");
      if (hold.expires_at <= new Date()) throw new AppError("CONFLICT", "BookingHold expired before AIRenPay orchestration creation");

      let inserted;
      try {
        inserted = await client.query(
          `INSERT INTO risto_airenpay_orchestrations
            (tenant_id,location_id,booking_hold_id,guarantee_mode,provider_type,provider_connection_id,
             amount_minor,currency,orchestration_status,correlation_id,created_by_identity_id,updated_by_identity_id,environment_class)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CREATED',$9,$10,$10,'TEST_TEMPORARY')
           RETURNING ${ORCHESTRATION_COLUMNS}`,
          [
            context.tenantId,
            context.locationId,
            request.bookingHoldId,
            request.guaranteeMode,
            connection.providerType,
            connection.id,
            request.financialTerms?.amountMinor ?? null,
            request.financialTerms?.currency ?? null,
            context.correlationId,
            context.actorIdentityId
          ]
        );
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505") {
          throw new AppError("CONFLICT", "AIRENPAY_ORCHESTRATION_ALREADY_EXISTS");
        }
        throw error;
      }
      const orchestration = mapOrchestration(inserted.rows[0]);
      const result = Object.freeze({ orchestration, replayed: false });

      await client.query(
        `INSERT INTO audit.audit_events
          (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
         VALUES ($1,$2,$3,'user','AIRENPAY_ORCHESTRATION_CREATED','risto_airenpay_orchestration',$4,$5,'success',$6::jsonb)`,
        [context.tenantId, context.locationId, context.actorIdentityId, orchestration.id, context.correlationId, JSON.stringify({
          guarantee_mode: orchestration.guaranteeMode,
          provider_type: orchestration.providerType,
          connection_mode: connection.mode,
          result: "success"
        })]
      );
      await client.query(
        `INSERT INTO events.outbox_events
          (tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
         VALUES ($1,$2,'airenpay.orchestration.created.v1','risto_airenpay_orchestration',$3,1,$4::jsonb,$5)`,
        [context.tenantId, context.locationId, orchestration.id, JSON.stringify({
          orchestration_id: orchestration.id,
          booking_hold_id: orchestration.bookingHoldId,
          orchestration_status: orchestration.orchestrationStatus,
          guarantee_mode: orchestration.guaranteeMode,
          provider_type: orchestration.providerType
        }), context.correlationId]
      );
      await completeIdempotency(client, context, idempotencyKey, hash, result);
      return result;
    });
  }

  async recordNormalizedWebhookEvent(
    context: SecurityContext,
    connectionId: UUID,
    input: AirenPayNormalizedWebhookEventV1
  ): Promise<AirenPayWebhookRecordResultV1> {
    const event = validateAirenPayNormalizedWebhookEvent(input);
    const hash = semanticHash(event);
    return this.scoped(context, async (client) => {
      const connectionResult = await client.query(
        `SELECT ${CONNECTION_COLUMNS} FROM risto_payment_gateway_connections WHERE id=$1`,
        [connectionId]
      );
      if (!connectionResult.rows[0]) throw new AppError("NOT_FOUND", "PAYMENT_GATEWAY_CONNECTION_NOT_VISIBLE");
      const connection = mapConnection(connectionResult.rows[0]);
      assertGateCTestPaymentConnection(connection);

      const orchestrationResult = await client.query(
        `SELECT ${ORCHESTRATION_COLUMNS}
           FROM risto_airenpay_orchestrations
          WHERE provider_connection_id=$1 AND provider_transaction_reference=$2
          FOR UPDATE`,
        [connectionId, event.providerReference]
      );
      if (!orchestrationResult.rows[0]) throw new AppError("NOT_FOUND", "AIRENPAY_PROVIDER_REFERENCE_NOT_VISIBLE");
      const orchestration = mapOrchestration(orchestrationResult.rows[0]);

      const inserted = await client.query(
        `INSERT INTO risto_airenpay_webhook_events
          (tenant_id,location_id,provider_connection_id,orchestration_id,provider_event_id,provider_reference,
           event_type,orchestration_status,occurred_at,amount_minor,currency,authorization_expires_at,provider_metadata,semantic_hash,environment_class)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12::timestamptz,$13::jsonb,$14,'TEST_TEMPORARY')
         ON CONFLICT (provider_connection_id,provider_event_id) DO NOTHING
         RETURNING id`,
        [
          context.tenantId,
          context.locationId,
          connectionId,
          orchestration.id,
          event.providerEventId,
          event.providerReference,
          event.eventType,
          event.status,
          event.occurredAt,
          event.amount?.amountMinor ?? null,
          event.amount?.currency ?? null,
          event.authorizationExpiresAt ?? null,
          JSON.stringify(event.providerMetadata ?? {}),
          hash
        ]
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query(
          `SELECT id::text,orchestration_id::text,semantic_hash
             FROM risto_airenpay_webhook_events
            WHERE provider_connection_id=$1 AND provider_event_id=$2
            FOR UPDATE`,
          [connectionId, event.providerEventId]
        );
        const row = existing.rows[0] as { id: string; orchestration_id: string; semantic_hash: string } | undefined;
        if (!row) throw new AppError("INTERNAL_ERROR", "AIRenPay webhook event disappeared during replay check");
        if (row.semantic_hash.trim() !== hash) throw new AppError("IDEMPOTENCY_CONFLICT", "Provider event id reused with different normalized payload");
        return Object.freeze({ webhookEventId: row.id, orchestrationId: row.orchestration_id, replayed: true });
      }
      const webhookEventId = String(inserted.rows[0].id);
      await client.query(
        `INSERT INTO audit.audit_events
          (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
         VALUES ($1,$2,$3,'service','AIRENPAY_WEBHOOK_RECORDED','risto_airenpay_orchestration',$4,$5,'success',$6::jsonb)`,
        [context.tenantId, context.locationId, context.actorIdentityId, orchestration.id, context.correlationId, JSON.stringify({
          provider_type: connection.providerType,
          event_type: event.eventType,
          normalized_status: event.status,
          result: "success"
        })]
      );
      await client.query(
        `INSERT INTO events.outbox_events
          (tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
         VALUES ($1,$2,'airenpay.webhook.recorded.v1','risto_airenpay_orchestration',$3,1,$4::jsonb,$5)`,
        [context.tenantId, context.locationId, orchestration.id, JSON.stringify({
          orchestration_id: orchestration.id,
          webhook_event_id: webhookEventId,
          event_type: event.eventType,
          normalized_status: event.status
        }), context.correlationId]
      );
      return Object.freeze({ webhookEventId, orchestrationId: orchestration.id, replayed: false });
    });
  }
}
