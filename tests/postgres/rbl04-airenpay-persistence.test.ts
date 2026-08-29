import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { BookingHoldApplicationService } from "../../packages/ristoairen/src/booking/index.ts";
import { createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingHoldUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-hold-repository.ts";
import { PostgresAirenPayPersistence } from "../../packages/persistence-postgres/src/risto-airenpay-repository.ts";
import { T20, cleanupT20BookingData, seedT20BookingTopology, securityContext } from "../helpers/t20-booking-fixtures.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const holdService = new BookingHoldApplicationService(
  new PostgresRistoBookingHoldUnitOfWork(pool),
  { assertRistoAirenAccess: () => undefined }
);
const airenPay = new PostgresAirenPayPersistence(pool);

const CONNECTION_A = "50000000-0000-4000-8000-000000000401";
const CONNECTION_A2 = "50000000-0000-4000-8000-000000000402";
const CONNECTION_B = "50000000-0000-4000-8000-000000000403";

const manager = (tenantId = T20.tenantA, locationId = T20.locationA1, actorIdentityId = T20.managerA) =>
  securityContext({
    actorIdentityId,
    tenantId,
    locationId,
    role: "manager",
    permissions: ["booking.read","booking.create","booking.update","booking.status.update"],
    correlationId: `rbl04-persist-${crypto.randomUUID()}`
  });

async function applyMigration(path: string): Promise<void> {
  const url = new URL(path, import.meta.url);
  await pool.query(await readFile(url, "utf8"));
}

async function applyHoldMigration(): Promise<void> {
  await applyMigration("../../packages/persistence-postgres/src/migrations/20260829_001_risto_booking_holds.sql");
}

async function applyAirenPayMigration(): Promise<void> {
  await applyMigration("../../packages/persistence-postgres/src/migrations/20260829_002_risto_airenpay.sql");
}

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM risto_airenpay_webhook_events WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_airenpay_orchestrations WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_payment_gateway_connections WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_booking_holds WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_booking_guarantee_policies WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_booking_capacity_slots WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await cleanupT20BookingData(pool);
}

async function seedHoldResource(): Promise<void> {
  await pool.query(
    `INSERT INTO risto_booking_capacity_slots
      (tenant_id,location_id,resource_key,starts_at,ends_at,capacity_total,status,created_by_identity_id,updated_by_identity_id)
     VALUES ($1,$2,'AIRENPAY_DINNER','2026-09-01T17:00:00Z','2026-09-01T21:00:00Z',10,'active',$3,$3)
     ON CONFLICT (tenant_id,location_id,resource_key,starts_at,ends_at)
     DO UPDATE SET capacity_total=10,status='active',updated_at=now()`,
    [T20.tenantA,T20.locationA1,T20.managerA]
  );
  await pool.query(
    `INSERT INTO risto_booking_guarantee_policies
      (tenant_id,location_id,source_channel,resource_key,min_party_size,max_party_size,effective_from,effective_until,
       guarantee_mode,hold_duration_seconds,amount_minor,currency,priority,status,created_by_identity_id,updated_by_identity_id)
     VALUES ($1,$2,'DIRECT_WEB','AIRENPAY_DINNER',1,100,'2026-08-01','2026-12-31','DEPOSIT',600,2000,'EUR',900,'active',$3,$3)`,
    [T20.tenantA,T20.locationA1,T20.managerA]
  );
}

