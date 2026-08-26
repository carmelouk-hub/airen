import { createHmac, timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { AppError, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import type {
  BookingAuditEvent,
  BookingCreateInputV1,
  BookingMutationResultV1,
  BookingMutationTransaction,
  BookingOutboxEvent,
  BookingPrivateListResultV1,
  BookingPrivateProjectionV1,
  BookingQueryInputV1,
  BookingReadRepository,
  BookingStatus,
  BookingStatusTransitionInputV1,
  BookingUnitOfWork,
  BookingUpdateInputV1,
  IdempotencyClaim,
  IdempotencyScope
} from "../../ristoairen/src/booking/contracts.ts";
import { claimFoundationIdempotency, completeFoundationIdempotency } from "./idempotency-control-plane.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function asString(value: unknown): string { return String(value); }
function optionalString(value: unknown): string | undefined { return value == null ? undefined : String(value); }

function projection(row: QueryResultRow): BookingPrivateProjectionV1 {
  return Object.freeze({
    id: asString(row.id),
    status: asString(row.status) as BookingStatus,
    partySize: Number(row.party_size),
    bookingDate: asString(row.booking_date).slice(0, 10),
    bookingTimeLocal: asString(row.booking_time_local),
    startsAt: new Date(row.starts_at).toISOString(),
    expectedDurationMinutes: Number(row.expected_duration_minutes),
    source: asString(row.source),
    customerNameSnapshot: asString(row.customer_name_snapshot),
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
    rowVersion: Number(row.row_version)
  });
}

const PROJECTION_COLUMNS = `id,status,party_size,booking_date,booking_time_local,starts_at,expected_duration_minutes,source,
 customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,zone_id,table_id,event_id,
 arrival_at,seated_at,completed_at,cancelled_at,cancellation_reason,no_show_at,created_at,updated_at,row_version`;

type CursorPayload = Readonly<{ startsAt: string; id: string; order: "starts_at.asc" | "starts_at.desc" }>;

class BookingCursorCodec {
  constructor(private readonly key: string) {
    if (key.length < 32) throw new Error("Booking cursor HMAC key must be at least 32 characters");
  }
  encode(payload: CursorPayload): string {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.key).update(body).digest("base64url");
    return `${body}.${sig}`;
  }
  decode(cursor: string): CursorPayload {
    const [body, signature, extra] = cursor.split(".");
    if (!body || !signature || extra) throw new AppError("VALIDATION_FAILED", "Invalid Booking cursor");
    const expected = createHmac("sha256", this.key).update(body).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(signature, "base64url"); } catch { throw new AppError("VALIDATION_FAILED", "Invalid Booking cursor"); }
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new AppError("VALIDATION_FAILED", "Invalid Booking cursor signature");
    try {
      const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CursorPayload;
      if (!parsed.startsAt || !parsed.id || (parsed.order !== "starts_at.asc" && parsed.order !== "starts_at.desc")) throw new Error("bad cursor");
      return parsed;
    } catch { throw new AppError("VALIDATION_FAILED", "Invalid Booking cursor payload"); }
  }
}

