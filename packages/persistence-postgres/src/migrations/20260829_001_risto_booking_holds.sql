BEGIN;

CREATE TABLE IF NOT EXISTS risto_booking_capacity_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL REFERENCES platform.locations(id),
  resource_key text NOT NULL CHECK (length(btrim(resource_key)) > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity_total integer NOT NULL CHECK (capacity_total > 0 AND capacity_total <= 10000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by_identity_id uuid NOT NULL,
  updated_by_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  environment_class text NOT NULL DEFAULT 'TEST_TEMPORARY' CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  CHECK (ends_at > starts_at),
  UNIQUE (tenant_id, location_id, resource_key, starts_at, ends_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS risto_booking_capacity_slots_scope_identity_uq
  ON risto_booking_capacity_slots (id, tenant_id, location_id);
CREATE INDEX IF NOT EXISTS risto_booking_capacity_slots_lookup_idx
  ON risto_booking_capacity_slots (tenant_id, location_id, resource_key, starts_at, ends_at)
  WHERE status='active';

CREATE TABLE IF NOT EXISTS risto_booking_guarantee_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL REFERENCES platform.locations(id),
  source_channel text NULL,
  resource_key text NULL,
  min_party_size integer NULL CHECK (min_party_size IS NULL OR min_party_size > 0),
  max_party_size integer NULL CHECK (max_party_size IS NULL OR max_party_size > 0),
  effective_from date NULL,
  effective_until date NULL,
  guarantee_mode text NOT NULL CHECK (guarantee_mode IN ('NONE','PAYMENT_METHOD_GUARANTEE','DEPOSIT','FULL_PREPAYMENT','AUTHORIZATION_HOLD')),
  hold_duration_seconds integer NOT NULL CHECK (hold_duration_seconds BETWEEN 30 AND 3600),
  amount_minor bigint NULL CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency text NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by_identity_id uuid NOT NULL,
  updated_by_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  environment_class text NOT NULL DEFAULT 'TEST_TEMPORARY' CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  CHECK (min_party_size IS NULL OR max_party_size IS NULL OR max_party_size >= min_party_size),
  CHECK (effective_from IS NULL OR effective_until IS NULL OR effective_until >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS risto_booking_guarantee_policies_scope_identity_uq
  ON risto_booking_guarantee_policies (id, tenant_id, location_id);
CREATE INDEX IF NOT EXISTS risto_booking_guarantee_policies_resolution_idx
  ON risto_booking_guarantee_policies (tenant_id, location_id, priority DESC, id)
  WHERE status='active';

ALTER TABLE risto_bookings ADD COLUMN IF NOT EXISTS capacity_slot_id uuid NULL;
CREATE UNIQUE INDEX IF NOT EXISTS risto_bookings_scope_identity_uq
  ON risto_bookings (id, tenant_id, location_id);
CREATE INDEX IF NOT EXISTS risto_bookings_capacity_slot_active_idx
  ON risto_bookings (tenant_id, location_id, capacity_slot_id, status)
  WHERE capacity_slot_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='risto_bookings_capacity_slot_scope_fk') THEN
    ALTER TABLE risto_bookings
      ADD CONSTRAINT risto_bookings_capacity_slot_scope_fk
      FOREIGN KEY (capacity_slot_id, tenant_id, location_id)
      REFERENCES risto_booking_capacity_slots(id, tenant_id, location_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS risto_booking_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL REFERENCES platform.locations(id),
  capacity_slot_id uuid NOT NULL,
  guarantee_policy_id uuid NOT NULL,
  source_channel text NOT NULL CHECK (length(btrim(source_channel)) > 0),
  source_external_reference text NULL,
  resource_key text NOT NULL CHECK (length(btrim(resource_key)) > 0),
  party_size integer NOT NULL CHECK (party_size > 0 AND party_size <= 1000),
  capacity_claim integer NOT NULL CHECK (capacity_claim > 0 AND capacity_claim <= 1000 AND capacity_claim >= party_size),
  booking_date date NOT NULL,
  booking_time_local time NOT NULL,
  starts_at timestamptz NOT NULL,
  expected_duration_minutes integer NOT NULL CHECK (expected_duration_minutes BETWEEN 15 AND 1440),
  status text NOT NULL CHECK (status IN ('CREATED','GUARANTEE_REQUIRED','GUARANTEE_PENDING','GUARANTEED','CONVERTED','EXPIRED','CANCELLED','FAILED')),
  expires_at timestamptz NOT NULL,
  guarantee_mode text NOT NULL CHECK (guarantee_mode IN ('NONE','PAYMENT_METHOD_GUARANTEE','DEPOSIT','FULL_PREPAYMENT','AUTHORIZATION_HOLD')),
  guarantee_ref text NULL,
  conversion_booking_id uuid NULL,
  customer_name_snapshot text NOT NULL CHECK (length(btrim(customer_name_snapshot)) > 0),
  phone_snapshot text NULL,
  email_snapshot text NULL,
  notes text NULL,
  special_requests text NULL,
  cancellation_reason text NULL,
  failure_reason text NULL,
  cancelled_at timestamptz NULL,
  expired_at timestamptz NULL,
  converted_at timestamptz NULL,
  created_by_identity_id uuid NOT NULL,
  updated_by_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  environment_class text NOT NULL DEFAULT 'TEST_TEMPORARY' CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  UNIQUE (conversion_booking_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='risto_booking_holds_capacity_slot_scope_fk') THEN
    ALTER TABLE risto_booking_holds
      ADD CONSTRAINT risto_booking_holds_capacity_slot_scope_fk
      FOREIGN KEY (capacity_slot_id, tenant_id, location_id)
      REFERENCES risto_booking_capacity_slots(id, tenant_id, location_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='risto_booking_holds_guarantee_policy_scope_fk') THEN
    ALTER TABLE risto_booking_holds
      ADD CONSTRAINT risto_booking_holds_guarantee_policy_scope_fk
      FOREIGN KEY (guarantee_policy_id, tenant_id, location_id)
      REFERENCES risto_booking_guarantee_policies(id, tenant_id, location_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='risto_booking_holds_conversion_booking_scope_fk') THEN
    ALTER TABLE risto_booking_holds
      ADD CONSTRAINT risto_booking_holds_conversion_booking_scope_fk
      FOREIGN KEY (conversion_booking_id, tenant_id, location_id)
      REFERENCES risto_bookings(id, tenant_id, location_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS risto_booking_holds_scope_status_idx
  ON risto_booking_holds (tenant_id, location_id, status, expires_at);
CREATE INDEX IF NOT EXISTS risto_booking_holds_capacity_active_idx
  ON risto_booking_holds (tenant_id, location_id, capacity_slot_id, expires_at, status);

ALTER TABLE foundation_idempotency_keys
  DROP CONSTRAINT IF EXISTS foundation_idempotency_keys_canonical_function_id_check;
ALTER TABLE foundation_idempotency_keys
  ADD CONSTRAINT foundation_idempotency_keys_canonical_function_id_check
  CHECK (canonical_function_id IN (
    'RST-F-BKG-001','RST-F-BKG-002','RST-F-BKG-003',
    'RST-F-BKG-HOLD-001','RST-F-BKG-HOLD-002','RST-F-BKG-HOLD-003'
  ));

ALTER TABLE risto_booking_capacity_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE risto_booking_capacity_slots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS risto_booking_capacity_slots_scope_policy ON risto_booking_capacity_slots;
CREATE POLICY risto_booking_capacity_slots_scope_policy ON risto_booking_capacity_slots
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

ALTER TABLE risto_booking_guarantee_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE risto_booking_guarantee_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS risto_booking_guarantee_policies_scope_policy ON risto_booking_guarantee_policies;
CREATE POLICY risto_booking_guarantee_policies_scope_policy ON risto_booking_guarantee_policies
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

ALTER TABLE risto_booking_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE risto_booking_holds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS risto_booking_holds_scope_policy ON risto_booking_holds;
CREATE POLICY risto_booking_holds_scope_policy ON risto_booking_holds
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
  );

GRANT SELECT, UPDATE (row_version) ON risto_booking_capacity_slots TO airen_app;
GRANT SELECT ON risto_booking_guarantee_policies TO airen_app;
GRANT SELECT, INSERT, UPDATE ON risto_booking_holds TO airen_app;

COMMIT;