async function seedConnections(): Promise<void> {
  const capabilities = ["PAYMENT_METHOD_SETUP","DEPOSIT_PAYMENT","FULL_PREPAYMENT","AUTHORIZATION_HOLD","TRANSACTION_STATUS","WEBHOOK_VERIFICATION"];
  await pool.query(
    `INSERT INTO risto_payment_gateway_connections
      (id,tenant_id,location_id,provider_type,provider_account_reference,capabilities,mode,
       credential_secret_provider,credential_secret_key,webhook_secret_provider,webhook_secret_key,
       status,created_by_identity_id,updated_by_identity_id,environment_class)
     VALUES
      ($1,$2,NULL,'STRIPE','acct_test_tenant',$4::text[],'TEST','env','AIRENPAY_TEST_CREDENTIAL','env','AIRENPAY_TEST_WEBHOOK','ACTIVE',$3,$3,'TEST_TEMPORARY'),
      ($5,$2,$6,'STRIPE','acct_test_location_a2',$4::text[],'TEST','env','AIRENPAY_TEST_CREDENTIAL_A2','env','AIRENPAY_TEST_WEBHOOK_A2','ACTIVE',$3,$3,'TEST_TEMPORARY'),
      ($7,$8,$9,'STRIPE','acct_test_tenant_b',$4::text[],'TEST','env','AIRENPAY_TEST_CREDENTIAL_B','env','AIRENPAY_TEST_WEBHOOK_B','ACTIVE',$10,$10,'TEST_TEMPORARY')
     ON CONFLICT (id) DO NOTHING`,
    [CONNECTION_A,T20.tenantA,T20.managerA,capabilities,CONNECTION_A2,T20.locationA2,CONNECTION_B,T20.tenantB,T20.locationB1,T20.managerB]
  );
}

const holdInput = Object.freeze({
  sourceChannel: "DIRECT_WEB",
  resourceKey: "AIRENPAY_DINNER",
  partySize: 2,
  bookingDate: "2026-09-01",
  bookingTimeLocal: "20:00",
  expectedDurationMinutes: 120,
  customerNameSnapshot: "AIRenPay Synthetic Guest"
});

let holdId = "";
let orchestrationId = "";
let connectionA: Awaited<ReturnType<typeof airenPay.listGatewayConnections>>[number];

async function createFreshDepositHold(key: string) {
  return holdService.create(manager(), holdInput, key);
}

test.before(async () => {
  await seedT20BookingTopology(pool);
  await applyHoldMigration();
  await applyAirenPayMigration();
  await cleanup();
  await seedT20BookingTopology(pool);
  await seedHoldResource();
  await seedConnections();
});

test.after(async () => {
  await cleanup();
  await pool.end();
});

test("RBL04-P01 AIRenPay migration is idempotently re-applicable", async () => {
  await assert.doesNotReject(() => applyAirenPayMigration());
});

test("RBL04-P02 RLS exposes tenant fallback and hides other-location/tenant connections", async () => {
  const visible = await airenPay.listGatewayConnections(manager());
  assert.deepEqual(visible.map((entry) => entry.id), [CONNECTION_A]);
  connectionA = visible[0];
  assert.equal(connectionA.mode, "TEST");
  assert.deepEqual(connectionA.credentialSecretRef, { provider: "env", key: "AIRENPAY_TEST_CREDENTIAL", version: undefined });
});

test("RBL04-P03 persistence schema contains SecretRef columns but no plaintext/card/raw-webhook custody", async () => {
  const columns = await pool.query<{ table_name:string; column_name:string }>(
    `SELECT table_name,column_name FROM information_schema.columns
      WHERE table_name IN ('risto_payment_gateway_connections','risto_airenpay_orchestrations','risto_airenpay_webhook_events')
      ORDER BY table_name,column_name`
  );
  const names = columns.rows.map((row) => `${row.table_name}.${row.column_name}`);
  assert.ok(names.includes("risto_payment_gateway_connections.credential_secret_key"));
  assert.ok(names.includes("risto_payment_gateway_connections.webhook_secret_key"));
  for (const forbidden of ["api_key","secret","password","pan","cvv","cvc","card_number","raw_body","signature"]) {
    assert.equal(names.some((name) => name.endsWith(`.${forbidden}`)), false);
  }
});

