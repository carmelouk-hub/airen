-- RISTO-MAT-024 — Provider refund saga / orchestration & reconciliation
-- Provider-neutral business truth for external refund execution. MAT-023 Payment remains immutable local ledger evidence.
BEGIN;

CREATE TABLE ristoairen.provider_refund_sagas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  refund_request_id uuid NOT NULL,
  refund_payment_id uuid NOT NULL,
  original_payment_id uuid NOT NULL,
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  provider_source_reference text NOT NULL CHECK (length(btrim(provider_source_reference)) BETWEEN 1 AND 240),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 240),
  status text NOT NULL DEFAULT 'PENDING_DISPATCH'
    CHECK (status IN ('PENDING_DISPATCH','DISPATCHED','SUCCEEDED','FAILED')),
  provider_refund_reference text CHECK (provider_refund_reference IS NULL OR length(btrim(provider_refund_reference)) BETWEEN 1 AND 240),
  provider_event_id text CHECK (provider_event_id IS NULL OR length(btrim(provider_event_id)) BETWEEN 1 AND 240),
  result_code text CHECK (result_code IS NULL OR result_code ~ '^[A-Z0-9_][A-Z0-9_.-]{0,63}$'),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  CONSTRAINT fk_risto_provider_refund_saga_location_scope
    FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT fk_risto_provider_refund_saga_request_scope
    FOREIGN KEY (tenant_id, location_id, refund_request_id)
    REFERENCES ristoairen.refund_requests(tenant_id, location_id, id),
  CONSTRAINT fk_risto_provider_refund_saga_refund_payment_scope
    FOREIGN KEY (tenant_id, location_id, refund_payment_id)
    REFERENCES ristoairen.payments(tenant_id, location_id, id),
  CONSTRAINT fk_risto_provider_refund_saga_original_payment_scope
    FOREIGN KEY (tenant_id, location_id, original_payment_id)
    REFERENCES ristoairen.payments(tenant_id, location_id, id),
  CONSTRAINT uq_risto_provider_refund_saga_scope_id UNIQUE (tenant_id, location_id, id),
  CONSTRAINT uq_risto_provider_refund_saga_refund_payment UNIQUE (tenant_id, location_id, refund_payment_id),
  CONSTRAINT uq_risto_provider_refund_saga_idempotency UNIQUE (tenant_id, location_id, idempotency_key),
  CONSTRAINT ck_risto_provider_refund_saga_terminal_shape CHECK (
    (status IN ('PENDING_DISPATCH','DISPATCHED')
      AND provider_refund_reference IS NULL AND provider_event_id IS NULL
      AND result_code IS NULL AND reconciled_at IS NULL)
    OR
    (status = 'SUCCEEDED'
      AND provider_refund_reference IS NOT NULL AND provider_event_id IS NOT NULL
      AND result_code = 'SUCCEEDED' AND reconciled_at IS NOT NULL)
    OR
    (status = 'FAILED'
      AND provider_event_id IS NOT NULL AND result_code IS NOT NULL
      AND result_code <> 'SUCCEEDED' AND reconciled_at IS NOT NULL)
  )
);

CREATE INDEX idx_risto_provider_refund_saga_scope_status
  ON ristoairen.provider_refund_sagas(tenant_id, location_id, status, created_at);

ALTER TABLE ristoairen.provider_refund_sagas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.provider_refund_sagas FORCE ROW LEVEL SECURITY;
CREATE POLICY risto_provider_refund_saga_scope_policy ON ristoairen.provider_refund_sagas
  FOR ALL TO airen_app
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE ON ristoairen.provider_refund_sagas TO airen_app;

COMMIT;
