import type { Pool, PoolClient, QueryResultRow } from "pg";
import { AppError, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { idempotencyFunctionIdsForRead } from "./idempotency-control-plane.ts";
import type {
  BookingGuaranteePolicyProjectionV1,
  BookingHoldAuditEvent,
  BookingHoldCreateInputV1,
  BookingHoldIdempotencyClaim,
  BookingHoldIdempotencyResultV1,
  BookingHoldIdempotencyScope,
  BookingHoldMutationTransaction,
  BookingHoldOutboxEvent,
  BookingHoldPrivateProjectionV1,
  BookingHoldStatus,
  BookingHoldUnitOfWork
} from "../../ristoairen/src/booking/hold-contracts.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const raw = String(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) throw new AppError("INTERNAL_ERROR", "Invalid PostgreSQL date projection");
  return raw.slice(0, 10);
}

function mapHold(row: QueryResultRow): BookingHoldPrivateProjectionV1 {
  return Object.freeze({
    id: String(row.id), status: String(row.status) as BookingHoldStatus, sourceChannel: String(row.source_channel),
    sourceExternalReference: row.source_external_reference == null ? undefined : String(row.source_external_reference),
    resourceKey: String(row.resource_key), partySize: Number(row.party_size), capacityClaim: Number(row.capacity_claim),
    bookingDate: dateOnly(row.booking_date), bookingTimeLocal: String(row.booking_time_local), startsAt: iso(row.starts_at),
    expectedDurationMinutes: Number(row.expected_duration_minutes), expiresAt: iso(row.expires_at), guaranteePolicyId: String(row.guarantee_policy_id),
    guaranteeMode: String(row.guarantee_mode) as BookingHoldPrivateProjectionV1["guaranteeMode"],
    guaranteeRef: row.guarantee_ref == null ? undefined : String(row.guarantee_ref),
    conversionBookingId: row.conversion_booking_id == null ? undefined : String(row.conversion_booking_id),
    customerNameSnapshot: String(row.customer_name_snapshot), phoneSnapshot: row.phone_snapshot == null ? undefined : String(row.phone_snapshot),
    emailSnapshot: row.email_snapshot == null ? undefined : String(row.email_snapshot), notes: row.notes == null ? undefined : String(row.notes),
    specialRequests: row.special_requests == null ? undefined : String(row.special_requests), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), rowVersion: Number(row.row_version)
  });
}

function mapPolicy(row: QueryResultRow): BookingGuaranteePolicyProjectionV1 {
  return Object.freeze({
    id: String(row.id), status: String(row.status) as "active" | "disabled",
    guaranteeMode: String(row.guarantee_mode) as BookingGuaranteePolicyProjectionV1["guaranteeMode"],
    holdDurationSeconds: Number(row.hold_duration_seconds), priority: Number(row.priority),
    sourceChannel: row.source_channel == null ? undefined : String(row.source_channel), resourceKey: row.resource_key == null ? undefined : String(row.resource_key),
    minPartySize: row.min_party_size == null ? undefined : Number(row.min_party_size), maxPartySize: row.max_party_size == null ? undefined : Number(row.max_party_size),
    effectiveFrom: row.effective_from == null ? undefined : dateOnly(row.effective_from), effectiveUntil: row.effective_until == null ? undefined : dateOnly(row.effective_until)
  });
}