test("RBL04-P04 create orchestration binds a real DEPOSIT Hold to a TEST gateway", async () => {
  const hold = await createFreshDepositHold("rbl04-hold-primary");
  assert.equal(hold.hold.status, "GUARANTEE_REQUIRED");
  holdId = hold.hold.id;
  const created = await airenPay.createOrchestration(
    manager(),
    { bookingHoldId: holdId, guaranteeMode: "DEPOSIT", financialTerms: { amountMinor: 2000, currency: "EUR" } },
    connectionA,
    "rbl04-pay-create-1"
  );
  assert.equal(created.replayed, false);
  assert.equal(created.orchestration.orchestrationStatus, "CREATED");
  assert.equal(created.orchestration.bookingHoldId, holdId);
  assert.equal(created.orchestration.providerConnectionId, CONNECTION_A);
  assert.deepEqual(created.orchestration.amount, { amountMinor: 2000, currency: "EUR" });
  orchestrationId = created.orchestration.id;
  const persisted = await pool.query(
    `SELECT tenant_id::text,location_id::text,environment_class,provider_transaction_reference
       FROM risto_airenpay_orchestrations WHERE id=$1`,
    [orchestrationId]
  );
  assert.deepEqual(persisted.rows[0], {
    tenant_id: T20.tenantA,
    location_id: T20.locationA1,
    environment_class: "TEST_TEMPORARY",
    provider_transaction_reference: null
  });
});

test("RBL04-P05 same idempotency key and semantic payload replays exactly one orchestration", async () => {
  const replay = await airenPay.createOrchestration(
    manager(),
    { bookingHoldId: holdId, guaranteeMode: "DEPOSIT", financialTerms: { amountMinor: 2000, currency: "EUR" } },
    connectionA,
    "rbl04-pay-create-1"
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.orchestration.id, orchestrationId);
  const count = await pool.query(`SELECT count(*)::int AS c FROM risto_airenpay_orchestrations WHERE booking_hold_id=$1`, [holdId]);
  assert.equal(count.rows[0].c, 1);
});

