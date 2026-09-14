import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { AppError, type SecretRef, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { assertAirenPayRuntimeAccess } from "../../packages/airenpay/src/runtime-boundary.ts";
import { requestRefund, approveRefund } from "../../packages/ristoairen/src/pos/refund-request.ts";
import { executeApprovedRefund } from "../../packages/ristoairen/src/pos/refund-effect.ts";
import {
  reconcileTrustedProviderRefund,
  startProviderRefundSaga
} from "../../packages/ristoairen/src/pos/provider-refund-saga.ts";
import { PostgresRefundRequestUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-request.ts";
import { PostgresRefundEffectUnitOfWork } from "../../packages/persistence-postgres/src/risto-refund-effect.ts";
import { PostgresProviderRefundSagaUnitOfWork } from "../../packages/persistence-postgres/src/risto-provider-refund-saga.ts";
import { PostgresOutboxDeliveryStore } from "../../packages/persistence-postgres/src/risto-outbox-delivery.ts";
import { dispatchNextOutboxMessage } from "../../packages/integrations/src/outbox-delivery.ts";
import { EnvironmentSecretProvider } from "../../packages/integrations/src/index.ts";
import { RistoStripeTestRefundAdapter } from "../../packages/integrations/src/risto-stripe-test-refund-adapter.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

const SECRET_ENV_KEY = "STRIPE_AIRENPAY_TEST_SECRET_KEY";
const SECRET_REF: SecretRef = Object.freeze({ provider: "env", key: SECRET_ENV_KEY });
const STRIPE_API = "https://api.stripe.com/v1";
const ORIGINAL_AMOUNT_MINOR = 500;
const REFUND_AMOUNT = "1.00";
const REFUND_AMOUNT_MINOR = 100;
const CURRENCY = "EUR";

const TENANT = "36363636-1111-4111-8111-111111111111";
const LOCATION = "36363636-2222-4222-8222-222222222222";
const REQUESTER = "36363636-3333-4333-8333-333333333333";
const APPROVER = "36363636-4444-4444-8444-444444444444";
const EXECUTOR = "36363636-5555-4555-8555-555555555555";
const ORDER = "36363636-6666-4666-8666-666666666666";
const PAYMENT = "36363636-7777-4777-8777-777777777777";

const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });
const secretProvider = new EnvironmentSecretProvider(process.env, [SECRET_ENV_KEY]);

function context(actorIdentityId: string, correlationId: string, permissions: readonly string[]): SecurityContext {
  return Object.freeze({
    correlationId,
    actorIdentityId,
    platformRoles: [],
    platformPermissions: [],
    tenantId: TENANT,
    locationId: LOCATION,
    tenantMembershipId: `aos036-tm-${TENANT}`,
    locationMembershipId: `aos036-lm-${LOCATION}`,
    tenantRole: "responsabile",
    locationRole: "responsabile",
    permissions,
    entitlements: ["vertical.ristoairen", "airen.pay"]
  });
}

const requesterContext = (id: string) => context(REQUESTER, id, ["pos.refund.request"]);
const approverContext = (id: string) => context(APPROVER, id, ["pos.refund.approve"]);
const executorContext = (id: string) => context(EXECUTOR, id, ["pos.refund.execute"]);

async function withStripeTestCredential<T>(consumer: (credential: string) => Promise<T>): Promise<T> {
  const material = await secretProvider.resolve(SECRET_REF);
  return await material.use(async (credential) => {
    if (!(credential.startsWith("sk_test_") || credential.startsWith("rk_test_"))) {
      throw new AppError("PERMISSION_DENIED", "AOS-036 rejected non-TEST Stripe credential material");
    }
    return consumer(credential);
  });
}

async function stripeRequest(path: string, method: "GET" | "POST", body?: URLSearchParams): Promise<unknown> {
  return withStripeTestCredential(async (credential) => {
    const response = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credential}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
      },
      ...(body ? { body: body.toString() } : {})
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); }
      catch { throw new AppError("INTERNAL_ERROR", "Stripe TEST returned non-JSON response", { httpStatus: response.status }); }
    }
    if (!response.ok) {
      const providerError = parsed && typeof parsed === "object" && "error" in parsed
        ? (parsed as { error?: { type?: unknown; code?: unknown } }).error
        : undefined;
      console.error(JSON.stringify({
        event: "airenpay.stripe.test.request_failed",
        mode: "TEST",
        method,
        path,
        httpStatus: response.status,
        providerErrorType: typeof providerError?.type === "string" ? providerError.type : null,
        providerErrorCode: typeof providerError?.code === "string" ? providerError.code : null,
        secretMaterialLogged: false
      }));
      throw new AppError("INTERNAL_ERROR", "Stripe TEST request failed", {
        provider: "stripe",
        mode: "TEST",
        httpStatus: response.status,
        ...(typeof providerError?.type === "string" ? { providerErrorType: providerError.type } : {}),
        ...(typeof providerError?.code === "string" ? { providerErrorCode: providerError.code } : {})
      });
    }
    return parsed;
  });
}

