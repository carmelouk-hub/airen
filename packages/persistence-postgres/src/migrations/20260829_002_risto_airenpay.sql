BEGIN;

CREATE TABLE IF NOT EXISTS risto_payment_gateway_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NULL,
  provider_type text NOT NULL CHECK (provider_type ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
  provider_account_reference text NOT NULL CHECK (length(btrim(provider_account_reference)) > 0),
  capabilities text[] NOT NULL CHECK (
    cardinality(capabilities) > 0
    AND array_position(capabilities,NULL) IS NULL
    AND capabilities <@ ARRAY[
      'PAYMENT_METHOD_SETUP','DEPOSIT_PAYMENT','FULL_PREPAYMENT','AUTHORIZATION_HOLD',
      'CAPTURE_AUTHORIZATION','RELEASE_AUTHORIZATION','REFUND_PAYMENT','TRANSACTION_STATUS','WEBHOOK_VERIFICATION'
    ]::text[]
  ),
  mode text NOT NULL CHECK (mode IN ('TEST','LIVE')),
  credential_secret_provider text NOT NULL CHECK (length(btrim(credential_secret_provider)) > 0),
  credential_secret_key text NOT NULL CHECK (length(btrim(credential_secret_key)) > 0),
  credential_secret_version text NULL CHECK (credential_secret_version IS NULL OR length(btrim(credential_secret_version)) > 0),
  webhook_secret_provider text NULL,
  webhook_secret_key text NULL,
  webhook_secret_version text NULL,
  webhook_configuration_reference text NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','REVOKED')),
  created_by_identity_id uuid NOT NULL,
  updated_by_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  environment_class text NOT NULL DEFAULT 'TEST_TEMPORARY' CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  CONSTRAINT risto_payment_gateway_connections_location_scope_fk
    FOREIGN KEY (tenant_id,location_id) REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT risto_payment_gateway_connections_webhook_secret_pair_ck CHECK (
    (webhook_secret_provider IS NULL AND webhook_secret_key IS NULL AND webhook_secret_version IS NULL)
    OR
    (webhook_secret_provider IS NOT NULL AND length(btrim(webhook_secret_provider)) > 0
      AND webhook_secret_key IS NOT NULL AND length(btrim(webhook_secret_key)) > 0
      AND (webhook_secret_version IS NULL OR length(btrim(webhook_secret_version)) > 0))
  ),
  CONSTRAINT risto_payment_gateway_connections_webhook_material_ck CHECK (
    NOT ('WEBHOOK_VERIFICATION'=ANY(capabilities))
    OR webhook_secret_key IS NOT NULL
    OR (webhook_configuration_reference IS NOT NULL AND length(btrim(webhook_configuration_reference)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS risto_payment_gateway_connections_scope_identity_uq
  ON risto_payment_gateway_connections (id,tenant_id);
CREATE INDEX IF NOT EXISTS risto_payment_gateway_connections_resolution_idx
  ON risto_payment_gateway_connections (tenant_id,location_id,mode,status,provider_type,id);
CREATE UNIQUE INDEX IF NOT EXISTS risto_payment_gateway_connections_tenant_account_uq
  ON risto_payment_gateway_connections (tenant_id,provider_type,mode,provider_account_reference)
  WHERE location_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS risto_payment_gateway_connections_location_account_uq
  ON risto_payment_gateway_connections (tenant_id,location_id,provider_type,mode,provider_account_reference)
  WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS risto_booking_holds_scope_identity_uq
  ON risto_booking_holds (id,tenant_id,location_id);

CREATE TABLE IF NOT EXISTS risto_airenpay_orchestrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  booking_hold_id uuid NOT NULL,
  booking_id uuid NULL,
  guarantee_mode text NOT NULL CHECK (guarantee_mode IN ('PAYMENT_METHOD_GUARANTEE','DEPOSIT','FULL_PREPAYMENT','AUTHORIZATION_HOLD')),
  provider_type text NOT NULL CHECK (provider_type ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
  provider_connection_id uuid NOT NULL,
  provider_customer_reference text NULL CHECK (provider_customer_reference IS NULL OR length(btrim(provider_customer_reference)) > 0),
  provider_payment_method_reference text NULL CHECK (provider_payment_method_reference IS NULL OR length(btrim(provider_payment_method_reference)) > 0),
  provider_transaction_reference text NULL CHECK (provider_transaction_reference IS NULL OR length(btrim(provider_transaction_reference)) > 0),
  amount_minor bigint NULL CHECK (amount_minor IS NULL OR amount_minor > 0),
  currency text NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  orchestration_status text NOT NULL DEFAULT 'CREATED' CHECK (orchestration_status IN (
    'CREATED','PROVIDER_PENDING','CUSTOMER_ACTION_REQUIRED','GUARANTEE_SATISFIED',
    'CAPTURED','RELEASED','REFUNDED','FAILED','CANCELLED','EXPIRED'
  )),
  authorization_expires_at timestamptz NULL,
  guaranteed_at timestamptz NULL,
  paid_at timestamptz NULL,
  authorized_at timestamptz NULL,
  captured_at timestamptz NULL,
  refunded_at timestamptz NULL,
  released_at timestamptz NULL,
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) > 0),
  created_by_identity_id uuid NOT NULL,
  updated_by_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  environment_class text NOT NULL DEFAULT 'TEST_TEMPORARY' CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  CONSTRAINT risto_airenpay_orchestrations_location_scope_fk
    FOREIGN KEY (tenant_id,location_id) REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT risto_airenpay_orchestrations_hold_scope_fk
    FOREIGN KEY (booking_hold_id,tenant_id,location_id) REFERENCES risto_booking_holds(id,tenant_id,location_id),
  CONSTRAINT risto_airenpay_orchestrations_booking_scope_fk
    FOREIGN KEY (booking_id,tenant_id,location_id) REFERENCES risto_bookings(id,tenant_id,location_id),
  CONSTRAINT risto_airenpay_orchestrations_connection_scope_fk
    FOREIGN KEY (provider_connection_id,tenant_id) REFERENCES risto_payment_gateway_connections(id,tenant_id),
  CONSTRAINT risto_airenpay_orchestrations_financial_terms_ck CHECK (
    (guarantee_mode='PAYMENT_METHOD_GUARANTEE' AND amount_minor IS NULL AND currency IS NULL)
    OR
    (guarantee_mode IN ('DEPOSIT','FULL_PREPAYMENT','AUTHORIZATION_HOLD') AND amount_minor IS NOT NULL AND amount_minor > 0 AND currency IS NOT NULL)
  ),
  UNIQUE (booking_hold_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS risto_airenpay_orchestrations_scope_identity_uq
  ON risto_airenpay_orchestrations (id,tenant_id,location_id);
CREATE INDEX IF NOT EXISTS risto_airenpay_orchestrations_scope_status_idx
  ON risto_airenpay_orchestrations (tenant_id,location_id,orchestration_status,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS risto_airenpay_orchestrations_provider_reference_uq
  ON risto_airenpay_orchestrations (provider_connection_id,provider_transaction_reference)
  WHERE provider_transaction_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS risto_airenpay_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  provider_connection_id uuid NOT NULL,
  orchestration_id uuid NOT NULL,
  provider_event_id text NOT NULL CHECK (length(btrim(provider_event_id)) > 0),
  provider_reference text NOT NULL CHECK (length(btrim(provider_reference)) > 0),
  event_type text NOT NULL CHECK (event_type IN (
    'SETUP_SUCCEEDED','PAYMENT_SUCCEEDED','AUTHORIZATION_SUCCEEDED','CAPTURE_SUCCEEDED','RELEASE_SUCCEEDED',
    'REFUND_SUCCEEDED','ACTION_REQUIRED','FAILED','CANCELLED','EXPIRED'
  )),
  orchestration_status text NOT NULL CHECK (orchestration_status IN (
    'CREATED','PROVIDER_PENDING','CUSTOMER_ACTION_REQUIRED','GUARANTEE_SATISFIED',
    'CAPTURED','RELEASED','REFUNDED','FAILED','CANCELLED','EXPIRED'
  )),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  amount_minor bigint NULL CHECK (amount_minor IS NULL OR amount_minor > 0),
  currency text NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  authorization_expires_at timestamptz NULL,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  semantic_hash char(64) NOT NULL CHECK (semantic_hash ~ '^[0-9a-f]{64}$'),
  processed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  environment_class text NOT NULL DEFAULT 'TEST_TEMPORARY' CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  CONSTRAINT risto_airenpay_webhook_events_location_scope_fk
    FOREIGN KEY (tenant_id,location_id) REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT risto_airenpay_webhook_events_connection_scope_fk
    FOREIGN KEY (provider_connection_id,tenant_id) REFERENCES risto_payment_gateway_connections(id,tenant_id),
  CONSTRAINT risto_airenpay_webhook_events_orchestration_scope_fk
    FOREIGN KEY (orchestration_id,tenant_id,location_id) REFERENCES risto_airenpay_orchestrations(id,tenant_id,location_id),
  CONSTRAINT risto_airenpay_webhook_events_amount_pair_ck CHECK (
    (amount_minor IS NULL AND currency IS NULL) OR (amount_minor IS NOT NULL AND currency IS NOT NULL)
  ),
  UNIQUE (provider_connection_id,provider_event_id)
);

CREATE INDEX IF NOT EXISTS risto_airenpay_webhook_events_orchestration_idx
  ON risto_airenpay_webhook_events (tenant_id,location_id,orchestration_id,occurred_at,id);

ALTER TABLE foundation_idempotency_keys
  DROP CONSTRAINT IF EXISTS foundation_idempotency_keys_canonical_function_id_check;
ALTER TABLE foundation_idempotency_keys
  ADD CONSTRAINT foundation_idempotency_keys_canonical_function_id_check
  CHECK (canonical_function_id IN (
    'RST-F-BKG-001','RST-F-BKG-002','RST-F-BKG-003',
    'RST-F-BKG-HOLD-001','RST-F-BKG-HOLD-002','RST-F-BKG-HOLD-003',
    'RST-F-PAY-001'
  ));

ALTER TABLE risto_payment_gateway_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE risto_payment_gateway_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS risto_payment_gateway_connections_scope_policy ON risto_payment_gateway_connections;
CREATE POLICY risto_payment_gateway_connections_scope_policy ON risto_payment_gateway_connections
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND (location_id IS NULL OR location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND (location_id IS NULL OR location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid)
  );

ALTER TABLE risto_airenpay_orchestrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE risto_airenpay_orchestrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS risto_airenpay_orchestrations_scope_policy ON risto_airenpay_orchestrations;
CREATE POLICY risto_airenpay_orchestrations_scope_policy ON risto_airenpay_orchestrations
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

ALTER TABLE risto_airenpay_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE risto_airenpay_webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS risto_airenpay_webhook_events_scope_policy ON risto_airenpay_webhook_events;
CREATE POLICY risto_airenpay_webhook_events_scope_policy ON risto_airenpay_webhook_events
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

GRANT SELECT ON risto_payment_gateway_connections TO airen_app;
GRANT SELECT,INSERT,UPDATE ON risto_airenpay_orchestrations TO airen_app;
GRANT SELECT,INSERT,UPDATE ON risto_airenpay_webhook_events TO airen_app;

COMMIT;
