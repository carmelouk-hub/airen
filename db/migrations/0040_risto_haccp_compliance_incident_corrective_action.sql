-- RISTO-MAT-031 / GJ2-025 — HACCP / compliance / incident / corrective action runtime
-- Synthetic TEST_TEMPORARY operational evidence only. No jurisdictional/legal HACCP certification.
BEGIN;

INSERT INTO billing.entitlement_catalog (entitlement_key,description) VALUES
  ('compliance.enabled','RISTOAIREN compliance and operational safety runtime')
ON CONFLICT (entitlement_key) DO NOTHING;

INSERT INTO authz.permission_registry (permission_key,description,sensitivity) VALUES
  ('compliance.check.read','Read scoped compliance checks and minimal related evidence','sensitive'),
  ('compliance.check.record','Append a scoped FoodSafetyCheck','sensitive'),
  ('compliance.noncompliance.raise','Raise scoped NonCompliance evidence','high'),
  ('compliance.incident.raise','Raise scoped OperationalIncident evidence','high'),
  ('compliance.corrective_action.read','Read scoped corrective work','sensitive'),
  ('compliance.corrective_action.assign','Assign scoped corrective work','high'),
  ('compliance.corrective_action.close','Close non-critical scoped corrective work','high'),
  ('compliance.corrective_action.close_critical','Privileged closure of CRITICAL corrective work','critical')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE ristoairen.food_safety_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  code text NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 120),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 240),
  status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
  version integer NOT NULL CHECK (version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_food_safety_plan_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_food_safety_plan_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_food_safety_plan_code_version UNIQUE (tenant_id,location_id,code,version)
);

CREATE TABLE ristoairen.food_safety_control_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  food_safety_plan_id uuid NOT NULL,
  control_code text NOT NULL CHECK (length(btrim(control_code)) BETWEEN 1 AND 120),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 240),
  control_type text NOT NULL CHECK (length(btrim(control_type)) BETWEEN 1 AND 120),
  process_reference text CHECK (process_reference IS NULL OR length(btrim(process_reference)) BETWEEN 1 AND 240),
  equipment_reference text CHECK (equipment_reference IS NULL OR length(btrim(equipment_reference)) BETWEEN 1 AND 240),
  schedule_reference text CHECK (schedule_reference IS NULL OR length(btrim(schedule_reference)) BETWEEN 1 AND 240),
  active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_food_safety_control_plan FOREIGN KEY (tenant_id,location_id,food_safety_plan_id)
    REFERENCES ristoairen.food_safety_plans(tenant_id,location_id,id),
  CONSTRAINT uq_risto_food_safety_control_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_food_safety_control_code UNIQUE (tenant_id,location_id,food_safety_plan_id,control_code)
);

CREATE TABLE ristoairen.food_safety_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  control_definition_id uuid NOT NULL,
  scheduled_for timestamptz,
  performed_at timestamptz NOT NULL,
  performed_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  outcome text NOT NULL CHECK (outcome IN ('PASS','NON_COMPLIANT','NOT_APPLICABLE')),
  measured_value_text text CHECK (measured_value_text IS NULL OR length(btrim(measured_value_text)) BETWEEN 1 AND 500),
  notes text CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 2000),
  evidence_reference text CHECK (evidence_reference IS NULL OR length(btrim(evidence_reference)) BETWEEN 1 AND 1000),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_food_safety_check_control FOREIGN KEY (tenant_id,location_id,control_definition_id)
    REFERENCES ristoairen.food_safety_control_definitions(tenant_id,location_id,id),
  CONSTRAINT uq_risto_food_safety_check_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_food_safety_check_idempotency UNIQUE (tenant_id,location_id,control_definition_id,idempotency_key)
);
CREATE INDEX idx_risto_food_safety_check_time
  ON ristoairen.food_safety_checks(tenant_id,location_id,control_definition_id,performed_at,id);