test("RBL04-P06 reused idempotency key with changed terms fails closed", async () => {
  await assert.rejects(
    () => airenPay.createOrchestration(
      manager(),
      { bookingHoldId: holdId, guaranteeMode: "DEPOSIT", financialTerms: { amountMinor: 2500, currency: "EUR" } },
      connectionA,
      "rbl04-pay-create-1"
    ),
    (error: any) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("RBL04-P07 creation emits one minimized audit and outbox event", async () => {
  const audit = await pool.query(
    `SELECT metadata FROM audit.audit_events WHERE resource_id=$1 AND action_key='AIRENPAY_ORCHESTRATION_CREATED'`,
    [orchestrationId]
  );
  const outbox = await pool.query(
    `SELECT payload FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='airenpay.orchestration.created.v1'`,
    [orchestrationId]
  );
  assert.equal(audit.rows.length, 1);
  assert.deepEqual(Object.keys(audit.rows[0].metadata).sort(), ["connection_mode","guarantee_mode","provider_type","result"].sort());
  assert.equal(outbox.rows.length, 1);
  assert.deepEqual(Object.keys(outbox.rows[0].payload).sort(), ["booking_hold_id","guarantee_mode","orchestration_id","orchestration_status","provider_type"].sort());
});

test("RBL04-P08 cross-tenant orchestration read is RLS-invisible", async () => {
  const invisible = await airenPay.findVisibleOrchestrationById(manager(T20.tenantB,T20.locationB1,T20.managerB), orchestrationId);
  assert.equal(invisible, null);
});

test("RBL04-P09 another idempotency key cannot create a second orchestration for the same Hold", async () => {
  await assert.rejects(
    () => airenPay.createOrchestration(
      manager(),
      { bookingHoldId: holdId, guaranteeMode: "DEPOSIT", financialTerms: { amountMinor: 2000, currency: "EUR" } },
      connectionA,
      "rbl04-pay-create-second-key"
    ),
    (error: any) => error instanceof AppError && error.code === "CONFLICT" && error.message === "AIRENPAY_ORCHESTRATION_ALREADY_EXISTS"
  );
});

test("RBL04-P10 webhook normalization refuses unknown provider references", async () => {
  await assert.rejects(
    () => airenPay.recordNormalizedWebhookEvent(manager(), CONNECTION_A, {
      providerEventId: "evt_test_unknown",
      providerReference: "pi_test_unknown",
      eventType: "PAYMENT_SUCCEEDED",
      status: "GUARANTEE_SATISFIED",
      occurredAt: "2026-08-29T09:00:00.000Z"
    }),
    (error: any) => error instanceof AppError && error.code === "NOT_FOUND"
  );
});

test("RBL04-P11 normalized webhook is deduplicated and emits evidence exactly once", async () => {
  await pool.query(
    `UPDATE risto_airenpay_orchestrations
        SET provider_transaction_reference='pi_test_primary',orchestration_status='PROVIDER_PENDING',updated_at=now(),row_version=row_version+1
      WHERE id=$1`,
    [orchestrationId]
  );
  const event = {
    providerEventId: "evt_test_primary",
    providerReference: "pi_test_primary",
    eventType: "PAYMENT_SUCCEEDED" as const,
    status: "GUARANTEE_SATISFIED" as const,
    occurredAt: "2026-08-29T09:01:00.000Z",
    amount: { amountMinor: 2000, currency: "EUR" },
    providerMetadata: { livemode: false }
  };
  const first = await airenPay.recordNormalizedWebhookEvent(manager(), CONNECTION_A, event);
  assert.equal(first.replayed, false);
  assert.equal(first.orchestrationId, orchestrationId);
  const replay = await airenPay.recordNormalizedWebhookEvent(manager(), CONNECTION_A, event);
  assert.equal(replay.replayed, true);
  assert.equal(replay.webhookEventId, first.webhookEventId);
  const rows = await pool.query(`SELECT count(*)::int AS c FROM risto_airenpay_webhook_events WHERE provider_event_id='evt_test_primary'`);
  const audit = await pool.query(`SELECT count(*)::int AS c FROM audit.audit_events WHERE resource_id=$1 AND action_key='AIRENPAY_WEBHOOK_RECORDED'`, [orchestrationId]);
  const outbox = await pool.query(`SELECT count(*)::int AS c FROM events.outbox_events WHERE aggregate_id=$1 AND event_type='airenpay.webhook.recorded.v1'`, [orchestrationId]);
  assert.equal(rows.rows[0].c, 1);
  assert.equal(audit.rows[0].c, 1);
  assert.equal(outbox.rows[0].c, 1);
});

test("RBL04-P12 reused provider event id with changed normalized payload fails closed", async () => {
  await assert.rejects(
    () => airenPay.recordNormalizedWebhookEvent(manager(), CONNECTION_A, {
      providerEventId: "evt_test_primary",
      providerReference: "pi_test_primary",
      eventType: "FAILED",
      status: "FAILED",
      occurredAt: "2026-08-29T09:01:00.000Z"
    }),
    (error: any) => error instanceof AppError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("RBL04-P13 cross-tenant webhook cannot resolve another tenant connection", async () => {
  await assert.rejects(
    () => airenPay.recordNormalizedWebhookEvent(manager(T20.tenantB,T20.locationB1,T20.managerB), CONNECTION_A, {
      providerEventId: "evt_cross_tenant",
      providerReference: "pi_test_primary",
      eventType: "PAYMENT_SUCCEEDED",
      status: "GUARANTEE_SATISFIED",
      occurredAt: "2026-08-29T09:02:00.000Z"
    }),
    (error: any) => error instanceof AppError && error.code === "NOT_FOUND"
  );
});

test("RBL04-P14 persisted webhook evidence is normalized-only and contains no guest/card/secret material", async () => {
  const row = await pool.query(
    `SELECT provider_metadata FROM risto_airenpay_webhook_events WHERE provider_event_id='evt_test_primary'`,
  );
  assert.deepEqual(row.rows[0].provider_metadata, { livemode: false });
  const serialized = JSON.stringify(row.rows[0]).toLowerCase();
  for (const forbidden of ["customer_name","phone","email","card_number","cvv","cvc","secret","password"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