async function createSucceededTestPaymentIntent(): Promise<string> {
  const body = new URLSearchParams();
  body.set("amount", String(ORIGINAL_AMOUNT_MINOR));
  body.set("currency", CURRENCY.toLowerCase());
  body.set("payment_method", "pm_card_visa");
  body.append("payment_method_types[]", "card");
  body.set("confirm", "true");
  body.set("description", "AIRenOS AOS-036 durable saga E2E TEST only");
  body.set("metadata[airenos_gate]", "AOS-AIRENPAY-RUNTIME-036-20260913-FILIPPO");

  const raw = await stripeRequest("/payment_intents", "POST", body);
  assert.ok(raw && typeof raw === "object");
  const paymentIntent = raw as Record<string, unknown>;
  assert.equal(paymentIntent.livemode, false);
  assert.equal(paymentIntent.status, "succeeded");
  assert.equal(paymentIntent.amount, ORIGINAL_AMOUNT_MINOR);
  assert.equal(String(paymentIntent.currency).toUpperCase(), CURRENCY);
  assert.equal(typeof paymentIntent.id, "string");
  assert.match(paymentIntent.id as string, /^pi_/);
  return paymentIntent.id as string;
}

async function readBackRefund(paymentIntentId: string): Promise<Readonly<{ id: string; status: string }>> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const raw = await stripeRequest(`/refunds?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=10`, "GET");
    assert.ok(raw && typeof raw === "object");
    const list = raw as { data?: unknown };
    if (Array.isArray(list.data)) {
      const match = list.data.find((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const refund = entry as Record<string, unknown>;
        return refund.payment_intent === paymentIntentId
          && refund.amount === REFUND_AMOUNT_MINOR
          && typeof refund.currency === "string"
          && refund.currency.toUpperCase() === CURRENCY;
      });
      if (match && typeof match === "object") {
        const refund = match as Record<string, unknown>;
        assert.equal(typeof refund.id, "string");
        assert.match(refund.id as string, /^re_/);
        assert.equal(typeof refund.status, "string");
        assert.ok(["pending", "requires_action", "succeeded"].includes(refund.status as string));
        if (refund.livemode !== undefined) assert.equal(refund.livemode, false);
        return Object.freeze({ id: refund.id as string, status: refund.status as string });
      }
    }
    await delay(1000);
  }
  throw new AppError("NOT_FOUND", "Stripe TEST refund read-back did not observe the fresh saga settlement");
}

