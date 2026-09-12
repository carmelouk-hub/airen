import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  GoldenDinnerServices,
  GoldenDinnerStageResult,
  GoldenDinnerStep
} from "../../ristoairen/src/journeys/golden-dinner-runtime.ts";

const ENVIRONMENT_CLASS = "TEST_TEMPORARY" as const;

type Scope = Readonly<{
  journeyId: string;
  tenantId: string;
  locationId: string;
  correlationId: string;
  idempotencyKey: string;
}>;

type StageWrite = Readonly<{
  step: GoldenDinnerStep;
  sequence: number;
  resourceType: string;
  resourceId: string;
  eventType: string;
  context: SecurityContext;
  scope: Scope;
  payload?: Readonly<Record<string, unknown>>;
}>;

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function assertScope(context: SecurityContext, scope: Scope): void {
  if (scope.tenantId !== context.tenantId) throw new Error("Golden Dinner tenant scope mismatch");
  if (scope.locationId !== context.locationId) throw new Error("Golden Dinner location scope mismatch");
  if (scope.correlationId !== context.correlationId) throw new Error("Golden Dinner correlation scope mismatch");
}

async function withScopedTransaction<T>(
  pool: Pool,
  assumeRole: string,
  context: SecurityContext,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(assumeRole)}`);
    await client.query(
      "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
      [context.actorIdentityId, context.tenantId, context.locationId, context.correlationId]
    );
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function writeStage(client: PoolClient, input: StageWrite): Promise<GoldenDinnerStageResult> {
  assertScope(input.context, input.scope);
  const result = await client.query(
    `INSERT INTO ristoairen.golden_dinner_runtime_events (
       journey_id,tenant_id,location_id,correlation_id,idempotency_key,step,sequence,
       resource_type,resource_id,event_type,actor_identity_id,environment_class,payload
     ) VALUES (
       $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::integer,$8,$9::uuid,$10,$11::uuid,$12,$13::jsonb
     )
     ON CONFLICT (tenant_id,location_id,idempotency_key)
     DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
     RETURNING step,sequence,resource_type AS "resourceType",resource_id::text AS "resourceId",
               event_type AS "eventType",occurred_at AS "occurredAt",actor_identity_id::text AS "actorIdentityId"`,
    [
      input.scope.journeyId,
      input.scope.tenantId,
      input.scope.locationId,
      input.scope.correlationId,
      input.scope.idempotencyKey,
      input.step,
      input.sequence,
      input.resourceType,
      input.resourceId,
      input.eventType,
      input.context.actorIdentityId,
      ENVIRONMENT_CLASS,
      JSON.stringify(input.payload ?? {})
    ]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Golden Dinner persistence returned no row for ${input.step}`);
  return Object.freeze({
    step: String(row.step) as GoldenDinnerStep,
    sequence: Number(row.sequence),
    resourceType: String(row.resourceType),
    resourceId: String(row.resourceId),
    eventType: String(row.eventType),
    occurredAt: new Date(String(row.occurredAt)).toISOString(),
    actorIdentityId: String(row.actorIdentityId)
  });
}

async function existingResourceId(
  client: PoolClient,
  scope: Scope
): Promise<string | null> {
  const result = await client.query(
    `SELECT resource_id::text AS "resourceId"
       FROM ristoairen.golden_dinner_runtime_events
      WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND idempotency_key=$3
      LIMIT 1`,
    [scope.tenantId, scope.locationId, scope.idempotencyKey]
  );
  return result.rows[0] ? String((result.rows[0] as Record<string, unknown>).resourceId) : null;
}

async function stableResourceId(client: PoolClient, scope: Scope): Promise<string> {
  return (await existingResourceId(client, scope)) ?? randomUUID();
}

