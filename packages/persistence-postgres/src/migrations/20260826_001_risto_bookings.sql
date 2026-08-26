BEGIN;

CREATE TABLE IF NOT EXISTS risto_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL REFERENCES platform.locations(id),
  customer_profile_id uuid NULL,
  event_id uuid NULL,
  zone_id uuid NULL,
  table_id uuid NULL,
  source text NOT NULL CHECK (length(btrim(source)) > 0),
  external_reference text NULL,
  party_size integer NOT NULL CHECK (party_size > 0 AND party_size <= 1000),
  booking_date date NOT NULL,
  booking_time_local time NOT NULL,
  starts_at timestamptz NOT NULL,
  expected_duration_minutes integer NOT NULL CHECK (expected_duration_minutes BETWEEN 15 AND 1440),
  status text NOT NULL CHECK (status IN ('REQUESTED','PENDING','CONFIRMED','ARRIVED','SEATED','COMPLETED','CANCELLED','NO_SHOW')),
  customer_name_snapshot text NOT NULL CHECK (length(btrim(customer_name_snapshot)) > 0),
  phone_snapshot text NULL,
  email_snapshot text NULL,
  notes text NULL,
  special_requests text NULL,
  arrival_at timestamptz NULL,
  seated_at timestamptz NULL,
  completed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  cancellation_reason text NULL,
  no_show_at timestamptz NULL,
  promoter_attribution_id uuid NULL,
  created_by_identity_id uuid NOT NULL,
  updated_by_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  environment_class text NOT NULL DEFAULT 'TEST_TEMPORARY' CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY'))
);

CREATE INDEX IF NOT EXISTS risto_bookings_scope_status_idx ON risto_bookings (tenant_id, location_id, status);
CREATE INDEX IF NOT EXISTS risto_bookings_scope_starts_idx ON risto_bookings (tenant_id, location_id, starts_at, id);
CREATE INDEX IF NOT EXISTS risto_bookings_scope_civil_idx ON risto_bookings (tenant_id, location_id, booking_date, booking_time_local, id);
CREATE INDEX IF NOT EXISTS risto_bookings_external_reference_idx ON risto_bookings (tenant_id, location_id, external_reference) WHERE external_reference IS NOT NULL;

ALTER TABLE risto_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE risto_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS risto_bookings_scope_policy ON risto_bookings;
CREATE POLICY risto_bookings_scope_policy ON risto_bookings
  USING (
    tenant_id = current_setting('airen.tenant_id', true)::uuid
    AND location_id = current_setting('airen.location_id', true)::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('airen.tenant_id', true)::uuid
    AND location_id = current_setting('airen.location_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS foundation_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_identity_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL REFERENCES platform.locations(id),
  canonical_function_id text NOT NULL CHECK (canonical_function_id IN ('RST-F-BKG-001','RST-F-BKG-002','RST-F-BKG-003')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('IN_PROGRESS','COMPLETED')),
  lease_until timestamptz NOT NULL,
  result_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (actor_identity_id, tenant_id, location_id, canonical_function_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS foundation_idempotency_expiry_idx ON foundation_idempotency_keys (expires_at);
ALTER TABLE foundation_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE foundation_idempotency_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS foundation_idempotency_scope_policy ON foundation_idempotency_keys;
CREATE POLICY foundation_idempotency_scope_policy ON foundation_idempotency_keys
  USING (
    actor_identity_id = current_setting('airen.identity_id', true)::uuid
    AND tenant_id = current_setting('airen.tenant_id', true)::uuid
    AND location_id = current_setting('airen.location_id', true)::uuid
  )
  WITH CHECK (
    actor_identity_id = current_setting('airen.identity_id', true)::uuid
    AND tenant_id = current_setting('airen.tenant_id', true)::uuid
    AND location_id = current_setting('airen.location_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE ON risto_bookings TO airen_app;
GRANT SELECT, INSERT, UPDATE ON foundation_idempotency_keys TO airen_app;

COMMIT;
