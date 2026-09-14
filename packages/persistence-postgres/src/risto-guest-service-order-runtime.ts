import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import { AppError, type DomainEvent, type SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  BookingRecord,
  GuestQueueEntryRecord,
  ReservationQueueOutboxEvent,
  ReservationQueueTransaction
} from "../../ristoairen/src/reservations/reservation-queue-service.ts";
import type {
  DiningTableRecord,
  FloorSeatingTransaction,
  SeatingChangedOutboxEvent,
  SeatingServiceSessionRecord
} from "../../ristoairen/src/floor/floor-seating-service.ts";
import type {
  ServiceSessionOutboxEvent,
  ServiceSessionRecord,
  ServiceSessionTransaction
} from "../../ristoairen/src/service/service-session-service.ts";
import type {
  OrderIntakeTransaction,
  OrderOutboxEvent,
  OrderRecord
} from "../../ristoairen/src/orders/order-intake-service.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function bookingFromRow(row: Record<string, unknown>): BookingRecord {
  return Object.freeze({
    id: String(row.id), tenantId: String(row.tenantId), locationId: String(row.locationId),
    requestKey: String(row.requestKey), status: String(row.status) as BookingRecord["status"],
    partySize: Number(row.partySize), rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass) as BookingRecord["environmentClass"],
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt)
  });
}

function queueFromRow(row: Record<string, unknown>): GuestQueueEntryRecord {
  return Object.freeze({
    id: String(row.id), tenantId: String(row.tenantId), locationId: String(row.locationId),
    requestKey: String(row.requestKey),
    ...(row.bookingId == null ? {} : { bookingId: String(row.bookingId) }),
    status: String(row.status) as GuestQueueEntryRecord["status"], partySize: Number(row.partySize),
    rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass) as GuestQueueEntryRecord["environmentClass"],
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt)
  });
}

function tableFromRow(row: Record<string, unknown>): DiningTableRecord {
  return Object.freeze({
    id: String(row.id), tenantId: String(row.tenantId), locationId: String(row.locationId),
    code: String(row.code), operationalStatus: String(row.operationalStatus) as DiningTableRecord["operationalStatus"],
    capacity: Number(row.capacity), rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass) as DiningTableRecord["environmentClass"],
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt)
  });
}

function sessionFromRow(row: Record<string, unknown>): ServiceSessionRecord {
  return Object.freeze({
    id: String(row.id), tenantId: String(row.tenantId), locationId: String(row.locationId),
    tableId: String(row.tableId),
    ...(row.bookingId == null ? {} : { bookingId: String(row.bookingId) }),
    ...(row.queueEntryId == null ? {} : { queueEntryId: String(row.queueEntryId) }),
    status: String(row.status) as ServiceSessionRecord["status"], rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass) as ServiceSessionRecord["environmentClass"],
    openedAt: iso(row.openedAt),
    ...(row.closedAt == null ? {} : { closedAt: iso(row.closedAt) }),
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt)
  });
}

function orderFromRow(row: Record<string, unknown>): OrderRecord {
  return Object.freeze({
    id: String(row.id), tenantId: String(row.tenantId), locationId: String(row.locationId),
    serviceSessionId: String(row.serviceSessionId), requestKey: String(row.requestKey),
    channel: String(row.channel) as OrderRecord["channel"], status: String(row.status) as OrderRecord["status"],
    rowVersion: Number(row.rowVersion), environmentClass: String(row.environmentClass) as OrderRecord["environmentClass"],
    createdAt: iso(row.createdAt),
    ...(row.submittedAt == null ? {} : { submittedAt: iso(row.submittedAt) }),
    updatedAt: iso(row.updatedAt)
  });
}

const BOOKING_SELECT = `SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 request_key AS "requestKey",status,party_size AS "partySize",row_version AS "rowVersion",
 environment_class AS "environmentClass",created_at AS "createdAt",updated_at AS "updatedAt"
 FROM ristoairen.bookings`;

const QUEUE_SELECT = `SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 request_key AS "requestKey",booking_id::text AS "bookingId",status,party_size AS "partySize",
 row_version AS "rowVersion",environment_class AS "environmentClass",created_at AS "createdAt",updated_at AS "updatedAt"
 FROM ristoairen.guest_queue_entries`;