async function seed(paymentIntentId: string): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT}','aos036','AOS036');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone)
    VALUES ('${LOCATION}','${TENANT}','main','AOS036 Main','Europe/Rome');
    INSERT INTO identity.identities (id,display_name)
    VALUES ('${REQUESTER}','AOS036 Requester'),('${APPROVER}','AOS036 Approver'),('${EXECUTOR}','AOS036 Executor');
    INSERT INTO ristoairen.orders
      (id,tenant_id,location_id,channel,status,currency,subtotal,discount_total,tax_total,total,opened_at,created_by_identity_id,version,environment_class)
    VALUES ('${ORDER}','${TENANT}','${LOCATION}','POS','PAID','EUR',5,0,0,5,now(),'${REQUESTER}',1,'TEST_TEMPORARY');
    INSERT INTO ristoairen.payments
      (id,tenant_id,location_id,order_id,payment_method,amount,currency,status,provider_reference,received_at,recorded_by,idempotency_key,metadata_sanitized,row_version,environment_class)
    VALUES ('${PAYMENT}','${TENANT}','${LOCATION}','${ORDER}','CARD',5,'EUR','RECORDED',$1,now(),'${REQUESTER}','aos036-original','{}',4,'TEST_TEMPORARY');
  `, [paymentIntentId]);
}

test("AOS-036 durable refund saga settles through Stripe TEST sandbox and reconciles", async (t) => {
  t.after(async () => { await pool.end(); });

  const runtime = assertAirenPayRuntimeAccess(executorContext("aos036-airenpay-boundary"), {
    enabled: true,
    providerMode: "TEST"
  });
  assert.equal(runtime.ready, true);
  assert.equal(runtime.providerMode, "TEST");

  const paymentIntentId = await createSucceededTestPaymentIntent();
  await seed(paymentIntentId);

  const requested = await requestRefund(
    requesterContext("aos036-request"),
    { paymentId: PAYMENT, amount: REFUND_AMOUNT, reason: "AOS036 Stripe TEST durable saga", expectedPaymentRowVersion: 4, idempotencyKey: "aos036-request" },
    { unitOfWork: new PostgresRefundRequestUnitOfWork(pool), now: () => "2026-09-13T20:10:00.000Z" }
  );
  const approved = await approveRefund(
    approverContext("aos036-approve"),
    { refundRequestId: requested.refundRequest.id, expectedRefundRequestRowVersion: 1 },
    { unitOfWork: new PostgresRefundRequestUnitOfWork(pool), now: () => "2026-09-13T20:11:00.000Z" }
  );
  const effect = await executeApprovedRefund(
    executorContext("aos036-effect"),
    { refundRequestId: approved.refundRequest.id, expectedRefundRequestRowVersion: approved.refundRequest.rowVersion },
    { unitOfWork: new PostgresRefundEffectUnitOfWork(pool), now: () => "2026-09-13T20:12:00.000Z" }
  );

  const sagaUow = new PostgresProviderRefundSagaUnitOfWork(pool);
  const started = await startProviderRefundSaga(
    executorContext("aos036-saga-start"),
    { refundRequestId: approved.refundRequest.id, refundPaymentId: effect.payment.id, providerKey: "stripe" },
    { unitOfWork: sagaUow }
  );
  assert.equal(started.replayed, false);
  assert.equal(started.saga.status, "PENDING_DISPATCH");
  assert.equal(started.saga.providerSourceReference, paymentIntentId);
  assert.equal(started.saga.idempotencyKey, `provider-refund:stripe:${effect.payment.id}`);

  const adapter = new RistoStripeTestRefundAdapter({
    secretProvider,
    credentialSecretRef: SECRET_REF,
    timeoutMs: 20_000
  });
  const dispatched = await dispatchNextOutboxMessage({
    store: new PostgresOutboxDeliveryStore(pool),
    adapter,
    now: () => "2026-09-13T20:13:00.000Z"
  });
  assert.equal(dispatched.status, "delivered");

  const outbox = await pool.query(
    "SELECT delivery_status,attempt_count,last_error FROM events.outbox_events WHERE aggregate_id=$1",
    [started.saga.id]
  );
  assert.deepEqual(outbox.rows[0], { delivery_status: "delivered", attempt_count: 1, last_error: null });

  const providerRefund = await readBackRefund(paymentIntentId);
  const reconciled = await reconcileTrustedProviderRefund(
    Object.freeze({
      securityContext: executorContext("aos036-provider-readback"),
      refundPaymentId: effect.payment.id,
      outcome: "SUCCEEDED" as const,
      providerRefundReference: providerRefund.id,
      resultCode: "SUCCEEDED"
    }),
    `stripe-readback:${providerRefund.id}`,
    { unitOfWork: sagaUow, now: () => "2026-09-13T20:14:00.000Z" }
  );
  assert.equal(reconciled.status, "SUCCEEDED");
  assert.equal(reconciled.providerRefundReference, providerRefund.id);

  const sagaRow = await pool.query(
    "SELECT status,provider_source_reference,provider_refund_reference,result_code,row_version FROM ristoairen.provider_refund_sagas WHERE id=$1",
    [started.saga.id]
  );
  assert.deepEqual(sagaRow.rows[0], {
    status: "SUCCEEDED",
    provider_source_reference: paymentIntentId,
    provider_refund_reference: providerRefund.id,
    result_code: "SUCCEEDED",
    row_version: 2
  });

  const audit = await pool.query(
    "SELECT count(*)::int AS count FROM audit.audit_events WHERE action_key='PROVIDER_REFUND_RECONCILED' AND resource_id=$1",
    [started.saga.id]
  );
  assert.equal(audit.rows[0].count, 1);

  console.log(JSON.stringify({
    event: "airenpay.stripe.test.durable_saga_settlement",
    result: "PASS",
    mode: "TEST",
    paymentIntentReference: paymentIntentId,
    refundReference: providerRefund.id,
    refundStatus: providerRefund.status,
    amountMinor: REFUND_AMOUNT_MINOR,
    currency: CURRENCY,
    sagaStatus: reconciled.status,
    providerCallsExecuted: true,
    liveMode: false,
    realMoneyMovement: false,
    secretMaterialLogged: false
  }));
});