CREATE TABLE ristoairen.non_compliances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  food_safety_check_id uuid NOT NULL,
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACTION_REQUIRED','RESOLVED')),
  raised_at timestamptz NOT NULL,
  raised_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_non_compliance_check FOREIGN KEY (tenant_id,location_id,food_safety_check_id)
    REFERENCES ristoairen.food_safety_checks(tenant_id,location_id,id),
  CONSTRAINT uq_risto_non_compliance_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_non_compliance_check UNIQUE (tenant_id,location_id,food_safety_check_id)
);

CREATE TABLE ristoairen.operational_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  incident_type text NOT NULL CHECK (length(btrim(incident_type)) BETWEEN 1 AND 120),
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 2000),
  occurred_at timestamptz NOT NULL,
  reported_at timestamptz NOT NULL,
  reported_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','CLOSED')),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_operational_incident_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_operational_incident_scope_id UNIQUE (tenant_id,location_id,id)
);

CREATE TABLE ristoairen.corrective_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  non_compliance_id uuid,
  operational_incident_id uuid,
  action_text text NOT NULL CHECK (length(btrim(action_text)) BETWEEN 1 AND 2000),
  assigned_to_identity_id uuid REFERENCES identity.identities(id),
  due_at timestamptz,
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status text NOT NULL CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS','CLOSED')),
  closure_summary text CHECK (closure_summary IS NULL OR length(btrim(closure_summary)) BETWEEN 1 AND 2000),
  closure_evidence_reference text CHECK (closure_evidence_reference IS NULL OR length(btrim(closure_evidence_reference)) BETWEEN 1 AND 1000),
  closed_at timestamptz,
  closed_by_identity_id uuid REFERENCES identity.identities(id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_corrective_action_non_compliance FOREIGN KEY (tenant_id,location_id,non_compliance_id)
    REFERENCES ristoairen.non_compliances(tenant_id,location_id,id),
  CONSTRAINT fk_risto_corrective_action_incident FOREIGN KEY (tenant_id,location_id,operational_incident_id)
    REFERENCES ristoairen.operational_incidents(tenant_id,location_id,id),
  CONSTRAINT uq_risto_corrective_action_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT ck_risto_corrective_action_source CHECK (
    (non_compliance_id IS NOT NULL AND operational_incident_id IS NULL)
    OR (non_compliance_id IS NULL AND operational_incident_id IS NOT NULL)
  ),
  CONSTRAINT ck_risto_corrective_action_closure CHECK (
    (status='CLOSED' AND closure_summary IS NOT NULL AND closed_at IS NOT NULL AND closed_by_identity_id IS NOT NULL)
    OR (status<>'CLOSED' AND closure_summary IS NULL AND closure_evidence_reference IS NULL AND closed_at IS NULL AND closed_by_identity_id IS NULL)
  )
);

CREATE OR REPLACE FUNCTION ristoairen.validate_food_safety_check_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_identity uuid := security.current_identity_id();
DECLARE v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
DECLARE v_control_active boolean;
DECLARE v_control_environment text;
DECLARE v_plan_status text;
DECLARE v_plan_environment text;
BEGIN
  IF v_identity IS NULL OR NEW.performed_by_identity_id<>v_identity THEN RAISE EXCEPTION 'COMPLIANCE_CHECK_ACTOR_SCOPE_MISMATCH'; END IF;
  IF v_correlation IS NULL OR NEW.correlation_id<>v_correlation THEN RAISE EXCEPTION 'COMPLIANCE_CHECK_CORRELATION_SCOPE_MISMATCH'; END IF;
  SELECT c.active,c.environment_class,p.status,p.environment_class
    INTO v_control_active,v_control_environment,v_plan_status,v_plan_environment
    FROM ristoairen.food_safety_control_definitions c
    JOIN ristoairen.food_safety_plans p ON p.tenant_id=c.tenant_id AND p.location_id=c.location_id AND p.id=c.food_safety_plan_id
   WHERE c.tenant_id=NEW.tenant_id AND c.location_id=NEW.location_id AND c.id=NEW.control_definition_id;
  IF v_control_active IS DISTINCT FROM true OR v_plan_status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'COMPLIANCE_CONTROL_NOT_ACTIVE'; END IF;
  IF NEW.environment_class<>v_control_environment OR NEW.environment_class<>v_plan_environment THEN RAISE EXCEPTION 'COMPLIANCE_ENVIRONMENT_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_food_safety_check_validate BEFORE INSERT ON ristoairen.food_safety_checks FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_food_safety_check_insert();

