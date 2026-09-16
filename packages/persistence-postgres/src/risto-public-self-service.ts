import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { BookingPrivateProjectionV1, BookingStatus } from "../../booking-core/src/contracts.ts";
import type { ResolvedPublicTenantV1 } from "../../ristoairen/src/public-content/contracts.ts";
import {
  PUBLIC_SELF_SERVICE_BOOKING_SOURCE,
  PUBLIC_SELF_SERVICE_IDENTITY_ID,
  type OwnedPublicBookingV1,
  type PublicQueueProjectionV1,
  type PublicSelfServiceOwnershipRepository,
} from "../../ristoairen/src/public-self-service/contracts.ts";

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function bookingProjection(row: QueryResultRow): BookingPrivateProjectionV1 {
  return Object.freeze({
    id: String(row.id),
    status: String(row.status) as BookingStatus,
    partySize: Number(row.party_size),
    bookingDate: String(row.booking_date).slice(0, 10),
    bookingTimeLocal: String(row.booking_time_local),
    startsAt: new Date(row.starts_at).toISOString(),
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
    arrivalAt: row.arrival_at == null ? undefined : new Date(row.arrival_at).toISOString(),
    seatedAt: row.seated_at == null ? undefined : new Date(row.seated_at).toISOString(),
    completedAt: row.completed_at == null ? undefined : new Date(row.completed_at).toISOString(),
    cancelledAt: row.cancelled_at == null ? undefined : new Date(row.cancelled_at).toISOString(),
    cancellationReason: optionalString(row.cancellation_reason),
    noShowAt: row.no_show_at == null ? undefined : new Date(row.no_show_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    rowVersion: Number(row.row_version),
  });
}

const BOOKING_COLUMNS = `id,status,party_size,booking_date,booking_time_local,starts_at,expected_duration_minutes,
 source,customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,zone_id,table_id,event_id,
 arrival_at,seated_at,completed_at,cancelled_at,cancellation_reason,no_show_at,created_at,updated_at,row_version`;

async function withPublicScope<T>(
  pool: Pool,
  scope: ResolvedPublicTenantV1,
  correlationId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN");
    began = true;
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL ROLE airen_app");
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
      [PUBLIC_SELF_SERVICE_IDENTITY_ID, scope.tenantId, scope.locationId, correlationId],
    );
    return await fn(client);
  } finally {
    if (began) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    client.release();
  }
}

export class PostgresRistoPublicSelfServiceRepository implements PublicSelfServiceOwnershipRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findOwnedBooking(
    scope: ResolvedPublicTenantV1,
    credentialHash: string,
    correlationId: string,
  ): Promise<OwnedPublicBookingV1 | null> {
    return withPublicScope(this.pool, scope, correlationId, async (client) => {
      const result = await client.query(
        `SELECT ${BOOKING_COLUMNS}
           FROM public.risto_bookings
          WHERE tenant_id=$1::uuid
            AND location_id=$2::uuid
            AND source=$3
            AND external_reference=$4
            AND status IN ('REQUESTED','PENDING','CONFIRMED')
          LIMIT 1`,
        [scope.tenantId, scope.locationId, PUBLIC_SELF_SERVICE_BOOKING_SOURCE, credentialHash],
      );
      if (!result.rows[0]) return null;
      const booking = bookingProjection(result.rows[0]);
      return Object.freeze({ bookingId: booking.id, booking });
    });
  }

  async findOwnedQueue(
    scope: ResolvedPublicTenantV1,
    credentialHash: string,
    correlationId: string,
  ): Promise<PublicQueueProjectionV1 | null> {
    return withPublicScope(this.pool, scope, correlationId, async (client) => {
      const result = await client.query(
        `SELECT status,party_size,row_version,created_at,updated_at
           FROM ristoairen.guest_queue_entries
          WHERE tenant_id=$1::uuid
            AND location_id=$2::uuid
            AND request_key=$3
            AND status IN ('WAITING','CALLED')
          LIMIT 1`,
        [scope.tenantId, scope.locationId, credentialHash],
      );
      const row = result.rows[0];
      if (!row) return null;
      return Object.freeze({
        kind: "queue",
        status: String(row.status) as "WAITING" | "CALLED",
        partySize: Number(row.party_size),
        rowVersion: Number(row.row_version),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      });
    });
  }
}
