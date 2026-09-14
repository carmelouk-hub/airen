-- RISTO-MAT-039 / GJ2-034 — minimum canonical mutable state for optimistic-concurrency proof
-- Scope is intentionally limited to C001 Reservations/Queue, C009 Floor/Seating,
-- C010 ServiceSession and C011 Order amendments. Golden Dinner remains evidence-only
-- and is not promoted into mutable business truth.
BEGIN;

CREATE TABLE ristoairen.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(btrim(request_key)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','CONFIRMED','CHECKED_IN','SEATED','CANCELLED','NO_SHOW','COMPLETED'
  )),
  party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 1000),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_booking_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_booking_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_booking_request UNIQUE (tenant_id,location_id,request_key)
);

CREATE TABLE ristoairen.guest_queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(btrim(request_key)) BETWEEN 1 AND 200),
  booking_id uuid,
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN (
    'WAITING','CALLED','SEATED','EXPIRED','CANCELLED'
  )),
  party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 1000),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_guest_queue_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_guest_queue_booking FOREIGN KEY (tenant_id,location_id,booking_id)
    REFERENCES ristoairen.bookings(tenant_id,location_id,id),
  CONSTRAINT uq_risto_guest_queue_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_guest_queue_request UNIQUE (tenant_id,location_id,request_key)
);

CREATE TABLE ristoairen.dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 80),
  operational_status text NOT NULL DEFAULT 'ACTIVE' CHECK (operational_status IN ('ACTIVE','OUT_OF_SERVICE')),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_dining_table_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_dining_table_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_dining_table_code UNIQUE (tenant_id,location_id,code)
);

CREATE TABLE ristoairen.service_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  table_id uuid NOT NULL,
  booking_id uuid,
  queue_entry_id uuid,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_risto_service_session_source CHECK (NOT (booking_id IS NOT NULL AND queue_entry_id IS NOT NULL)),
  CONSTRAINT ck_risto_service_session_closed_at CHECK (
    (status='OPEN' AND closed_at IS NULL)
    OR (status IN ('CLOSED','CANCELLED') AND closed_at IS NOT NULL)
  ),
  CONSTRAINT fk_risto_service_session_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_service_session_table FOREIGN KEY (tenant_id,location_id,table_id)
    REFERENCES ristoairen.dining_tables(tenant_id,location_id,id),
  CONSTRAINT fk_risto_service_session_booking FOREIGN KEY (tenant_id,location_id,booking_id)
    REFERENCES ristoairen.bookings(tenant_id,location_id,id),
  CONSTRAINT fk_risto_service_session_queue FOREIGN KEY (tenant_id,location_id,queue_entry_id)
    REFERENCES ristoairen.guest_queue_entries(tenant_id,location_id,id),
  CONSTRAINT uq_risto_service_session_scope_id UNIQUE (tenant_id,location_id,id)
);

CREATE UNIQUE INDEX uq_risto_service_session_open_table
  ON ristoairen.service_sessions(tenant_id,location_id,table_id)
  WHERE status='OPEN';

CREATE TABLE ristoairen.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  service_session_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(btrim(request_key)) BETWEEN 1 AND 200),
  channel text NOT NULL CHECK (channel IN ('FOH','POS','QR','SELF','FAST')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','AMENDED','CANCELLED','COMPLETED')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_risto_order_submitted_at CHECK (
    (status='DRAFT' AND submitted_at IS NULL)
    OR (status IN ('SUBMITTED','AMENDED','CANCELLED','COMPLETED') AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT fk_risto_order_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_order_service_session FOREIGN KEY (tenant_id,location_id,service_session_id)
    REFERENCES ristoairen.service_sessions(tenant_id,location_id,id),
  CONSTRAINT uq_risto_order_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_order_request UNIQUE (tenant_id,location_id,request_key)
);

CREATE INDEX idx_risto_booking_location_status
  ON ristoairen.bookings(tenant_id,location_id,status,updated_at,id);
CREATE INDEX idx_risto_guest_queue_location_status
  ON ristoairen.guest_queue_entries(tenant_id,location_id,status,updated_at,id);
CREATE INDEX idx_risto_service_session_location_status
  ON ristoairen.service_sessions(tenant_id,location_id,status,updated_at,id);
CREATE INDEX idx_risto_order_location_status
  ON ristoairen.orders(tenant_id,location_id,status,updated_at,id);

ALTER TABLE ristoairen.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.guest_queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.guest_queue_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.dining_tables FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.service_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.service_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.orders FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_booking_location_scope
ON ristoairen.bookings FOR ALL TO airen_app
USING (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
)
WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
);

CREATE POLICY risto_guest_queue_location_scope
ON ristoairen.guest_queue_entries FOR ALL TO airen_app
USING (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
)
WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
);

CREATE POLICY risto_dining_table_location_scope
ON ristoairen.dining_tables FOR ALL TO airen_app
USING (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
)
WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
);

CREATE POLICY risto_service_session_location_scope
ON ristoairen.service_sessions FOR ALL TO airen_app
USING (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
)
WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
);

CREATE POLICY risto_order_location_scope
ON ristoairen.orders FOR ALL TO airen_app
USING (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
)
WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND location_id = security.current_location_id()
);

REVOKE ALL ON ristoairen.bookings FROM airen_app;
REVOKE ALL ON ristoairen.guest_queue_entries FROM airen_app;
REVOKE ALL ON ristoairen.dining_tables FROM airen_app;
REVOKE ALL ON ristoairen.service_sessions FROM airen_app;
REVOKE ALL ON ristoairen.orders FROM airen_app;

GRANT SELECT,INSERT,UPDATE ON ristoairen.bookings TO airen_app;
GRANT SELECT,INSERT,UPDATE ON ristoairen.guest_queue_entries TO airen_app;
GRANT SELECT,INSERT,UPDATE ON ristoairen.dining_tables TO airen_app;
GRANT SELECT,INSERT,UPDATE ON ristoairen.service_sessions TO airen_app;
GRANT SELECT,INSERT,UPDATE ON ristoairen.orders TO airen_app;

COMMIT;