CREATE OR REPLACE FUNCTION ristoairen.guard_food_safety_check_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FOOD_SAFETY_CHECK_IMMUTABLE'; END $$;
CREATE TRIGGER trg_risto_food_safety_check_immutable BEFORE UPDATE OR DELETE ON ristoairen.food_safety_checks FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_food_safety_check_immutable();

CREATE OR REPLACE FUNCTION ristoairen.validate_non_compliance_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_identity uuid := security.current_identity_id();
DECLARE v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
DECLARE v_outcome text;
DECLARE v_environment text;
BEGIN
  IF v_identity IS NULL OR NEW.raised_by_identity_id<>v_identity THEN RAISE EXCEPTION 'NON_COMPLIANCE_ACTOR_SCOPE_MISMATCH'; END IF;
  IF v_correlation IS NULL OR NEW.correlation_id<>v_correlation THEN RAISE EXCEPTION 'NON_COMPLIANCE_CORRELATION_SCOPE_MISMATCH'; END IF;
  SELECT outcome,environment_class INTO v_outcome,v_environment
    FROM ristoairen.food_safety_checks
   WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.food_safety_check_id;
  IF v_outcome IS DISTINCT FROM 'NON_COMPLIANT' THEN RAISE EXCEPTION 'NON_COMPLIANCE_REQUIRES_NON_COMPLIANT_CHECK'; END IF;
  IF NEW.environment_class<>v_environment THEN RAISE EXCEPTION 'NON_COMPLIANCE_ENVIRONMENT_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_non_compliance_validate BEFORE INSERT ON ristoairen.non_compliances FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_non_compliance_insert();

CREATE OR REPLACE FUNCTION ristoairen.validate_operational_incident_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_identity uuid := security.current_identity_id();
DECLARE v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
BEGIN
  IF v_identity IS NULL OR NEW.reported_by_identity_id<>v_identity THEN RAISE EXCEPTION 'OPERATIONAL_INCIDENT_ACTOR_SCOPE_MISMATCH'; END IF;
  IF v_correlation IS NULL OR NEW.correlation_id<>v_correlation THEN RAISE EXCEPTION 'OPERATIONAL_INCIDENT_CORRELATION_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_operational_incident_validate BEFORE INSERT ON ristoairen.operational_incidents FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_operational_incident_insert();

CREATE OR REPLACE FUNCTION ristoairen.validate_corrective_action_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
DECLARE v_source_environment text;
DECLARE v_source_status text;
BEGIN
  IF v_correlation IS NULL OR NEW.correlation_id<>v_correlation THEN RAISE EXCEPTION 'CORRECTIVE_ACTION_CORRELATION_SCOPE_MISMATCH'; END IF;
  IF NEW.non_compliance_id IS NOT NULL THEN
    SELECT environment_class,status INTO v_source_environment,v_source_status
      FROM ristoairen.non_compliances WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.non_compliance_id;
    IF v_source_status IS NULL OR v_source_status='RESOLVED' THEN RAISE EXCEPTION 'CORRECTIVE_ACTION_SOURCE_NOT_ACTIONABLE'; END IF;
  ELSE
    SELECT environment_class,status INTO v_source_environment,v_source_status
      FROM ristoairen.operational_incidents WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.operational_incident_id;
    IF v_source_status IS NULL OR v_source_status='CLOSED' THEN RAISE EXCEPTION 'CORRECTIVE_ACTION_SOURCE_NOT_ACTIONABLE'; END IF;
  END IF;
  IF NEW.environment_class<>v_source_environment THEN RAISE EXCEPTION 'CORRECTIVE_ACTION_ENVIRONMENT_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_corrective_action_validate BEFORE INSERT ON ristoairen.corrective_actions FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_corrective_action_insert();

