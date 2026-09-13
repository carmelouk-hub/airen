import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { reconstructCrossDomainTrace } from "../../packages/ristoairen/src/journeys/cross-domain-trace-runtime.ts";
import { PostgresCrossDomainTraceStore } from "../../packages/persistence-postgres/src/risto-cross-domain-trace-runtime.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
const store = new PostgresCrossDomainTraceStore(pool);

const TENANT_A = "35353535-1111-4111-8111-111111111111";
const LOCATION_A = "35353535-2222-4222-8222-222222222221";
const TENANT_B = "35353535-3333-4333-8333-333333333333";
const LOCATION_B = "35353535-4444-4444-8444-444444444444";
const AUDITOR = "35353535-5555-4555-8555-555555555551";
const OPERATOR = "35353535-5555-4555-8555-555555555552";
const TENANT_MEMBERSHIP = "35353535-6666-4666-8666-666666666661";
const LOCATION_MEMBERSHIP = "35353535-7777-4777-8777-777777777771";
const JOURNEY = "35353535-8888-4888-8888-888888888881";
const RUNTIME_RESOURCE = "35353535-9999-4999-8999-999999999991";
const CORRELATION = "mat035-lumen27-cross-domain-trace";
const FOREIGN_CORRELATION = "mat035-foreign-trace";

