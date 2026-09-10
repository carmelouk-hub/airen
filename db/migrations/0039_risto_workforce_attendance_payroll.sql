-- RISTO-MAT-030 / GJ2-024 — Workforce attendance / payroll preparation runtime
-- Synthetic TEST_TEMPORARY operational workforce evidence only. No statutory payroll execution.
BEGIN;

INSERT INTO billing.entitlement_catalog (entitlement_key,description) VALUES
  ('workforce.enabled','RISTOAIREN Workforce product access'),
  ('workforce.attendance.enabled','RISTOAIREN attendance evidence and exception workflow'),
  ('workforce.payroll_preparation.enabled','RISTOAIREN non-statutory payroll preparation snapshots')
ON CONFLICT (entitlement_key) DO NOTHING;

INSERT INTO authz.permission_registry (permission_key,description,sensitivity) VALUES
  ('workforce.self.read','Read own workforce/shift/attendance projection','sensitive'),
  ('workforce.attendance.record_self','Append own attendance clock evidence','sensitive'),
  ('workforce.attendance.read','Read scoped workforce attendance','sensitive'),
  ('workforce.attendance_exception.request_self','Request own attendance correction','sensitive'),
  ('workforce.attendance_exception.approve','Approve or reject a scoped attendance correction','sensitive'),
  ('workforce.payroll.prepare','Prepare a non-monetary payroll input snapshot','high'),
  ('workforce.payroll.read_sensitive','Read non-monetary payroll preparation snapshots','high')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE ristoairen.workforce_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_risto_workforce_profile_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_workforce_profile_identity UNIQUE (tenant_id,identity_id)
);

CREATE TABLE ristoairen.work_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CANCELLED','COMPLETED')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_risto_work_shift_interval CHECK (ends_at > starts_at),
  CONSTRAINT fk_risto_work_shift_location FOREIGN KEY (tenant_id,location_id) REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_work_shift_scope_id UNIQUE (tenant_id,location_id,id)
);

CREATE TABLE ristoairen.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  work_shift_id uuid NOT NULL,
  workforce_profile_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','CANCELLED')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_shift_assignment_shift FOREIGN KEY (tenant_id,location_id,work_shift_id) REFERENCES ristoairen.work_shifts(tenant_id,location_id,id),
  CONSTRAINT fk_risto_shift_assignment_profile FOREIGN KEY (tenant_id,workforce_profile_id) REFERENCES ristoairen.workforce_profiles(tenant_id,id),
  CONSTRAINT uq_risto_shift_assignment_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_shift_assignment_shift_profile UNIQUE (tenant_id,work_shift_id,workforce_profile_id)
);

CREATE TABLE ristoairen.attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  workforce_profile_id uuid NOT NULL,
  shift_assignment_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('CLOCK_IN','CLOCK_OUT','EXCEPTION_REQUESTED','EXCEPTION_APPROVED','EXCEPTION_REJECTED')),
  occurred_at timestamptz NOT NULL,
  recorded_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  related_event_id uuid,
  requested_adjustment_minutes integer,
  reason_code text CHECK (reason_code IS NULL OR length(btrim(reason_code)) BETWEEN 1 AND 120),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_attendance_profile FOREIGN KEY (tenant_id,workforce_profile_id) REFERENCES ristoairen.workforce_profiles(tenant_id,id),
  CONSTRAINT fk_risto_attendance_assignment FOREIGN KEY (tenant_id,location_id,shift_assignment_id) REFERENCES ristoairen.shift_assignments(tenant_id,location_id,id),
  CONSTRAINT uq_risto_attendance_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT fk_risto_attendance_related FOREIGN KEY (tenant_id,location_id,related_event_id) REFERENCES ristoairen.attendance_events(tenant_id,location_id,id),
  CONSTRAINT uq_risto_attendance_idempotency UNIQUE (tenant_id,location_id,idempotency_key),
  CONSTRAINT ck_risto_attendance_event_shape CHECK (
    (event_kind IN ('CLOCK_IN','CLOCK_OUT') AND related_event_id IS NULL AND requested_adjustment_minutes IS NULL)
    OR
    (event_kind='EXCEPTION_REQUESTED' AND related_event_id IS NOT NULL AND requested_adjustment_minutes IS NOT NULL AND requested_adjustment_minutes<>0 AND requested_adjustment_minutes BETWEEN -1440 AND 1440 AND reason_code IS NOT NULL)
    OR
    (event_kind IN ('EXCEPTION_APPROVED','EXCEPTION_REJECTED') AND related_event_id IS NOT NULL AND requested_adjustment_minutes IS NULL)
  )
);
CREATE UNIQUE INDEX uq_risto_attendance_terminal_decision
  ON ristoairen.attendance_events(tenant_id,location_id,related_event_id)
  WHERE event_kind IN ('EXCEPTION_APPROVED','EXCEPTION_REJECTED');