export class PostgresGoldenDinnerServices implements GoldenDinnerServices {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  readonly party = Object.freeze({
    record: async (
      context: SecurityContext,
      input: Scope & Readonly<{ partySize: number; guestCredentialReference: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, async client => {
      const partyId = await stableResourceId(client, input);
      const stage = await writeStage(client, {
        step: "PARTY_RECORDED", sequence: 1, resourceType: "Party", resourceId: partyId,
        eventType: "risto.party.recorded", context, scope: input,
        payload: { partySize: input.partySize, guestCredentialReference: input.guestCredentialReference }
      });
      return Object.freeze({ ...stage, partyId: stage.resourceId });
    })
  });

  readonly demand = Object.freeze({
    accept: async (
      context: SecurityContext,
      input: Scope & Readonly<{ arrivalMode: "BOOKING" | "QUEUE"; partyId: string; partySize: number; guestCredentialReference: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, async client => {
      const demandReferenceId = await stableResourceId(client, input);
      const stage = await writeStage(client, {
        step: "DEMAND_ACCEPTED", sequence: 2,
        resourceType: input.arrivalMode === "BOOKING" ? "Booking" : "GuestQueueEntry",
        resourceId: demandReferenceId, eventType: "risto.demand.accepted", context, scope: input,
        payload: { arrivalMode: input.arrivalMode, partyId: input.partyId, partySize: input.partySize, guestCredentialReference: input.guestCredentialReference }
      });
      return Object.freeze({ ...stage, demandReferenceId: stage.resourceId });
    })
  });

  readonly seating = Object.freeze({
    seat: async (
      context: SecurityContext,
      input: Scope & Readonly<{ partyId: string; demandReferenceId: string; tableId: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, client => writeStage(client, {
      step: "PARTY_SEATED", sequence: 3, resourceType: "Table", resourceId: input.tableId,
      eventType: "risto.party.seated", context, scope: input,
      payload: { partyId: input.partyId, demandReferenceId: input.demandReferenceId, tableId: input.tableId }
    }))
  });

  readonly session = Object.freeze({
    open: async (
      context: SecurityContext,
      input: Scope & Readonly<{ partyId: string; tableId: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, async client => {
      const serviceSessionId = await stableResourceId(client, input);
      const stage = await writeStage(client, {
        step: "SERVICE_SESSION_OPENED", sequence: 4, resourceType: "ServiceSession", resourceId: serviceSessionId,
        eventType: "risto.service_session.opened", context, scope: input,
        payload: { partyId: input.partyId, tableId: input.tableId }
      });
      return Object.freeze({ ...stage, serviceSessionId: stage.resourceId });
    }),
    close: async (
      context: SecurityContext,
      input: Scope & Readonly<{ serviceSessionId: string; orderId: string; paymentId: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, client => writeStage(client, {
      step: "SERVICE_SESSION_CLOSED", sequence: 10, resourceType: "ServiceSession", resourceId: input.serviceSessionId,
      eventType: "risto.service_session.closed", context, scope: input,
      payload: { serviceSessionId: input.serviceSessionId, orderId: input.orderId, paymentId: input.paymentId }
    }))
  });

  readonly order = Object.freeze({
    submit: async (
      context: SecurityContext,
      input: Scope & Readonly<{ serviceSessionId: string; menuVersionId: string; kitchenItemId: string; barItemId: string; totalAmount: string; currency: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, async client => {
      const orderId = await stableResourceId(client, input);
      const kitchenTicketId = randomUUID();
      const barTicketId = randomUUID();
      const stage = await writeStage(client, {
        step: "ORDER_SUBMITTED", sequence: 5, resourceType: "Order", resourceId: orderId,
        eventType: "risto.order.submitted", context, scope: input,
        payload: {
          serviceSessionId: input.serviceSessionId, menuVersionId: input.menuVersionId,
          kitchenItemId: input.kitchenItemId, barItemId: input.barItemId,
          kitchenTicketId, barTicketId, totalAmount: input.totalAmount, currency: input.currency
        }
      });
      const persisted = await client.query(
        `SELECT payload->>'kitchenTicketId' AS "kitchenTicketId",payload->>'barTicketId' AS "barTicketId"
           FROM ristoairen.golden_dinner_runtime_events
          WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND idempotency_key=$3`,
        [input.tenantId, input.locationId, input.idempotencyKey]
      );
      const row = persisted.rows[0] as Record<string, unknown>;
      return Object.freeze({
        ...stage,
        orderId: stage.resourceId,
        kitchenTicketId: String(row.kitchenTicketId),
        barTicketId: String(row.barTicketId)
      });
    })
  });

  readonly production = Object.freeze({
    ready: async (
      context: SecurityContext,
      input: Scope & Readonly<{ orderId: string; ticketId: string; station: "KITCHEN" | "BAR" }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, client => writeStage(client, {
      step: input.station === "KITCHEN" ? "KITCHEN_READY" : "BAR_READY",
      sequence: input.station === "KITCHEN" ? 6 : 7,
      resourceType: "ProductionTicket", resourceId: input.ticketId,
      eventType: input.station === "KITCHEN" ? "risto.production.kitchen_ready" : "risto.production.bar_ready",
      context, scope: input, payload: { orderId: input.orderId, ticketId: input.ticketId, station: input.station }
    }))
  });

  readonly service = Object.freeze({
    serve: async (
      context: SecurityContext,
      input: Scope & Readonly<{ orderId: string; kitchenTicketId: string; barTicketId: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, client => writeStage(client, {
      step: "ORDER_SERVED", sequence: 8, resourceType: "Order", resourceId: input.orderId,
      eventType: "risto.order.served", context, scope: input,
      payload: { orderId: input.orderId, kitchenTicketId: input.kitchenTicketId, barTicketId: input.barTicketId }
    }))
  });

  readonly settlement = Object.freeze({
    settle: async (
      context: SecurityContext,
      input: Scope & Readonly<{ orderId: string; amount: string; currency: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, async client => {
      const paymentId = await stableResourceId(client, input);
      const stage = await writeStage(client, {
        step: "PAYMENT_RECORDED", sequence: 9, resourceType: "Payment", resourceId: paymentId,
        eventType: "risto.payment.recorded", context, scope: input,
        payload: { orderId: input.orderId, amount: input.amount, currency: input.currency }
      });
      return Object.freeze({ ...stage, paymentId: stage.resourceId });
    })
  });

  readonly review = Object.freeze({
    record: async (
      context: SecurityContext,
      input: Scope & Readonly<{ serviceSessionId: string; orderId: string; paymentId: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, async client => {
      const managerReviewId = await stableResourceId(client, input);
      const stage = await writeStage(client, {
        step: "MANAGER_REVIEWED", sequence: 11, resourceType: "ManagerReview", resourceId: managerReviewId,
        eventType: "risto.manager.reviewed", context, scope: input,
        payload: { serviceSessionId: input.serviceSessionId, orderId: input.orderId, paymentId: input.paymentId }
      });
      return Object.freeze({ ...stage, managerReviewId: stage.resourceId });
    })
  });

  readonly stella = Object.freeze({
    propose: async (
      context: SecurityContext,
      input: Scope & Readonly<{ serviceSessionId: string; orderId: string; managerReviewId: string }>
    ) => withScopedTransaction(this.pool, this.assumeRole, context, async client => {
      const proposalId = await stableResourceId(client, input);
      const stage = await writeStage(client, {
        step: "STELLA_PROPOSAL_CREATED", sequence: 12, resourceType: "DecisionProposal", resourceId: proposalId,
        eventType: "risto.stella.proposal_created", context, scope: input,
        payload: {
          serviceSessionId: input.serviceSessionId,
          orderId: input.orderId,
          managerReviewId: input.managerReviewId,
          proposalStatus: "PENDING_APPROVAL"
        }
      });
      return Object.freeze({ ...stage, proposalId: stage.resourceId, proposalStatus: "PENDING_APPROVAL" as const });
    })
  });
}

export function createPostgresGoldenDinnerServices(
  pool: Pool,
  assumeRole = "airen_app"
): GoldenDinnerServices {
  return new PostgresGoldenDinnerServices(pool, assumeRole);
}