async function applyTrustedScope(client: PoolClient, context: SecurityContext, assumeRole?: string): Promise<void> {
  if (assumeRole) await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(assumeRole)}`);
  await client.query(
    "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
    [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
  );
}

async function withScopedRead<T>(pool: Pool, context: SecurityContext, assumeRole: string | undefined, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await applyTrustedScope(client, context, assumeRole);
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
    throw error;
  } finally {
    if (!(client as unknown as { released?: boolean }).released) client.release();
  }
}

export class PostgresRistoBookingReadRepository implements BookingReadRepository {
  private readonly cursor: BookingCursorCodec;
  constructor(private readonly pool: Pool, cursorHmacKey: string, private readonly assumeRole = "airen_app") {
    this.cursor = new BookingCursorCodec(cursorHmacKey);
  }

  async query(context: SecurityContext, input: BookingQueryInputV1): Promise<BookingPrivateListResultV1> {
    return withScopedRead(this.pool, context, this.assumeRole, async (client) => {
      const limit = input.limit ?? 50;
      const order = input.order ?? "starts_at.asc";
      const values: unknown[] = [];
      const where: string[] = [];
      if (input.statuses?.length) { values.push(input.statuses); where.push(`status = ANY($${values.length}::text[])`); }
      if (input.fromDate) { values.push(input.fromDate); where.push(`booking_date >= $${values.length}::date`); }
      if (input.toDate) { values.push(input.toDate); where.push(`booking_date <= $${values.length}::date`); }
      if (input.cursor) {
        const decoded = this.cursor.decode(input.cursor);
        if (decoded.order !== order) throw new AppError("VALIDATION_FAILED", "Booking cursor order mismatch");
        values.push(decoded.startsAt, decoded.id);
        const op = order === "starts_at.asc" ? ">" : "<";
        where.push(`(starts_at,id) ${op} ($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
      }
      values.push(limit + 1);
      const direction = order === "starts_at.asc" ? "ASC" : "DESC";
      const sql = `SELECT ${PROJECTION_COLUMNS} FROM risto_bookings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY starts_at ${direction}, id ${direction} LIMIT $${values.length}`;
      const result = await client.query(sql, values);
      const rows = result.rows.slice(0, limit).map(projection);
      const extra = result.rows.length > limit ? rows[rows.length - 1] : undefined;
      return Object.freeze({
        items: rows,
        nextCursor: extra ? this.cursor.encode({ startsAt: extra.startsAt, id: extra.id, order }) : undefined
      });
    });
  }

  async findVisibleById(context: SecurityContext, bookingId: UUID): Promise<BookingPrivateProjectionV1 | null> {
    return withScopedRead(this.pool, context, this.assumeRole, async (client) => {
      const result = await client.query(`SELECT ${PROJECTION_COLUMNS} FROM risto_bookings WHERE id=$1`, [bookingId]);
      return result.rows[0] ? projection(result.rows[0]) : null;
    });
  }
}

class PostgresRistoBookingMutationTransaction implements BookingMutationTransaction {
  constructor(private readonly client: PoolClient) {}

  async findVisibleById(bookingId: UUID): Promise<BookingPrivateProjectionV1 | null> {
    const result = await this.client.query(`SELECT ${PROJECTION_COLUMNS} FROM risto_bookings WHERE id=$1 FOR UPDATE`, [bookingId]);
    return result.rows[0] ? projection(result.rows[0]) : null;
  }
  claimIdempotency(scope: IdempotencyScope): Promise<IdempotencyClaim> { return claimFoundationIdempotency(this.client, scope); }
  completeIdempotency(scope: IdempotencyScope, result: BookingMutationResultV1): Promise<void> { return completeFoundationIdempotency(this.client, scope, result); }

  async insertBooking(input: BookingCreateInputV1, context: SecurityContext): Promise<BookingPrivateProjectionV1> {
    const result = await this.client.query(
      `INSERT INTO risto_bookings
       (tenant_id,location_id,customer_profile_id,event_id,zone_id,table_id,source,external_reference,party_size,booking_date,booking_time_local,
        starts_at,expected_duration_minutes,status,customer_name_snapshot,phone_snapshot,email_snapshot,notes,special_requests,created_by_identity_id,updated_by_identity_id,environment_class)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::time,
              ($10::date + $11::time) AT TIME ZONE l.timezone,$12,'REQUESTED',$13,$14,$15,$16,$17,$18,$18,'TEST_TEMPORARY'
         FROM platform.locations l WHERE l.id=$2 AND l.tenant_id=$1 AND l.status='active'
       RETURNING ${PROJECTION_COLUMNS}`,
      [context.tenantId, context.locationId, input.customerProfileId ?? null, input.eventId ?? null, input.zoneId ?? null, input.tableId ?? null,
       input.source.trim(), input.externalReference ?? null, input.partySize, input.bookingDate, input.bookingTimeLocal, input.expectedDurationMinutes,
       input.customerNameSnapshot.trim(), input.phoneSnapshot ?? null, input.emailSnapshot ?? null, input.notes ?? null, input.specialRequests ?? null, context.actorIdentityId]
    );
    if (!result.rows[0]) throw new AppError("LOCATION_SCOPE_VIOLATION", "Trusted active Location was not available for Booking creation");
    return projection(result.rows[0]);
  }