CREATE INDEX idx_risto_attendance_profile_time
  ON ristoairen.attendance_events(tenant_id,location_id,workforce_profile_id,occurred_at,id);

CREATE TABLE ristoairen.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN','PREPARED')),
  source_request_key text NOT NULL CHECK (length(btrim(source_request_key)) BETWEEN 1 AND 200),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  prepared_at timestamptz,
  prepared_by_identity_id uuid REFERENCES identity.identities(id),
  CONSTRAINT ck_risto_payroll_period_interval CHECK (period_end >= period_start),
  CONSTRAINT ck_risto_payroll_period_prepared CHECK (
    (status='OPEN' AND prepared_at IS NULL AND prepared_by_identity_id IS NULL)
    OR (status='PREPARED' AND prepared_at IS NOT NULL AND prepared_by_identity_id IS NOT NULL)
  ),
  CONSTRAINT uq_risto_payroll_period_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_payroll_period_request UNIQUE (tenant_id,source_request_key)
);

CREATE TABLE ristoairen.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  payroll_period_id uuid NOT NULL,
  workforce_profile_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status='PREPARED'),
  worked_minutes integer NOT NULL CHECK (worked_minutes >= 0),
  approved_adjustment_minutes integer NOT NULL DEFAULT 0,
  payable_minutes integer NOT NULL CHECK (payable_minutes >= 0),
  source_event_ids uuid[] NOT NULL CHECK (cardinality(source_event_ids) >= 2),
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  prepared_at timestamptz NOT NULL,
  prepared_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_payroll_run_period FOREIGN KEY (tenant_id,payroll_period_id) REFERENCES ristoairen.payroll_periods(tenant_id,id),
  CONSTRAINT fk_risto_payroll_run_profile FOREIGN KEY (tenant_id,workforce_profile_id) REFERENCES ristoairen.workforce_profiles(tenant_id,id),
  CONSTRAINT ck_risto_payroll_run_formula CHECK (payable_minutes = worked_minutes + approved_adjustment_minutes),
  CONSTRAINT uq_risto_payroll_run_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_payroll_run_period_profile UNIQUE (tenant_id,payroll_period_id,workforce_profile_id)
);

CREATE OR REPLACE FUNCTION ristoairen.validate_shift_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_shift_environment text;
DECLARE v_shift_status text;
DECLARE v_profile_environment text;
DECLARE v_profile_status text;
BEGIN
  SELECT environment_class,status INTO v_shift_environment,v_shift_status
    FROM ristoairen.work_shifts WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.work_shift_id;
  SELECT environment_class,status INTO v_profile_environment,v_profile_status
    FROM ristoairen.workforce_profiles WHERE tenant_id=NEW.tenant_id AND id=NEW.workforce_profile_id;
  IF v_shift_environment IS NULL OR v_profile_environment IS NULL THEN RAISE EXCEPTION 'SHIFT_ASSIGNMENT_AUTHORITY_NOT_FOUND'; END IF;
  IF NEW.environment_class<>v_shift_environment OR NEW.environment_class<>v_profile_environment THEN RAISE EXCEPTION 'SHIFT_ASSIGNMENT_ENVIRONMENT_MISMATCH'; END IF;
  IF NEW.status='ASSIGNED' AND (v_shift_status='CANCELLED' OR v_profile_status<>'ACTIVE') THEN RAISE EXCEPTION 'SHIFT_ASSIGNMENT_REQUIRES_ACTIVE_SUBJECT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_shift_assignment_validate BEFORE INSERT ON ristoairen.shift_assignments FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_shift_assignment();