async function applyTrustedScope(client: PoolClient, context: SecurityContext, assumeRole = "airen_app"): Promise<void> {
  await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(assumeRole)}`);
  await client.query(
    "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
    [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
  );
}

type StoredHoldIdempotency = {
  canonical_function_id: string;
  semantic_hash: string;
  state: string;
  result_json: BookingHoldIdempotencyResultV1 | null;
  lease_until: Date;
  expires_at: Date;
};

class PostgresRistoBookingHoldTransaction implements BookingHoldMutationTransaction {
  private readonly client: PoolClient;
  constructor(client: PoolClient) { this.client = client; }

  async findVisibleHoldById(holdId: UUID): Promise<BookingHoldPrivateProjectionV1 | null> {
    const result = await this.client.query(
      `SELECT id,status,source_channel,source_external_reference,resource_key,party_size,capacity_claim,
              booking_date,booking_time_local,starts_at,expected_duration_minutes,expires_at,
              guarantee_policy_id,guarantee_mode,guarantee_ref,conversion_booking_id,
              customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,
              created_at,updated_at,row_version
         FROM risto_booking_holds WHERE id=$1`, [holdId]
    );
    return result.rows[0] ? mapHold(result.rows[0]) : null;
  }

  async listGuaranteePolicies(input: BookingHoldCreateInputV1, context: SecurityContext): Promise<readonly BookingGuaranteePolicyProjectionV1[]> {
    const result = await this.client.query(
      `SELECT id,status,guarantee_mode,hold_duration_seconds,priority,source_channel,resource_key,min_party_size,max_party_size,effective_from,effective_until
         FROM risto_booking_guarantee_policies
        WHERE tenant_id=$1 AND location_id=$2 AND status='active'
          AND (source_channel IS NULL OR source_channel=$3) AND (resource_key IS NULL OR resource_key=$4)
          AND (min_party_size IS NULL OR min_party_size <= $5) AND (max_party_size IS NULL OR max_party_size >= $5)
          AND (effective_from IS NULL OR effective_from <= $6::date) AND (effective_until IS NULL OR effective_until >= $6::date)
        ORDER BY priority DESC,id`,
      [context.tenantId, context.locationId, input.sourceChannel, input.resourceKey, input.partySize, input.bookingDate]
    );
    return Object.freeze(result.rows.map(mapPolicy));
  }

  private async findIdempotencyCandidate(scope: BookingHoldIdempotencyScope): Promise<StoredHoldIdempotency | undefined> {
    const functionIds = idempotencyFunctionIdsForRead(scope.canonicalFunctionId);
    const existing = await this.client.query(
      `SELECT canonical_function_id,semantic_hash,state,result_json,lease_until,expires_at
         FROM foundation_idempotency_keys
        WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
          AND canonical_function_id = ANY($4::text[]) AND idempotency_key=$5
        ORDER BY CASE WHEN canonical_function_id=$6 THEN 0 ELSE 1 END
        FOR UPDATE`,
      [scope.actorIdentityId, scope.tenantId, scope.locationId, functionIds, scope.idempotencyKey, scope.canonicalFunctionId]
    );
    if ((existing.rowCount ?? 0) > 1) throw new AppError("IDEMPOTENCY_CONFLICT", "Canonical and legacy BookingHold idempotency records coexist for the same mutation key");
    return existing.rows[0] as StoredHoldIdempotency | undefined;
  }

  async claimHoldIdempotency(scope: BookingHoldIdempotencyScope): Promise<BookingHoldIdempotencyClaim> {
    let row = await this.findIdempotencyCandidate(scope);
    if (!row) {
      const inserted = await this.client.query(
        `INSERT INTO foundation_idempotency_keys
          (actor_identity_id,tenant_id,location_id,canonical_function_id,idempotency_key,semantic_hash,state,lease_until,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'IN_PROGRESS',now()+interval '30 seconds',now()+interval '72 hours')
         ON CONFLICT DO NOTHING RETURNING id`,
        [scope.actorIdentityId, scope.tenantId, scope.locationId, scope.canonicalFunctionId, scope.idempotencyKey, scope.semanticHash]
      );
      if (inserted.rowCount === 1) return Object.freeze({ kind: "NEW" });
      row = await this.findIdempotencyCandidate(scope);
    }
    if (!row) throw new AppError("INTERNAL_ERROR", "BookingHold idempotency row disappeared during claim");
    if (row.semantic_hash !== scope.semanticHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different semantic payload");
    if (row.expires_at <= new Date()) throw new AppError("CONFLICT", "Expired idempotency key must be retried with a new key");
    if (row.state === "COMPLETED" && row.result_json) return Object.freeze({ kind: "REPLAY", result: row.result_json });
    if (row.canonical_function_id !== scope.canonicalFunctionId) throw new AppError("CONFLICT", "Legacy BookingHold idempotency record is not safely resumable; retry with a new key");
    if (row.state === "IN_PROGRESS" && row.lease_until > new Date()) throw new AppError("CONFLICT", "Idempotent mutation is already in progress");
    await this.client.query(
      `UPDATE foundation_idempotency_keys SET state='IN_PROGRESS',lease_until=now()+interval '30 seconds',updated_at=now()
        WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3 AND canonical_function_id=$4 AND idempotency_key=$5`,
      [scope.actorIdentityId, scope.tenantId, scope.locationId, scope.canonicalFunctionId, scope.idempotencyKey]
    );
    return Object.freeze({ kind: "NEW" });
  }

  async completeHoldIdempotency(scope: BookingHoldIdempotencyScope, result: BookingHoldIdempotencyResultV1): Promise<void> {
    const updated = await this.client.query(
      `UPDATE foundation_idempotency_keys SET state='COMPLETED',result_json=$6::jsonb,lease_until=now(),updated_at=now()
        WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3 AND canonical_function_id=$4 AND idempotency_key=$5 AND semantic_hash=$7`,
      [scope.actorIdentityId, scope.tenantId, scope.locationId, scope.canonicalFunctionId, scope.idempotencyKey, JSON.stringify(result), scope.semanticHash]
    );
    if (updated.rowCount !== 1) throw new AppError("IDEMPOTENCY_CONFLICT", "BookingHold idempotency completion scope mismatch");
  }

  async insertHold(input: BookingHoldCreateInputV1, policy: BookingGuaranteePolicyProjectionV1, context: SecurityContext): Promise<BookingHoldPrivateProjectionV1> {
    const timing = await this.client.query(
      `SELECT (($2::date + $3::time) AT TIME ZONE l.timezone) AS starts_at,
              (($2::date + $3::time) AT TIME ZONE l.timezone) + ($4::int * interval '1 minute') AS ends_at
         FROM platform.locations l WHERE l.id=$1 AND l.tenant_id=$5 AND l.status='active'`,
      [context.locationId, input.bookingDate, input.bookingTimeLocal, input.expectedDurationMinutes, context.tenantId]
    );
    if (!timing.rows[0]) throw new AppError("LOCATION_INACTIVE", "Trusted BookingHold Location is not active");
    const startsAt = timing.rows[0].starts_at as Date;
    const endsAt = timing.rows[0].ends_at as Date;
    if (startsAt.getTime() <= Date.now()) throw new AppError("CONFLICT", "BOOKING_HOLD_START_NOT_FUTURE");

    const slots = await this.client.query(
      `SELECT id,capacity_total,starts_at,ends_at FROM risto_booking_capacity_slots
        WHERE tenant_id=$1 AND location_id=$2 AND resource_key=$3 AND status='active'
          AND starts_at <= $4::timestamptz AND ends_at >= $5::timestamptz
        ORDER BY starts_at DESC,id FOR UPDATE`,
      [context.tenantId, context.locationId, input.resourceKey, startsAt, endsAt]
    );
    if (slots.rowCount === 0) throw new AppError("CONFLICT", "BOOKING_CAPACITY_SLOT_NOT_CONFIGURED");
    if ((slots.rowCount ?? 0) > 1) throw new AppError("CONFLICT", "BOOKING_CAPACITY_SLOT_AMBIGUOUS");
    const slot = slots.rows[0] as { id: string; capacity_total: number };

    const usage = await this.client.query(
      `SELECT COALESCE((SELECT sum(party_size)::bigint FROM risto_bookings WHERE capacity_slot_id=$1 AND status IN ('REQUESTED','PENDING','CONFIRMED','ARRIVED','SEATED')),0)::bigint
          + COALESCE((SELECT sum(capacity_claim)::bigint FROM risto_booking_holds WHERE capacity_slot_id=$1 AND status IN ('CREATED','GUARANTEE_REQUIRED','GUARANTEE_PENDING','GUARANTEED') AND expires_at > now()),0)::bigint AS used_capacity`,
      [slot.id]
    );
    const usedCapacity = Number(usage.rows[0]?.used_capacity ?? 0);
    const capacityClaim = input.capacityClaim ?? input.partySize;
    if (usedCapacity + capacityClaim > Number(slot.capacity_total)) throw new AppError("CONFLICT", "BOOKING_CAPACITY_EXCEEDED");

    const inserted = await this.client.query(
      `INSERT INTO risto_booking_holds
        (tenant_id,location_id,capacity_slot_id,guarantee_policy_id,source_channel,source_external_reference,resource_key,party_size,capacity_claim,booking_date,booking_time_local,starts_at,expected_duration_minutes,status,expires_at,guarantee_mode,customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,created_by_identity_id,updated_by_identity_id,environment_class)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::time,$12,$13,'CREATED',LEAST(now()+($14::int * interval '1 second'),$12),$15,$16,$17,$18,$19,$20,$21,$21,'TEST_TEMPORARY')
       RETURNING id,status,source_channel,source_external_reference,resource_key,party_size,capacity_claim,booking_date,booking_time_local,starts_at,expected_duration_minutes,expires_at,guarantee_policy_id,guarantee_mode,guarantee_ref,conversion_booking_id,customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,created_at,updated_at,row_version`,
      [context.tenantId,context.locationId,slot.id,policy.id,input.sourceChannel,input.sourceExternalReference??null,input.resourceKey,input.partySize,capacityClaim,input.bookingDate,input.bookingTimeLocal,startsAt,input.expectedDurationMinutes,policy.holdDurationSeconds,policy.guaranteeMode,input.customerNameSnapshot,input.phoneSnapshot??null,input.emailSnapshot??null,input.notes??null,input.specialRequests??null,context.actorIdentityId]
    );
    return mapHold(inserted.rows[0]);
  }

  async transitionHoldStatus(holdId: UUID, fromStatus: BookingHoldStatus, toStatus: BookingHoldStatus, rowVersion: number, reason: string | undefined, context: SecurityContext): Promise<BookingHoldPrivateProjectionV1> {
    const updated = await this.client.query(
      `UPDATE risto_booking_holds
          SET status=$3,cancellation_reason=CASE WHEN $3='CANCELLED' THEN $5 ELSE cancellation_reason END,
              cancelled_at=CASE WHEN $3='CANCELLED' THEN now() ELSE cancelled_at END,
              expired_at=CASE WHEN $3='EXPIRED' THEN now() ELSE expired_at END,
              converted_at=CASE WHEN $3='CONVERTED' THEN now() ELSE converted_at END,
              failure_reason=CASE WHEN $3='FAILED' THEN $5 ELSE failure_reason END,
              updated_by_identity_id=$6,updated_at=now(),row_version=row_version+1
        WHERE id=$1 AND status=$2 AND row_version=$4
        RETURNING id,status,source_channel,source_external_reference,resource_key,party_size,capacity_claim,booking_date,booking_time_local,starts_at,expected_duration_minutes,expires_at,guarantee_policy_id,guarantee_mode,guarantee_ref,conversion_booking_id,customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,created_at,updated_at,row_version`,
      [holdId, fromStatus, toStatus, rowVersion, reason ?? null, context.actorIdentityId]
    );
    if (updated.rowCount !== 1) throw new AppError("CONFLICT", "BookingHold optimistic concurrency conflict");
    return mapHold(updated.rows[0]);
  }

  async appendHoldAudit(event: BookingHoldAuditEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_events (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
       VALUES ($1,$2,$3,'user',$4,'risto_booking_hold',$5,$6,'success',$7::jsonb)`,
      [event.tenantId,event.locationId,event.actorIdentityId,event.eventType,event.holdId,event.correlationId,JSON.stringify(event.metadata)]
    );
  }

  async appendHoldOutbox(event: BookingHoldOutboxEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO events.outbox_events (tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
       VALUES ($1,$2,$3,'risto_booking_hold',$4,1,$5::jsonb,$6)`,
      [event.tenantId,event.locationId,event.eventType,event.holdId,JSON.stringify(event.payload),event.correlationId]
    );
  }
}

export class PostgresRistoBookingHoldUnitOfWork implements BookingHoldUnitOfWork {
  private readonly pool: Pool;
  private readonly assumeRole: string;
  constructor(pool: Pool, assumeRole = "airen_app") { this.pool = pool; this.assumeRole = assumeRole; }
  async transaction<T>(context: SecurityContext, fn: (tx: BookingHoldMutationTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applyTrustedScope(client, context, this.assumeRole);
      const result = await fn(new PostgresRistoBookingHoldTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