  async updateBooking(bookingId: UUID, input: BookingUpdateInputV1, context: SecurityContext): Promise<BookingPrivateProjectionV1> {
    const result = await this.client.query(
      `UPDATE risto_bookings b SET
         customer_profile_id=COALESCE($2,b.customer_profile_id), event_id=COALESCE($3,b.event_id), zone_id=COALESCE($4,b.zone_id), table_id=COALESCE($5,b.table_id),
         party_size=COALESCE($6,b.party_size), booking_date=COALESCE($7::date,b.booking_date), booking_time_local=COALESCE($8::time,b.booking_time_local),
         expected_duration_minutes=COALESCE($9,b.expected_duration_minutes), customer_name_snapshot=COALESCE($10,b.customer_name_snapshot),
         phone_snapshot=CASE WHEN $11::boolean THEN $12 ELSE b.phone_snapshot END,
         email_snapshot=CASE WHEN $13::boolean THEN $14 ELSE b.email_snapshot END,
         notes=CASE WHEN $15::boolean THEN $16 ELSE b.notes END,
         special_requests=CASE WHEN $17::boolean THEN $18 ELSE b.special_requests END,
         starts_at=(COALESCE($7::date,b.booking_date)+COALESCE($8::time,b.booking_time_local)) AT TIME ZONE l.timezone,
         updated_by_identity_id=$19, updated_at=now(), row_version=row_version+1
        FROM platform.locations l
       WHERE b.id=$1 AND b.location_id=l.id AND b.tenant_id=l.tenant_id AND b.row_version=$20
       RETURNING ${PROJECTION_COLUMNS.replaceAll("id", "b.id")}`,
      [bookingId, input.customerProfileId ?? null, input.eventId ?? null, input.zoneId ?? null, input.tableId ?? null,
       input.partySize ?? null, input.bookingDate ?? null, input.bookingTimeLocal ?? null, input.expectedDurationMinutes ?? null, input.customerNameSnapshot ?? null,
       Object.hasOwn(input,"phoneSnapshot"), input.phoneSnapshot ?? null, Object.hasOwn(input,"emailSnapshot"), input.emailSnapshot ?? null,
       Object.hasOwn(input,"notes"), input.notes ?? null, Object.hasOwn(input,"specialRequests"), input.specialRequests ?? null,
       context.actorIdentityId, input.rowVersion]
    );
    if (!result.rows[0]) throw new AppError("CONFLICT", "Booking row_version conflict or resource is not visible");
    return projection(result.rows[0]);
  }

  async transitionBookingStatus(bookingId: UUID, fromStatus: BookingStatus, input: BookingStatusTransitionInputV1, context: SecurityContext): Promise<BookingPrivateProjectionV1> {
    const requested = input.requestedStatus;
    const result = await this.client.query(
      `UPDATE risto_bookings SET status=$2,
         arrival_at=CASE WHEN $2='ARRIVED' THEN COALESCE(arrival_at,now()) ELSE arrival_at END,
         seated_at=CASE WHEN $2='SEATED' THEN COALESCE(seated_at,now()) ELSE seated_at END,
         completed_at=CASE WHEN $2='COMPLETED' THEN COALESCE(completed_at,now()) ELSE completed_at END,
         cancelled_at=CASE WHEN $2='CANCELLED' THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END,
         cancellation_reason=CASE WHEN $2='CANCELLED' THEN $3 ELSE cancellation_reason END,
         no_show_at=CASE WHEN $2='NO_SHOW' THEN COALESCE(no_show_at,now()) ELSE no_show_at END,
         updated_by_identity_id=$4, updated_at=now(), row_version=row_version+1
       WHERE id=$1 AND status=$5 AND row_version=$6
       RETURNING ${PROJECTION_COLUMNS}`,
      [bookingId, requested, input.reason ?? null, context.actorIdentityId, fromStatus, input.rowVersion]
    );
    if (!result.rows[0]) throw new AppError("CONFLICT", "Booking status/row_version conflict or resource is not visible");
    return projection(result.rows[0]);
  }

  async appendAudit(event: BookingAuditEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_events (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
       VALUES ($1,$2,$3,'user',$4,'Booking',$5,$6,'success',$7::jsonb)`,
      [event.tenantId,event.locationId,event.actorIdentityId,event.eventType,event.bookingId,event.correlationId,JSON.stringify(event.metadata)]
    );
  }

  async appendOutbox(event: BookingOutboxEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO events.outbox_events (tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
       VALUES ($1,$2,$3,'Booking',$4,1,$5::jsonb,$6)`,
      [event.tenantId,event.locationId,event.eventType,event.bookingId,JSON.stringify(event.payload),event.correlationId]
    );
  }
}

export class PostgresRistoBookingUnitOfWork implements BookingUnitOfWork {
  constructor(private readonly pool: Pool, private readonly assumeRole = "airen_app") {}
  async transaction<T>(context: SecurityContext, fn: (tx: BookingMutationTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applyTrustedScope(client, context, this.assumeRole);
      const result = await fn(new PostgresRistoBookingMutationTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
