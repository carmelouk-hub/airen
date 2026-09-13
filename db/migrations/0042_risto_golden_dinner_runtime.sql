-- RISTO-MAT-034 / GJ2-039 — Golden Dinner executable spine PostgreSQL runtime
-- Synthetic TEST_TEMPORARY evidence only. This ledger is tenant/location scoped,
-- append-only, correlation-bound and idempotent. AI_STELLA remains proposal-only.
BEGIN;

CREATE TABLE ristoairen.golden_dinner_runtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  step text NOT NULL CHECK (step IN (
    'PARTY_RECORDED',
    'DEMAND_ACCEPTED',
    'PARTY_SEATED',
    'SERVICE_SESSION_OPENED',
    'ORDER_SUBMITTED',
    'KITCHEN_READY',
    'BAR_READY',
    'ORDER_SERVED',
    'PAYMENT_RECORDED',
    'SERVICE_SESSION_CLOSED',
    'MANAGER_REVIEWED',
    'STELLA_PROPOSAL_CREATED'
  )),
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 12),
  resource_type text NOT NULL CHECK (length(btrim(resource_type)) BETWEEN 1 AND 120),
  resource_id uuid NOT NULL,
  event_type text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 160),
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  environment_class text NOT NULL CHECK (environment_class = 'TEST_TEMPORARY'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_golden_dinner_runtime_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_golden_dinner_runtime_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_golden_dinner_runtime_idempotency UNIQUE (tenant_id,location_id,idempotency_key),
  CONSTRAINT uq_risto_golden_dinner_runtime_journey_sequence UNIQUE (tenant_id,location_id,journey_id,sequence),
  CONSTRAINT ck_risto_golden_dinner_runtime_step_sequence CHECK (
    (step,sequence) IN (
      ('PARTY_RECORDED',1),
      ('DEMAND_ACCEPTED',2),
      ('PARTY_SEATED',3),
      ('SERVICE_SESSION_OPENED',4),
      ('ORDER_SUBMITTED',5),
      ('KITCHEN_READY',6),
      ('BAR_READY',7),
      ('ORDER_SERVED',8),
      ('PAYMENT_RECORDED',9),
      ('SERVICE_SESSION_CLOSED',10),
      ('MANAGER_REVIEWED',11),
      ('STELLA_PROPOSAL_CREATED',12)
    )
  )
);

CREATE INDEX idx_risto_golden_dinner_runtime_timeline
  ON ristoairen.golden_dinner_runtime_events(tenant_id,location_id,journey_id,sequence,occurred_at,id);
CREATE INDEX idx_risto_golden_dinner_runtime_correlation
  ON ristoairen.golden_dinner_runtime_events(tenant_id,location_id,correlation_id,occurred_at,id);

-- The persistence adapter intentionally uses ON CONFLICT ... DO UPDATE so that a
-- repeated idempotency key can RETURNING the already-persisted row. Only an exact
-- no-op update is permitted; any real mutation of ledger evidence is rejected.
CREATE OR REPLACE FUNCTION ristoairen.guard_golden_dinner_runtime_noop_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'GOLDEN_DINNER_RUNTIME_EVENT_IMMUTABLE';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER trg_risto_golden_dinner_runtime_noop_update
BEFORE UPDATE ON ristoairen.golden_dinner_runtime_events
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_golden_dinner_runtime_noop_update();

CREATE OR REPLACE FUNCTION ristoairen.guard_golden_dinner_runtime_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'GOLDEN_DINNER_RUNTIME_EVENT_DELETE_FORBIDDEN';
END $$;

CREATE TRIGGER trg_risto_golden_dinner_runtime_delete
BEFORE DELETE ON ristoairen.golden_dinner_runtime_events
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_golden_dinner_runtime_delete();

ALTER TABLE ristoairen.golden_dinner_runtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.golden_dinner_runtime_events FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_golden_dinner_runtime_scope_select
ON ristoairen.golden_dinner_runtime_events
FOR SELECT TO airen_app
USING (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
);

CREATE POLICY risto_golden_dinner_runtime_scope_insert
ON ristoairen.golden_dinner_runtime_events
FOR INSERT TO airen_app
WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
  AND actor_identity_id = security.current_identity_id()
  AND correlation_id = NULLIF(current_setting('airen.correlation_id',true),'')
  AND environment_class = 'TEST_TEMPORARY'
);

CREATE POLICY risto_golden_dinner_runtime_scope_noop_update
ON ristoairen.golden_dinner_runtime_events
FOR UPDATE TO airen_app
USING (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
)
WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
  AND actor_identity_id = security.current_identity_id()
  AND correlation_id = NULLIF(current_setting('airen.correlation_id',true),'')
  AND environment_class = 'TEST_TEMPORARY'
);

REVOKE ALL ON ristoairen.golden_dinner_runtime_events FROM airen_app;
GRANT SELECT,INSERT ON ristoairen.golden_dinner_runtime_events TO airen_app;
GRANT UPDATE(idempotency_key) ON ristoairen.golden_dinner_runtime_events TO airen_app;

COMMIT;
