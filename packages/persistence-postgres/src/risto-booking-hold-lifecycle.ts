import type { Pool, PoolClient, QueryResultRow } from "pg";
import { AppError, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { bookingSemanticHash } from "../../ristoairen/src/booking/application-service.ts";
import type {
  BookingHoldConversionResultV1,
  BookingHoldPrivateProjectionV1,
  BookingHoldStatus
} from "../../ristoairen/src/booking/hold-contracts.ts";
import type { BookingPrivateProjectionV1, BookingStatus } from "../../ristoairen/src/booking/contracts.ts";

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

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function mapHold(row: QueryResultRow): BookingHoldPrivateProjectionV1 {
  return Object.freeze({
    id: String(row.id),
    status: String(row.status) as BookingHoldStatus,
    sourceChannel: String(row.source_channel),
    sourceExternalReference: optionalString(row.source_external_reference),
    resourceKey: String(row.resource_key),
    partySize: Number(row.party_size),
    capacityClaim: Number(row.capacity_claim),
    bookingDate: dateOnly(row.booking_date),
    bookingTimeLocal: String(row.booking_time_local),
    startsAt: iso(row.starts_at),
    expectedDurationMinutes: Number(row.expected_duration_minutes),
    expiresAt: iso(row.expires_at),
    guaranteePolicyId: String(row.guarantee_policy_id),
    guaranteeMode: String(row.guarantee_mode) as BookingHoldPrivateProjectionV1["guaranteeMode"],
    guaranteeRef: optionalString(row.guarantee_ref),
    conversionBookingId: optionalString(row.conversion_booking_id),
    customerNameSnapshot: String(row.customer_name_snapshot),
    phoneSnapshot: optionalString(row.phone_snapshot),
    emailSnapshot: optionalString(row.email_snapshot),
    notes: optionalString(row.notes),
    specialRequests: optionalString(row.special_requests),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    rowVersion: Number(row.row_version)
  });
}

function mapBooking(row: QueryResultRow): BookingPrivateProjectionV1 {
  return Object.freeze({
    id: String(row.id),
    status: String(row.status) as BookingStatus,
    partySize: Number(row.party_size),
    bookingDate: dateOnly(row.booking_date),
    bookingTimeLocal: String(row.booking_time_local),
    startsAt: iso(row.starts_at),
    expectedDurationMinutes: Number(row.expected_duration_minutes),
    source: String(row.source),
    customerNameSnapshot: String(row.customer_name_snapshot),
    phoneSnapshot: optionalString(row.phone_snapshot),
    emailSnapshot: optionalString(row.email_snapshot),
    notes: optionalString(row.notes),
    specialRequests: optionalString(row.special_requests),
    zoneId: optionalString(row.zone_id),
    tableId: optionalString(row.table_id),
    eventId: optionalString(row.event_id),
    arrivalAt: row.arrival_at == null ? undefined : iso(row.arrival_at),
    seatedAt: row.seated_at == null ? undefined : iso(row.seated_at),
    completedAt: row.completed_at == null ? undefined : iso(row.completed_at),
    cancelledAt: row.cancelled_at == null ? undefined : iso(row.cancelled_at),
    cancellationReason: optionalString(row.cancellation_reason),
    noShowAt: row.no_show_at == null ? undefined : iso(row.no_show_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    rowVersion: Number(row.row_version)
  });
}

async function applyTrustedScope(client: PoolClient, context: SecurityContext, assumeRole: string): Promise<void> {
  await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(assumeRole)}`);
  await client.query(
    "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
    [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
  );
}

function conversionKey(idempotencyKey: string): string {
  const key = idempotencyKey.trim();
  if (!key || key.length > 200) throw new AppError("VALIDATION_FAILED", "A valid idempotency-key is required");
  return key;
}

function positiveRowVersion(rowVersion: number): number {
  if (!Number.isInteger(rowVersion) || rowVersion < 1) throw new AppError("VALIDATION_FAILED", "row_version must be a positive integer");
  return rowVersion;
}

export class PostgresRistoBookingHoldLifecycle {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async expireDue(context: SecurityContext, now = new Date(), limit = 100): Promise<readonly BookingHoldPrivateProjectionV1[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AppError("VALIDATION_FAILED", "Expiry batch limit must be between 1 and 500");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applyTrustedScope(client, context, this.assumeRole);
      const due = await client.query(
        `SELECT id
           FROM risto_booking_holds
          WHERE tenant_id=$1 AND location_id=$2
            AND status IN ('CREATED','GUARANTEE_REQUIRED','GUARANTEE_PENDING','GUARANTEED')
            AND expires_at <= $3::timestamptz
          ORDER BY expires_at,id
          FOR UPDATE SKIP LOCKED
          LIMIT $4`,
        [context.tenantId, context.locationId, now.toISOString(), limit]
      );

      const expired: BookingHoldPrivateProjectionV1[] = [];
      for (const row of due.rows) {
        const updated = await client.query(
          `UPDATE risto_booking_holds
              SET status='EXPIRED',expired_at=$2::timestamptz,updated_by_identity_id=$3,updated_at=now(),row_version=row_version+1
            WHERE id=$1
              AND status IN ('CREATED','GUARANTEE_REQUIRED','GUARANTEE_PENDING','GUARANTEED')
              AND expires_at <= $2::timestamptz
            RETURNING id,status,source_channel,source_external_reference,resource_key,party_size,capacity_claim,
                      booking_date,booking_time_local,starts_at,expected_duration_minutes,expires_at,
                      guarantee_policy_id,guarantee_mode,guarantee_ref,conversion_booking_id,
                      customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,
                      created_at,updated_at,row_version`,
          [row.id, now.toISOString(), context.actorIdentityId]
        );
        if (!updated.rows[0]) continue;
        const hold = mapHold(updated.rows[0]);
        expired.push(hold);
        await client.query(
          `INSERT INTO audit.audit_events
            (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
           VALUES ($1,$2,$3,'service','BOOKING_HOLD_EXPIRED','risto_booking_hold',$4,$5,'success',$6::jsonb)`,
          [context.tenantId, context.locationId, context.actorIdentityId, hold.id, context.correlationId, JSON.stringify({ from_status: "active", to_status: "EXPIRED", result: "success" })]
        );
        await client.query(
          `INSERT INTO events.outbox_events
            (tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
           VALUES ($1,$2,'booking.hold.expired.v1','risto_booking_hold',$3,1,$4::jsonb,$5)`,
          [context.tenantId, context.locationId, hold.id, JSON.stringify({ hold_id: hold.id, to_status: "EXPIRED", expires_at: hold.expiresAt }), context.correlationId]
        );
      }
      await client.query("COMMIT");
      return Object.freeze(expired);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async convert(
    context: SecurityContext,
    holdId: UUID,
    rowVersion: number,
    idempotencyKey: string
  ): Promise<BookingHoldConversionResultV1> {
    const key = conversionKey(idempotencyKey);
    const expectedRowVersion = positiveRowVersion(rowVersion);
    const semanticHash = bookingSemanticHash({ holdId, rowVersion: expectedRowVersion });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applyTrustedScope(client, context, this.assumeRole);

      const insertedKey = await client.query(
        `INSERT INTO foundation_idempotency_keys
          (actor_identity_id,tenant_id,location_id,canonical_function_id,idempotency_key,semantic_hash,state,lease_until,expires_at)
         VALUES ($1,$2,$3,'RST-F-BKG-HOLD-003',$4,$5,'IN_PROGRESS',now()+interval '30 seconds',now()+interval '72 hours')
         ON CONFLICT DO NOTHING RETURNING id`,
        [context.actorIdentityId, context.tenantId, context.locationId, key, semanticHash]
      );
      if (insertedKey.rowCount !== 1) {
        const existing = await client.query(
          `SELECT semantic_hash,state,result_json,lease_until,expires_at
             FROM foundation_idempotency_keys
            WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
              AND canonical_function_id='RST-F-BKG-HOLD-003' AND idempotency_key=$4
            FOR UPDATE`,
          [context.actorIdentityId, context.tenantId, context.locationId, key]
        );
        const row = existing.rows[0] as { semantic_hash: string; state: string; result_json: BookingHoldConversionResultV1 | null; lease_until: Date; expires_at: Date } | undefined;
        if (!row) throw new AppError("INTERNAL_ERROR", "BookingHold conversion idempotency row disappeared");
        if (row.semantic_hash !== semanticHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different semantic payload");
        if (row.expires_at <= new Date()) throw new AppError("CONFLICT", "Expired idempotency key must be retried with a new key");
        if (row.state === "COMPLETED" && row.result_json) {
          await client.query("COMMIT");
          return Object.freeze({ ...row.result_json, replayed: true });
        }
        if (row.state === "IN_PROGRESS" && row.lease_until > new Date()) throw new AppError("CONFLICT", "Idempotent mutation is already in progress");
        await client.query(
          `UPDATE foundation_idempotency_keys SET state='IN_PROGRESS',lease_until=now()+interval '30 seconds',updated_at=now()
            WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
              AND canonical_function_id='RST-F-BKG-HOLD-003' AND idempotency_key=$4`,
          [context.actorIdentityId, context.tenantId, context.locationId, key]
        );
      }

      const locked = await client.query(
        `SELECT id,tenant_id,location_id,capacity_slot_id,status,source_channel,source_external_reference,party_size,
                booking_date,booking_time_local,starts_at,expected_duration_minutes,expires_at,conversion_booking_id,
                customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,row_version
           FROM risto_booking_holds
          WHERE id=$1
          FOR UPDATE`,
        [holdId]
      );
      const holdRow = locked.rows[0];
      if (!holdRow) throw new AppError("NOT_FOUND", "RESOURCE_NOT_FOUND_OR_NOT_VISIBLE");
      if (String(holdRow.status) !== "GUARANTEED") throw new AppError("CONFLICT", "BookingHold must be GUARANTEED before conversion");
      if (new Date(holdRow.expires_at).getTime() <= Date.now()) throw new AppError("CONFLICT", "Expired BookingHold cannot be converted");
      if (holdRow.conversion_booking_id) throw new AppError("CONFLICT", "BookingHold has already been converted");
      if (Number(holdRow.row_version) !== expectedRowVersion) throw new AppError("CONFLICT", "BookingHold optimistic concurrency conflict");

      const slot = await client.query(
        `SELECT id FROM risto_booking_capacity_slots WHERE id=$1 FOR UPDATE`,
        [holdRow.capacity_slot_id]
      );
      if (!slot.rows[0]) throw new AppError("CONFLICT", "BOOKING_CAPACITY_SLOT_NOT_CONFIGURED");

      const bookingInsert = await client.query(
        `INSERT INTO risto_bookings
          (tenant_id,location_id,capacity_slot_id,source,external_reference,party_size,booking_date,booking_time_local,
           starts_at,expected_duration_minutes,status,customer_name_snapshot,phone_snapshot,email_snapshot,notes,
           special_requests,created_by_identity_id,updated_by_identity_id,environment_class)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REQUESTED',$11,$12,$13,$14,$15,$16,$16,'TEST_TEMPORARY')
         RETURNING id,status,party_size,booking_date,booking_time_local,starts_at,expected_duration_minutes,source,
                   customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,zone_id,table_id,event_id,
                   arrival_at,seated_at,completed_at,cancelled_at,cancellation_reason,no_show_at,created_at,updated_at,row_version`,
        [
          context.tenantId,
          context.locationId,
          holdRow.capacity_slot_id,
          holdRow.source_channel,
          holdRow.source_external_reference,
          holdRow.party_size,
          holdRow.booking_date,
          holdRow.booking_time_local,
          holdRow.starts_at,
          holdRow.expected_duration_minutes,
          holdRow.customer_name_snapshot,
          holdRow.phone_snapshot,
          holdRow.email_snapshot,
          holdRow.notes,
          holdRow.special_requests,
          context.actorIdentityId
        ]
      );
      const booking = mapBooking(bookingInsert.rows[0]);

      const holdUpdate = await client.query(
        `UPDATE risto_booking_holds
            SET status='CONVERTED',conversion_booking_id=$2,converted_at=now(),updated_by_identity_id=$3,updated_at=now(),row_version=row_version+1
          WHERE id=$1 AND status='GUARANTEED' AND row_version=$4
          RETURNING id,status,source_channel,source_external_reference,resource_key,party_size,capacity_claim,
                    booking_date,booking_time_local,starts_at,expected_duration_minutes,expires_at,
                    guarantee_policy_id,guarantee_mode,guarantee_ref,conversion_booking_id,
                    customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,
                    created_at,updated_at,row_version`,
        [holdId, booking.id, context.actorIdentityId, expectedRowVersion]
      );
      if (!holdUpdate.rows[0]) throw new AppError("CONFLICT", "BookingHold optimistic concurrency conflict");
      const hold = mapHold(holdUpdate.rows[0]);

      await client.query(
        `INSERT INTO audit.audit_events
          (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
         VALUES
          ($1,$2,$3,'user','BOOKING_HOLD_CONVERTED','risto_booking_hold',$4,$5,'success',$6::jsonb),
          ($1,$2,$3,'user','BOOKING_CREATED','Booking',$7,$5,'success',$8::jsonb)`,
        [
          context.tenantId,
          context.locationId,
          context.actorIdentityId,
          hold.id,
          context.correlationId,
          JSON.stringify({ booking_id: booking.id, result: "success" }),
          booking.id,
          JSON.stringify({ source: booking.source, conversion_hold_id: hold.id, result: "success" })
        ]
      );
      await client.query(
        `INSERT INTO events.outbox_events
          (tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
         VALUES
          ($1,$2,'booking.hold.converted.v1','risto_booking_hold',$3,1,$4::jsonb,$5),
          ($1,$2,'booking.created.v1','Booking',$6,1,$7::jsonb,$5)`,
        [
          context.tenantId,
          context.locationId,
          hold.id,
          JSON.stringify({ hold_id: hold.id, booking_id: booking.id, to_status: "CONVERTED" }),
          context.correlationId,
          booking.id,
          JSON.stringify({ booking_id: booking.id, status: booking.status, starts_at: booking.startsAt, party_size: booking.partySize, conversion_hold_id: hold.id })
        ]
      );

      const result: BookingHoldConversionResultV1 = Object.freeze({ hold, booking, replayed: false });
      const completed = await client.query(
        `UPDATE foundation_idempotency_keys
            SET state='COMPLETED',result_json=$6::jsonb,lease_until=now(),updated_at=now()
          WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
            AND canonical_function_id='RST-F-BKG-HOLD-003' AND idempotency_key=$4 AND semantic_hash=$5`,
        [context.actorIdentityId, context.tenantId, context.locationId, key, semanticHash, JSON.stringify(result)]
      );
      if (completed.rowCount !== 1) throw new AppError("IDEMPOTENCY_CONFLICT", "BookingHold conversion idempotency completion mismatch");

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