CREATE OR REPLACE FUNCTION ristoairen.validate_attendance_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_current_identity uuid := security.current_identity_id();
DECLARE v_assignment_profile uuid;
DECLARE v_assignment_status text;
DECLARE v_assignment_environment text;
DECLARE v_shift_status text;
DECLARE v_profile_identity uuid;
DECLARE v_profile_status text;
DECLARE v_profile_environment text;
DECLARE v_related_kind text;
DECLARE v_related_profile uuid;
DECLARE v_related_assignment uuid;
DECLARE v_related_occurred timestamptz;
BEGIN
  IF v_current_identity IS NULL OR NEW.recorded_by_identity_id<>v_current_identity THEN RAISE EXCEPTION 'ATTENDANCE_RECORDED_BY_SCOPE_MISMATCH'; END IF;
  SELECT sa.workforce_profile_id,sa.status,sa.environment_class,ws.status
    INTO v_assignment_profile,v_assignment_status,v_assignment_environment,v_shift_status
    FROM ristoairen.shift_assignments sa
    JOIN ristoairen.work_shifts ws ON ws.tenant_id=sa.tenant_id AND ws.location_id=sa.location_id AND ws.id=sa.work_shift_id
   WHERE sa.tenant_id=NEW.tenant_id AND sa.location_id=NEW.location_id AND sa.id=NEW.shift_assignment_id;
  SELECT identity_id,status,environment_class INTO v_profile_identity,v_profile_status,v_profile_environment
    FROM ristoairen.workforce_profiles WHERE tenant_id=NEW.tenant_id AND id=NEW.workforce_profile_id;
  IF v_assignment_profile IS NULL OR v_profile_identity IS NULL THEN RAISE EXCEPTION 'ATTENDANCE_SUBJECT_NOT_FOUND'; END IF;
  IF v_assignment_profile<>NEW.workforce_profile_id THEN RAISE EXCEPTION 'ATTENDANCE_ASSIGNMENT_SUBJECT_MISMATCH'; END IF;
  IF NEW.environment_class<>v_assignment_environment OR NEW.environment_class<>v_profile_environment THEN RAISE EXCEPTION 'ATTENDANCE_ENVIRONMENT_MISMATCH'; END IF;
  IF v_assignment_status<>'ASSIGNED' OR v_shift_status='CANCELLED' OR v_profile_status<>'ACTIVE' THEN RAISE EXCEPTION 'ATTENDANCE_REQUIRES_ACTIVE_ASSIGNMENT'; END IF;

  IF NEW.event_kind IN ('CLOCK_IN','CLOCK_OUT') THEN
    IF v_current_identity<>v_profile_identity THEN RAISE EXCEPTION 'ATTENDANCE_SELF_SCOPE_MISMATCH'; END IF;
    RETURN NEW;
  END IF;

  SELECT event_kind,workforce_profile_id,shift_assignment_id,occurred_at
    INTO v_related_kind,v_related_profile,v_related_assignment,v_related_occurred
    FROM ristoairen.attendance_events
   WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.related_event_id;
  IF v_related_kind IS NULL OR v_related_profile<>NEW.workforce_profile_id OR v_related_assignment<>NEW.shift_assignment_id THEN RAISE EXCEPTION 'ATTENDANCE_RELATED_EVENT_SCOPE_MISMATCH'; END IF;

  IF NEW.event_kind='EXCEPTION_REQUESTED' THEN
    IF v_related_kind NOT IN ('CLOCK_IN','CLOCK_OUT') THEN RAISE EXCEPTION 'ATTENDANCE_EXCEPTION_REQUIRES_CLOCK_SOURCE'; END IF;
    IF v_current_identity<>v_profile_identity THEN RAISE EXCEPTION 'ATTENDANCE_EXCEPTION_SELF_SCOPE_MISMATCH'; END IF;
    IF NEW.occurred_at<v_related_occurred THEN RAISE EXCEPTION 'ATTENDANCE_EXCEPTION_TIME_INVALID'; END IF;
    RETURN NEW;
  END IF;

  IF v_related_kind<>'EXCEPTION_REQUESTED' THEN RAISE EXCEPTION 'ATTENDANCE_DECISION_REQUIRES_REQUEST'; END IF;
  IF v_current_identity=v_profile_identity THEN RAISE EXCEPTION 'ATTENDANCE_EXCEPTION_SELF_APPROVAL_DENIED'; END IF;
  IF NEW.occurred_at<v_related_occurred THEN RAISE EXCEPTION 'ATTENDANCE_DECISION_TIME_INVALID'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_attendance_validate BEFORE INSERT ON ristoairen.attendance_events FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_attendance_event();

