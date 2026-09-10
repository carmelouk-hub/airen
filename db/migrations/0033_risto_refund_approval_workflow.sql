-- RISTO-MAT-022 — RST-E077 RefundRequest persistence and approval workflow
-- Workflow evidence only. RST-E021 Payment remains the canonical monetary ledger.
BEGIN;

CREATE TABLE ristoairen.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  order_id uuid NOT NULL,
  requested_amount numeric(20,2) NOT NULL CHECK (requested_amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  requested_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  requested_at timestamptz NOT NULL,
  request_idempotency_key text NOT NULL CHECK (length(btrim(request_idempotency_key)) BETWEEN 1 AND 240),
  original_payment_row_version integer NOT NULL CHECK (original_payment_row_version >= 1),
  status text NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED')),
  approved_by_identity_id uuid REFERENCES identity.identities(id),
  approved_at timestamptz,
  rejected_by_identity_id uuid REFERENCES identity.identities(id),
  rejected_at timestamptz,
  rejection_reason text CHECK (rejection_reason IS NULL OR length(btrim(rejection_reason)) BETWEEN 1 AND 1000),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL DEFAULT 'PRODUCTION'
    CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_refund_requests_location_scope
    FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT fk_risto_refund_requests_payment_scope
    FOREIGN KEY (tenant_id, location_id, payment_id)
    REFERENCES ristoairen.payments(tenant_id, location_id, id),
  CONSTRAINT fk_risto_refund_requests_order_scope
    FOREIGN KEY (tenant_id, location_id, order_id)
    REFERENCES ristoairen.orders(tenant_id, location_id, id),
  CONSTRAINT uq_risto_refund_requests_scope_id UNIQUE (tenant_id, location_id, id),
  CONSTRAINT uq_risto_refund_requests_idempotency UNIQUE (tenant_id, location_id, request_idempotency_key),
  CONSTRAINT ck_risto_refund_requests_decision_shape CHECK (
    (status = 'PENDING_APPROVAL'
      AND approved_by_identity_id IS NULL AND approved_at IS NULL
      AND rejected_by_identity_id IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL)
    OR
    (status = 'APPROVED'
      AND approved_by_identity_id IS NOT NULL AND approved_at IS NOT NULL
      AND approved_by_identity_id <> requested_by_identity_id
      AND rejected_by_identity_id IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL)
    OR
    (status = 'REJECTED'
      AND rejected_by_identity_id IS NOT NULL AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL
      AND approved_by_identity_id IS NULL AND approved_at IS NULL)
  )
);

CREATE INDEX idx_risto_refund_requests_scope_status
  ON ristoairen.refund_requests(tenant_id, location_id, status, requested_at);
CREATE INDEX idx_risto_refund_requests_payment
  ON ristoairen.refund_requests(tenant_id, location_id, payment_id, status);

ALTER TABLE ristoairen.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.refund_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_refund_requests_scope_policy ON ristoairen.refund_requests
  FOR ALL TO airen_app
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

-- MAT-022 may create/transition workflow evidence only. Payment grants remain unchanged.
GRANT SELECT, INSERT, UPDATE ON ristoairen.refund_requests TO airen_app;

COMMIT;