function context(overrides: Partial<SecurityContext> = {}): SecurityContext {
  return Object.freeze({
    correlationId: CORRELATION,
    actorIdentityId: AUDITOR,
    platformRoles: ["platform_auditor"],
    platformPermissions: ["platform.audit.read"],
    tenantId: TENANT_A,
    locationId: LOCATION_A,
    tenantMembershipId: TENANT_MEMBERSHIP,
    locationMembershipId: LOCATION_MEMBERSHIP,
    tenantRole: "auditor",
    locationRole: "auditor",
    permissions: [],
    entitlements: ["vertical.ristoairen"],
    ...overrides,
  });
}

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name,status,timezone,currency) VALUES
      ('${TENANT_A}','mat035-a','LUMEN 27 MAT035','active','Europe/Rome','EUR'),
      ('${TENANT_B}','mat035-b','MAT035 Foreign','active','Europe/Rome','EUR')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO platform.locations (id,tenant_id,slug,name,status,timezone,is_primary) VALUES
      ('${LOCATION_A}','${TENANT_A}','main','LUMEN 27 Main','active','Europe/Rome',false),
      ('${LOCATION_B}','${TENANT_B}','main','MAT035 Foreign','active','Europe/Rome',false)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO identity.identities (id,display_name,status) VALUES
      ('${AUDITOR}','MAT035 Auditor','active'),
      ('${OPERATOR}','MAT035 Operator','active')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO ristoairen.golden_dinner_runtime_events (
      id,journey_id,tenant_id,location_id,correlation_id,idempotency_key,step,sequence,
      resource_type,resource_id,event_type,actor_identity_id,environment_class,payload,occurred_at
    ) VALUES (
      '35353535-aaaa-4aaa-8aaa-aaaaaaaaaaa1','${JOURNEY}','${TENANT_A}','${LOCATION_A}',
      '${CORRELATION}','mat035-runtime-1','ORDER_SUBMITTED',5,'Order','${RUNTIME_RESOURCE}',
      'risto.order.submitted','${OPERATOR}','TEST_TEMPORARY',
      '{"state":"SUBMITTED","authorization":"must-not-leak","safe":"runtime-visible"}'::jsonb,
      '2026-09-13T13:00:00Z'
    ) ON CONFLICT DO NOTHING;

    INSERT INTO audit.audit_events (
      id,tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,
      correlation_id,outcome,metadata,created_at
    ) VALUES
      ('35353535-bbbb-4bbb-8bbb-bbbbbbbbbbb1','${TENANT_A}','${LOCATION_A}','${OPERATOR}',
       'user','order.submit','Order','${RUNTIME_RESOURCE}','${CORRELATION}','success',
       '{"state_transition":"DRAFT_TO_SUBMITTED","emitted_fact":"risto.order.submitted","token":"must-not-leak","safe":"audit-visible"}'::jsonb,
       '2026-09-13T13:00:01Z'),
      ('35353535-bbbb-4bbb-8bbb-bbbbbbbbbbb2','${TENANT_A}','${LOCATION_A}','${OPERATOR}',
       'user','refund.approve','Payment','PAY-TRACE-1','${CORRELATION}','denied',
       '{"state_transition":"DENIED_NO_CHANGE","safe":"denied-visible"}'::jsonb,
       '2026-09-13T13:00:02Z'),
      ('35353535-bbbb-4bbb-8bbb-bbbbbbbbbbb3','${TENANT_B}','${LOCATION_B}','${OPERATOR}',
       'user','foreign.command','Order','FOREIGN-1','${FOREIGN_CORRELATION}','success',
       '{"safe":"foreign"}'::jsonb,'2026-09-13T13:00:03Z')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO events.outbox_events (
      id,tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,
      correlation_id,delivery_status,attempt_count,last_error,created_at,delivered_at
    ) VALUES
      ('35353535-cccc-4ccc-8ccc-ccccccccccc1','${TENANT_A}','${LOCATION_A}',
       'risto.order.submitted','Order','${RUNTIME_RESOURCE}',1,
       '{"source_id":"${RUNTIME_RESOURCE}","client_secret":"must-not-leak","safe":"outbox-visible"}'::jsonb,
       '${CORRELATION}','delivered',2,NULL,'2026-09-13T13:00:04Z','2026-09-13T13:00:05Z'),
      ('35353535-cccc-4ccc-8ccc-ccccccccccc2','${TENANT_B}','${LOCATION_B}',
       'foreign.fact','Order','FOREIGN-1',1,'{"safe":"foreign"}'::jsonb,
       '${FOREIGN_CORRELATION}','pending',0,NULL,'2026-09-13T13:00:06Z',NULL)
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function counts(): Promise<Readonly<{ runtime: number; audit: number; outbox: number }>> {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM ristoairen.golden_dinner_runtime_events WHERE correlation_id=$1) AS runtime,
      (SELECT count(*)::int FROM audit.audit_events WHERE correlation_id=$1) AS audit,
      (SELECT count(*)::int FROM events.outbox_events WHERE correlation_id=$1) AS outbox
  `, [CORRELATION]);
  return Object.freeze({
    runtime: Number(result.rows[0].runtime),
    audit: Number(result.rows[0].audit),
    outbox: Number(result.rows[0].outbox),
  });
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

test("MAT-035 / GJ2-040 cross-domain audit, outbox and trace completeness", async t => {
  await seed();
  t.after(async () => { await pool.end(); });

  await t.test("reconstructs one LUMEN 27 trace across runtime, audit and outbox evidence", async () => {
    const before = await counts();
    const snapshot = await reconstructCrossDomainTrace({ correlationId: CORRELATION }, { context: context(), store });
    const after = await counts();

    assert.deepEqual(after, before, "trace reconstruction must be read-only");
    assert.equal(snapshot.tenantId, TENANT_A);
    assert.equal(snapshot.locationId, LOCATION_A);
    assert.equal(snapshot.correlationId, CORRELATION);
    assert.equal(snapshot.environmentClass, "TEST_TEMPORARY");
    assert.deepEqual(snapshot.evidenceKinds, ["audit", "outbox", "runtime"]);
    assert.equal(snapshot.evidence.length, 4);
    assert.equal(snapshot.successfulCommands, 1);
    assert.equal(snapshot.deniedCommands, 1);
    assert.ok(snapshot.emittedFacts >= 2);
    assert.ok(snapshot.evidence.every(item => item.tenantId === TENANT_A));
    assert.ok(snapshot.evidence.every(item => item.locationId === LOCATION_A));
    assert.ok(snapshot.evidence.every(item => item.correlationId === CORRELATION));
    assert.ok(snapshot.evidence.every(item => item.sourceId.length > 0));

    const success = snapshot.evidence.find(item => item.evidenceKind === "audit" && item.decision === "success");
    assert.equal(success?.actorIdentityId, OPERATOR);
    assert.equal(success?.commandKey, "order.submit");
    assert.equal(success?.stateTransition, "DRAFT_TO_SUBMITTED");
    assert.equal(success?.emittedFact, "risto.order.submitted");

    const denied = snapshot.evidence.find(item => item.evidenceKind === "audit" && item.decision === "denied");
    assert.equal(denied?.commandKey, "refund.approve");
    assert.equal(denied?.stateTransition, "DENIED_NO_CHANGE");

    const delivered = snapshot.evidence.find(item => item.evidenceKind === "outbox");
    assert.equal(delivered?.decision, "emitted_and_delivered");
    assert.equal(delivered?.stateTransition, "delivered");
    assert.equal(delivered?.metadataSanitized.attempt_count, 2);
  });

  await t.test("redacts forbidden top-level secret material from every returned evidence class", async () => {
    const snapshot = await reconstructCrossDomainTrace({ correlationId: CORRELATION }, { context: context(), store });
    const text = serialized(snapshot.evidence.map(item => item.metadataSanitized));
    for (const forbidden of ["authorization", "token", "client_secret", "must-not-leak"]) {
      assert.equal(text.includes(forbidden), false, `forbidden metadata leaked: ${forbidden}`);
    }
    assert.ok(text.includes("runtime-visible"));
    assert.ok(text.includes("audit-visible"));
    assert.ok(text.includes("outbox-visible"));
  });

  await t.test("keeps denied attempts observable while preserving tenant and location isolation", async () => {
    const own = await reconstructCrossDomainTrace({ correlationId: CORRELATION }, { context: context(), store });
    assert.ok(own.evidence.some(item => item.evidenceKind === "audit" && item.decision === "denied"));

    const foreign = await reconstructCrossDomainTrace(
      { correlationId: CORRELATION },
      {
        context: context({
          tenantId: TENANT_B,
          locationId: LOCATION_B,
          correlationId: CORRELATION,
          tenantMembershipId: "35353535-6666-4666-8666-666666666662",
          locationMembershipId: "35353535-7777-4777-8777-777777777772",
        }),
        store,
      },
    );
    assert.equal(foreign.evidence.length, 0);
  });

  await t.test("fails closed without audit permission, entitlement or valid correlation", async () => {
    await assert.rejects(
      reconstructCrossDomainTrace({ correlationId: CORRELATION }, { context: context({ platformPermissions: [] }), store }),
      (error: unknown) => error instanceof AppError && error.code === "PERMISSION_DENIED",
    );
    await assert.rejects(
      reconstructCrossDomainTrace({ correlationId: CORRELATION }, { context: context({ entitlements: [] }), store }),
      (error: unknown) => error instanceof AppError && error.code === "ENTITLEMENT_REQUIRED",
    );
    await assert.rejects(
      reconstructCrossDomainTrace({ correlationId: "   " }, { context: context(), store }),
      (error: unknown) => error instanceof AppError && error.code === "VALIDATION_FAILED",
    );
  });

  await t.test("database function requires scoped tenant/location context and exposes no direct mutation path", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL ROLE airen_app");
      await client.query("SELECT set_config('airen.identity_id',$1,true)", [AUDITOR]);
      await assert.rejects(
        client.query("SELECT * FROM ristoairen.query_cross_domain_trace($1)", [CORRELATION]),
        /CROSS_DOMAIN_TRACE_TENANT_CONTEXT_REQUIRED|tenant/i,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