CREATE OR REPLACE FUNCTION ristoairen.guard_attendance_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ATTENDANCE_EVENT_IMMUTABLE'; END $$;
CREATE TRIGGER trg_risto_attendance_immutable BEFORE UPDATE OR DELETE ON ristoairen.attendance_events FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_attendance_immutable();

CREATE OR REPLACE FUNCTION ristoairen.validate_payroll_period_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_current_identity uuid := security.current_identity_id();
BEGIN
  IF NEW.status='PREPARED' AND (v_current_identity IS NULL OR NEW.prepared_by_identity_id<>v_current_identity) THEN RAISE EXCEPTION 'PAYROLL_PERIOD_PREPARED_BY_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_payroll_period_validate BEFORE INSERT ON ristoairen.payroll_periods FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_payroll_period_insert();

CREATE OR REPLACE FUNCTION ristoairen.validate_payroll_run_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_current_identity uuid := security.current_identity_id();
DECLARE v_period_status text;
DECLARE v_period_environment text;
DECLARE v_profile_status text;
DECLARE v_profile_environment text;
BEGIN
  IF v_current_identity IS NULL OR NEW.prepared_by_identity_id<>v_current_identity THEN RAISE EXCEPTION 'PAYROLL_RUN_PREPARED_BY_SCOPE_MISMATCH'; END IF;
  SELECT status,environment_class INTO v_period_status,v_period_environment FROM ristoairen.payroll_periods WHERE tenant_id=NEW.tenant_id AND id=NEW.payroll_period_id;
  SELECT status,environment_class INTO v_profile_status,v_profile_environment FROM ristoairen.workforce_profiles WHERE tenant_id=NEW.tenant_id AND id=NEW.workforce_profile_id;
  IF v_period_status<>'PREPARED' OR v_profile_status<>'ACTIVE' THEN RAISE EXCEPTION 'PAYROLL_RUN_REQUIRES_PREPARED_PERIOD_ACTIVE_PROFILE'; END IF;
  IF NEW.environment_class<>v_period_environment OR NEW.environment_class<>v_profile_environment THEN RAISE EXCEPTION 'PAYROLL_RUN_ENVIRONMENT_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_payroll_run_validate BEFORE INSERT ON ristoairen.payroll_runs FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_payroll_run_insert();

CREATE OR REPLACE FUNCTION ristoairen.guard_payroll_preparation_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PAYROLL_PREPARATION_IMMUTABLE'; END $$;
CREATE TRIGGER trg_risto_payroll_period_immutable BEFORE UPDATE OR DELETE ON ristoairen.payroll_periods FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_payroll_preparation_immutable();
CREATE TRIGGER trg_risto_payroll_run_immutable BEFORE UPDATE OR DELETE ON ristoairen.payroll_runs FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_payroll_preparation_immutable();

ALTER TABLE ristoairen.workforce_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.workforce_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.work_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.work_shifts FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.shift_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.attendance_events FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.payroll_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.payroll_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_workforce_profile_tenant_select ON ristoairen.workforce_profiles FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id());
CREATE POLICY risto_work_shift_scope_select ON ristoairen.work_shifts FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_shift_assignment_scope_select ON ristoairen.shift_assignments FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_attendance_scope_select ON ristoairen.attendance_events FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_attendance_scope_insert ON ristoairen.attendance_events FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id() AND recorded_by_identity_id=security.current_identity_id());
CREATE POLICY risto_payroll_period_tenant_select ON ristoairen.payroll_periods FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id());
CREATE POLICY risto_payroll_period_tenant_insert ON ristoairen.payroll_periods FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND prepared_by_identity_id=security.current_identity_id());
CREATE POLICY risto_payroll_run_tenant_select ON ristoairen.payroll_runs FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id());
CREATE POLICY risto_payroll_run_tenant_insert ON ristoairen.payroll_runs FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND prepared_by_identity_id=security.current_identity_id());

REVOKE ALL ON ristoairen.workforce_profiles,ristoairen.work_shifts,ristoairen.shift_assignments,ristoairen.attendance_events,ristoairen.payroll_periods,ristoairen.payroll_runs FROM airen_app;
GRANT SELECT ON ristoairen.workforce_profiles,ristoairen.work_shifts,ristoairen.shift_assignments TO airen_app;
GRANT SELECT,INSERT ON ristoairen.attendance_events,ristoairen.payroll_periods,ristoairen.payroll_runs TO airen_app;

COMMIT;