CREATE OR REPLACE FUNCTION ristoairen.guard_corrective_action_close()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_identity uuid := security.current_identity_id();
BEGIN
  IF OLD.status='CLOSED' THEN RAISE EXCEPTION 'CORRECTIVE_ACTION_ALREADY_CLOSED'; END IF;
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.location_id<>OLD.location_id OR NEW.non_compliance_id IS DISTINCT FROM OLD.non_compliance_id OR NEW.operational_incident_id IS DISTINCT FROM OLD.operational_incident_id OR NEW.action_text<>OLD.action_text OR NEW.assigned_to_identity_id IS DISTINCT FROM OLD.assigned_to_identity_id OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.severity<>OLD.severity OR NEW.correlation_id<>OLD.correlation_id OR NEW.environment_class<>OLD.environment_class OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'CORRECTIVE_ACTION_IDENTITY_IMMUTABLE'; END IF;
  IF NEW.status<>'CLOSED' OR NEW.row_version<>OLD.row_version+1 OR NEW.closure_summary IS NULL OR NEW.closed_at IS NULL OR NEW.closed_by_identity_id IS NULL THEN RAISE EXCEPTION 'CORRECTIVE_ACTION_INVALID_CLOSURE'; END IF;
  IF v_identity IS NULL OR NEW.closed_by_identity_id<>v_identity THEN RAISE EXCEPTION 'CORRECTIVE_ACTION_CLOSED_BY_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_corrective_action_close_guard BEFORE UPDATE ON ristoairen.corrective_actions FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_corrective_action_close();

ALTER TABLE ristoairen.food_safety_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.food_safety_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.food_safety_control_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.food_safety_control_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.food_safety_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.food_safety_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.non_compliances ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.non_compliances FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.operational_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.operational_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.corrective_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_food_safety_plan_scope_select ON ristoairen.food_safety_plans FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_food_safety_control_scope_select ON ristoairen.food_safety_control_definitions FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_food_safety_check_scope_select ON ristoairen.food_safety_checks FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_food_safety_check_scope_insert ON ristoairen.food_safety_checks FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id() AND performed_by_identity_id=security.current_identity_id());
CREATE POLICY risto_non_compliance_scope_select ON ristoairen.non_compliances FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_non_compliance_scope_insert ON ristoairen.non_compliances FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id() AND raised_by_identity_id=security.current_identity_id());
CREATE POLICY risto_operational_incident_scope_select ON ristoairen.operational_incidents FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_operational_incident_scope_insert ON ristoairen.operational_incidents FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id() AND reported_by_identity_id=security.current_identity_id());
CREATE POLICY risto_corrective_action_scope_select ON ristoairen.corrective_actions FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_corrective_action_scope_insert ON ristoairen.corrective_actions FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_corrective_action_scope_update ON ristoairen.corrective_actions FOR UPDATE TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id())
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id() AND closed_by_identity_id=security.current_identity_id());

REVOKE ALL ON ristoairen.food_safety_plans,ristoairen.food_safety_control_definitions,ristoairen.food_safety_checks,ristoairen.non_compliances,ristoairen.operational_incidents,ristoairen.corrective_actions FROM airen_app;
GRANT SELECT ON ristoairen.food_safety_plans,ristoairen.food_safety_control_definitions TO airen_app;
GRANT SELECT,INSERT ON ristoairen.food_safety_checks,ristoairen.non_compliances,ristoairen.operational_incidents TO airen_app;
GRANT SELECT,INSERT ON ristoairen.corrective_actions TO airen_app;
GRANT UPDATE(status,closure_summary,closure_evidence_reference,closed_at,closed_by_identity_id,row_version,updated_at) ON ristoairen.corrective_actions TO airen_app;

COMMIT;
