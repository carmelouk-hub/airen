-- RISTO-MAT-014 — RISTOAIREN PostgreSQL payment persistence boundary
-- Provider-independent storage for RST-F-POS-001 payment.record.
-- Base44 and external payment providers are not authorities for this persistence layer.
BEGIN;

CREATE SCHEMA IF NOT EXISTS ristoairen;

CREATE TABLE ristoairen.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  service_session_id text,
  customer_profile_id text,
  channel text NOT NULL CHECK (length(btrim(channel)) BETWEEN 1 AND 64),
  status text NOT NULL CHECK (length(btrim(status)) BETWEEN 1 AND 64),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(20,4) NOT NULL CHECK (subtotal >= 0),
  discount_total numeric(20,4) NOT NULL CHECK (discount_total >= 0),
  tax_total numeric(20,4) NOT NULL CHECK (tax_total >= 0),
  total numeric(20,4) NOT NULL CHECK (total >= 0),
  opened_at timestamptz NOT NULL,
  sent_at timestamptz,
  closed_at timestamptz,
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  closed_by_identity_id uuid REFERENCES identity.identities(id),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  environment_class text NOT NULL DEFAULT 'PRODUCTION'
    CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_orders_location_scope
    FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT uq_risto_orders_scope_id UNIQUE (tenant_id, location_id, id)
);
CREATE INDEX idx_risto_orders_scope_status ON ristoairen.orders(tenant_id, location_id, status);

CREATE TABLE ristoairen.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  order_id uuid NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('CASH','CARD','MIXED','OTHER')),
  amount numeric(20,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL CHECK (length(btrim(status)) BETWEEN 1 AND 64),
  provider_reference text CHECK (provider_reference IS NULL OR length(provider_reference) <= 240),
  received_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL REFERENCES identity.identities(id),
  refund_of_payment_id uuid,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 240),
  metadata_sanitized jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata_sanitized) = 'object'),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL DEFAULT 'PRODUCTION'
    CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_payments_location_scope
    FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT fk_risto_payments_order_scope
    FOREIGN KEY (tenant_id, location_id, order_id)
    REFERENCES ristoairen.orders(tenant_id, location_id, id),
  CONSTRAINT uq_risto_payments_scope_id UNIQUE (tenant_id, location_id, id),
  CONSTRAINT fk_risto_payments_refund_scope
    FOREIGN KEY (tenant_id, location_id, refund_of_payment_id)
    REFERENCES ristoairen.payments(tenant_id, location_id, id),
  CONSTRAINT uq_risto_payments_idempotency UNIQUE (tenant_id, location_id, idempotency_key)
);
CREATE INDEX idx_risto_payments_order_effective
  ON ristoairen.payments(tenant_id, location_id, order_id, status, received_at);

ALTER TABLE ristoairen.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.payments FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_orders_scope_policy ON ristoairen.orders
  FOR ALL TO airen_app
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

CREATE POLICY risto_payments_scope_policy ON ristoairen.payments
  FOR ALL TO airen_app
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

GRANT USAGE ON SCHEMA ristoairen TO airen_app;
-- payment.record reads canonical Order and effective Payment ledger, and may insert Payment only.
GRANT SELECT ON ristoairen.orders TO airen_app;
GRANT SELECT, INSERT ON ristoairen.payments TO airen_app;

COMMIT;