const TABLE_SELECT = `SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 code,operational_status AS "operationalStatus",capacity,row_version AS "rowVersion",
 environment_class AS "environmentClass",created_at AS "createdAt",updated_at AS "updatedAt"
 FROM ristoairen.dining_tables`;

const SESSION_SELECT = `SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 table_id::text AS "tableId",booking_id::text AS "bookingId",queue_entry_id::text AS "queueEntryId",status,
 row_version AS "rowVersion",environment_class AS "environmentClass",opened_at AS "openedAt",closed_at AS "closedAt",
 created_at AS "createdAt",updated_at AS "updatedAt" FROM ristoairen.service_sessions`;

const ORDER_SELECT = `SELECT id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
 service_session_id::text AS "serviceSessionId",request_key AS "requestKey",channel,status,row_version AS "rowVersion",
 environment_class AS "environmentClass",created_at AS "createdAt",submitted_at AS "submittedAt",updated_at AS "updatedAt"
 FROM ristoairen.orders`;

export class PostgresGuestServiceOrderTransaction
implements ReservationQueueTransaction, FloorSeatingTransaction, ServiceSessionTransaction, OrderIntakeTransaction {
  private readonly client: PoolClient;
  private readonly context: SecurityContext;

  constructor(client: PoolClient, context: SecurityContext) {
    this.client = client;
    this.context = context;
  }

  async getBookingForTransition(bookingId: string): Promise<BookingRecord | null> {
    const result = await this.client.query(`${BOOKING_SELECT} WHERE id=$1::uuid FOR UPDATE`, [bookingId]);
    return result.rows[0] ? bookingFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async transitionBooking(input: Readonly<{
    bookingId: string; expectedRowVersion: number; nextStatus: BookingRecord["status"]; updatedAt: string;
  }>): Promise<BookingRecord> {
    const result = await this.client.query(
      `UPDATE ristoairen.bookings SET status=$3,row_version=row_version+1,updated_at=$4::timestamptz
        WHERE id=$1::uuid AND row_version=$2
        RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
         request_key AS "requestKey",status,party_size AS "partySize",row_version AS "rowVersion",
         environment_class AS "environmentClass",created_at AS "createdAt",updated_at AS "updatedAt"`,
      [input.bookingId, input.expectedRowVersion, input.nextStatus, input.updatedAt]
    );
    if (!result.rows[0]) throw new AppError("CONFLICT", "Booking row_version is stale");
    return bookingFromRow(result.rows[0] as Record<string, unknown>);
  }

  async getQueueEntryForTransition(queueEntryId: string): Promise<GuestQueueEntryRecord | null> {
    const result = await this.client.query(`${QUEUE_SELECT} WHERE id=$1::uuid FOR UPDATE`, [queueEntryId]);
    return result.rows[0] ? queueFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async transitionQueueEntry(input: Readonly<{
    queueEntryId: string; expectedRowVersion: number; nextStatus: GuestQueueEntryRecord["status"]; updatedAt: string;
  }>): Promise<GuestQueueEntryRecord> {
    const result = await this.client.query(
      `UPDATE ristoairen.guest_queue_entries SET status=$3,row_version=row_version+1,updated_at=$4::timestamptz
        WHERE id=$1::uuid AND row_version=$2
        RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
         request_key AS "requestKey",booking_id::text AS "bookingId",status,party_size AS "partySize",
         row_version AS "rowVersion",environment_class AS "environmentClass",created_at AS "createdAt",updated_at AS "updatedAt"`,
      [input.queueEntryId, input.expectedRowVersion, input.nextStatus, input.updatedAt]
    );
    if (!result.rows[0]) throw new AppError("CONFLICT", "GuestQueueEntry row_version is stale");
    return queueFromRow(result.rows[0] as Record<string, unknown>);
  }

  async getSessionForSeating(serviceSessionId: string): Promise<SeatingServiceSessionRecord | null> {
    const result = await this.client.query(`${SESSION_SELECT} WHERE id=$1::uuid FOR UPDATE`, [serviceSessionId]);
    return result.rows[0] ? sessionFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async getTableForSeating(tableId: string): Promise<DiningTableRecord | null> {
    const result = await this.client.query(`${TABLE_SELECT} WHERE id=$1::uuid FOR UPDATE`, [tableId]);
    return result.rows[0] ? tableFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async moveOpenSessionToTable(input: Readonly<{
    serviceSessionId: string;
    expectedSessionRowVersion: number;
    fromTableId: string;
    expectedFromTableRowVersion: number;
    toTableId: string;
    expectedToTableRowVersion: number;
    updatedAt: string;
  }>): Promise<Readonly<{ session: SeatingServiceSessionRecord; fromTable: DiningTableRecord; toTable: DiningTableRecord }>> {
    const fromResult = await this.client.query(
      `UPDATE ristoairen.dining_tables SET row_version=row_version+1,updated_at=$3::timestamptz
        WHERE id=$1::uuid AND row_version=$2
        RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",code,
         operational_status AS "operationalStatus",capacity,row_version AS "rowVersion",environment_class AS "environmentClass",
         created_at AS "createdAt",updated_at AS "updatedAt"`,
      [input.fromTableId, input.expectedFromTableRowVersion, input.updatedAt]
    );
    if (!fromResult.rows[0]) throw new AppError("CONFLICT", "Current DiningTable row_version is stale");

    const toResult = await this.client.query(
      `UPDATE ristoairen.dining_tables SET row_version=row_version+1,updated_at=$3::timestamptz
        WHERE id=$1::uuid AND row_version=$2 AND operational_status='ACTIVE'
        RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",code,
         operational_status AS "operationalStatus",capacity,row_version AS "rowVersion",environment_class AS "environmentClass",
         created_at AS "createdAt",updated_at AS "updatedAt"`,
      [input.toTableId, input.expectedToTableRowVersion, input.updatedAt]
    );
    if (!toResult.rows[0]) throw new AppError("CONFLICT", "Target DiningTable row_version is stale or unavailable");

    try {
      const sessionResult = await this.client.query(
        `UPDATE ristoairen.service_sessions SET table_id=$3::uuid,row_version=row_version+1,updated_at=$4::timestamptz
          WHERE id=$1::uuid AND row_version=$2 AND status='OPEN' AND table_id=$5::uuid
          RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
           table_id::text AS "tableId",booking_id::text AS "bookingId",queue_entry_id::text AS "queueEntryId",status,
           row_version AS "rowVersion",environment_class AS "environmentClass",opened_at AS "openedAt",closed_at AS "closedAt",
           created_at AS "createdAt",updated_at AS "updatedAt"`,
        [input.serviceSessionId, input.expectedSessionRowVersion, input.toTableId, input.updatedAt, input.fromTableId]
      );
      if (!sessionResult.rows[0]) throw new AppError("CONFLICT", "ServiceSession row_version is stale");
      return Object.freeze({
        session: sessionFromRow(sessionResult.rows[0] as Record<string, unknown>),
        fromTable: tableFromRow(fromResult.rows[0] as Record<string, unknown>),
        toTable: tableFromRow(toResult.rows[0] as Record<string, unknown>)
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new AppError("CONFLICT", "Target DiningTable already has an OPEN ServiceSession");
      }
      throw error;
    }
  }

  async getServiceSessionForTransition(serviceSessionId: string): Promise<ServiceSessionRecord | null> {
    const result = await this.client.query(`${SESSION_SELECT} WHERE id=$1::uuid FOR UPDATE`, [serviceSessionId]);
    return result.rows[0] ? sessionFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async transitionServiceSession(input: Readonly<{
    serviceSessionId: string;
    expectedRowVersion: number;
    nextStatus: "CLOSED" | "CANCELLED";
    closedAt: string;
    updatedAt: string;
  }>): Promise<ServiceSessionRecord> {
    const result = await this.client.query(
      `UPDATE ristoairen.service_sessions
          SET status=$3,closed_at=$4::timestamptz,row_version=row_version+1,updated_at=$5::timestamptz
        WHERE id=$1::uuid AND row_version=$2 AND status='OPEN'
        RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
         table_id::text AS "tableId",booking_id::text AS "bookingId",queue_entry_id::text AS "queueEntryId",status,
         row_version AS "rowVersion",environment_class AS "environmentClass",opened_at AS "openedAt",closed_at AS "closedAt",
         created_at AS "createdAt",updated_at AS "updatedAt"`,
      [input.serviceSessionId, input.expectedRowVersion, input.nextStatus, input.closedAt, input.updatedAt]
    );
    if (!result.rows[0]) throw new AppError("CONFLICT", "ServiceSession row_version is stale or state changed");
    return sessionFromRow(result.rows[0] as Record<string, unknown>);
  }

  async getOrderForTransition(orderId: string): Promise<OrderRecord | null> {
    const result = await this.client.query(`${ORDER_SELECT} WHERE id=$1::uuid FOR UPDATE`, [orderId]);
    return result.rows[0] ? orderFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async transitionOrder(input: Readonly<{
    orderId: string;
    expectedRowVersion: number;
    nextStatus: "AMENDED" | "CANCELLED" | "COMPLETED";
    updatedAt: string;
  }>): Promise<OrderRecord> {
    const result = await this.client.query(
      `UPDATE ristoairen.orders SET status=$3,row_version=row_version+1,updated_at=$4::timestamptz
        WHERE id=$1::uuid AND row_version=$2 AND status IN ('SUBMITTED','AMENDED')
        RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
         service_session_id::text AS "serviceSessionId",request_key AS "requestKey",channel,status,row_version AS "rowVersion",
         environment_class AS "environmentClass",created_at AS "createdAt",submitted_at AS "submittedAt",updated_at AS "updatedAt"`,
      [input.orderId, input.expectedRowVersion, input.nextStatus, input.updatedAt]
    );
    if (!result.rows[0]) throw new AppError("CONFLICT", "Order row_version is stale or state changed");
    return orderFromRow(result.rows[0] as Record<string, unknown>);
  }

  async audit(record: AuditRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_events
       (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'user',$4,$5,$6,$7,$8,$9::jsonb)`,
      [record.tenantId, record.locationId, record.actorIdentityId, record.actionKey,
       record.resourceType ?? null, record.resourceId ?? null, record.correlationId,
       record.outcome, JSON.stringify(record.metadata ?? {})]
    );
  }

  private async enqueue(input: Readonly<{
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    correlationId: string;
    payload: Readonly<Record<string, unknown>>;
  }>): Promise<void> {
    await this.client.query(
      `INSERT INTO events.outbox_events
       (tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,1,$6::jsonb,$7)`,
      [this.context.tenantId, this.context.locationId, input.eventType, input.aggregateType,
       input.aggregateId, JSON.stringify(input.payload), input.correlationId]
    );
  }

  async enqueueReservationQueueEvent(event: ReservationQueueOutboxEvent): Promise<void> {
    await this.enqueue(event);
  }

  async enqueueSeatingEvent(event: SeatingChangedOutboxEvent): Promise<void> {
    await this.enqueue(event);
  }

  async enqueueServiceSessionEvent(event: ServiceSessionOutboxEvent): Promise<void> {
    await this.enqueue(event);
  }

  async enqueueOrderEvent(event: OrderOutboxEvent): Promise<void> {
    await this.enqueue(event);
  }

  async outbox(_event: DomainEvent & { tenantId: string; locationId: string; correlationId: string }): Promise<void> {
    throw new Error("USE_MAT039_DOMAIN_ENQUEUE_METHOD");
  }
}

export class PostgresGuestServiceOrderUnitOfWork
implements UnitOfWork<ReservationQueueTransaction>, UnitOfWork<FloorSeatingTransaction>,
  UnitOfWork<ServiceSessionTransaction>, UnitOfWork<OrderIntakeTransaction> {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(
    fn: (tx: PostgresGuestServiceOrderTransaction) => Promise<T>,
    context?: SecurityContext
  ): Promise<T> {
    if (!context) throw new Error("SecurityContext is required for MAT-039 guest/service/order runtime");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
      );
      const value = await fn(new PostgresGuestServiceOrderTransaction(client, context));
      await client.query("COMMIT");
      return value;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
