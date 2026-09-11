-- RISTO-MAT-032 / GJ2-026 — STELLA proposal lifecycle PostgreSQL runtime
-- Synthetic TEST_TEMPORARY evidence only. AI_STELLA is proposal-only; target Core mutation remains target-service authority.
BEGIN;

INSERT INTO billing.entitlement_catalog (entitlement_key,description) VALUES
  ('intelligence.enabled','RISTOAIREN governed intelligence and STELLA proposal runtime')
ON CONFLICT (entitlement_key) DO NOTHING;

INSERT INTO authz.permission_registry (permission_key,description,sensitivity) VALUES
  ('intelligence.proposal.read','Read scoped STELLA DecisionProposal evidence','sensitive'),
  ('intelligence.proposal.create','Create evidence-backed STELLA DecisionProposal','high'),
  ('intelligence.proposal.review','Human review of scoped STELLA DecisionProposal','high'),
  ('intelligence.proposal.apply','Human-authorized request to apply approved STELLA DecisionProposal through target service','critical')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE ristoairen.decision_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  subject_domain text NOT NULL CHECK (length(btrim(subject_domain)) BETWEEN 1 AND 120),
  subject_reference text NOT NULL CHECK (length(btrim(subject_reference)) BETWEEN 1 AND 240),
  recommendation text NOT NULL CHECK (length(btrim(recommendation)) BETWEEN 1 AND 4000),
  rationale text NOT NULL CHECK (length(btrim(rationale)) BETWEEN 1 AND 4000),
  proposal_hash text NOT NULL CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','INVALIDATED','APPLIED')),
  target_row_version integer CHECK (target_row_version IS NULL OR target_row_version >= 0),
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  create_idempotency_key text NOT NULL CHECK (length(btrim(create_idempotency_key)) BETWEEN 1 AND 200),
  reviewed_by_identity_id uuid REFERENCES identity.identities(id),
  reviewed_at timestamptz,
  review_decision text CHECK (review_decision IS NULL OR review_decision IN ('APPROVE','REJECT')),
  review_idempotency_key text CHECK (review_idempotency_key IS NULL OR length(btrim(review_idempotency_key)) BETWEEN 1 AND 200),
  applied_by_identity_id uuid REFERENCES identity.identities(id),
  applied_at timestamptz,
  apply_idempotency_key text CHECK (apply_idempotency_key IS NULL OR length(btrim(apply_idempotency_key)) BETWEEN 1 AND 200),
  target_effect_reference text CHECK (target_effect_reference IS NULL OR length(btrim(target_effect_reference)) BETWEEN 1 AND 1000),
  applied_target_row_version integer CHECK (applied_target_row_version IS NULL OR applied_target_row_version >= 0),
  invalidated_at timestamptz,
  invalidation_reason text CHECK (invalidation_reason IS NULL OR length(btrim(invalidation_reason)) BETWEEN 1 AND 1000),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_decision_proposal_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_decision_proposal_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_decision_proposal_create_key UNIQUE (tenant_id,location_id,create_idempotency_key),
  CONSTRAINT ck_risto_decision_proposal_lifecycle CHECK (
    (status='PENDING_APPROVAL' AND reviewed_by_identity_id IS NULL AND reviewed_at IS NULL AND review_decision IS NULL AND review_idempotency_key IS NULL AND applied_by_identity_id IS NULL AND applied_at IS NULL AND apply_idempotency_key IS NULL AND target_effect_reference IS NULL AND applied_target_row_version IS NULL AND invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR
    (status='APPROVED' AND reviewed_by_identity_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_decision='APPROVE' AND review_idempotency_key IS NOT NULL AND applied_by_identity_id IS NULL AND applied_at IS NULL AND apply_idempotency_key IS NULL AND target_effect_reference IS NULL AND applied_target_row_version IS NULL AND invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR
    (status='REJECTED' AND reviewed_by_identity_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_decision='REJECT' AND review_idempotency_key IS NOT NULL AND applied_by_identity_id IS NULL AND applied_at IS NULL AND apply_idempotency_key IS NULL AND target_effect_reference IS NULL AND applied_target_row_version IS NULL AND invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR
    (status='INVALIDATED' AND reviewed_by_identity_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_decision='APPROVE' AND review_idempotency_key IS NOT NULL AND invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL AND applied_by_identity_id IS NULL AND applied_at IS NULL AND apply_idempotency_key IS NULL AND target_effect_reference IS NULL AND applied_target_row_version IS NULL)
    OR
    (status='APPLIED' AND reviewed_by_identity_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_decision='APPROVE' AND review_idempotency_key IS NOT NULL AND applied_by_identity_id IS NOT NULL AND applied_at IS NOT NULL AND apply_idempotency_key IS NOT NULL AND target_effect_reference IS NOT NULL AND invalidated_at IS NULL AND invalidation_reason IS NULL)
  )
);
CREATE UNIQUE INDEX uq_risto_decision_proposal_review_key
  ON ristoairen.decision_proposals(tenant_id,location_id,review_idempotency_key)
  WHERE review_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_risto_decision_proposal_apply_key
  ON ristoairen.decision_proposals(tenant_id,location_id,apply_idempotency_key)
  WHERE apply_idempotency_key IS NOT NULL;
CREATE INDEX idx_risto_decision_proposal_subject
  ON ristoairen.decision_proposals(tenant_id,location_id,subject_domain,subject_reference,created_at,id);

CREATE TABLE ristoairen.decision_proposal_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  source_domain text NOT NULL CHECK (length(btrim(source_domain)) BETWEEN 1 AND 120),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 1 AND 240),
  source_row_version integer CHECK (source_row_version IS NULL OR source_row_version >= 0),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_decision_proposal_evidence_proposal FOREIGN KEY (tenant_id,location_id,proposal_id)
    REFERENCES ristoairen.decision_proposals(tenant_id,location_id,id),
  CONSTRAINT uq_risto_decision_proposal_evidence_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_decision_proposal_evidence_ordinal UNIQUE (tenant_id,location_id,proposal_id,ordinal)
);

CREATE OR REPLACE FUNCTION ristoairen.validate_decision_proposal_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_identity uuid := security.current_identity_id();
DECLARE v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
BEGIN
  IF v_identity IS NULL OR NEW.created_by_identity_id<>v_identity THEN RAISE EXCEPTION 'DECISION_PROPOSAL_ACTOR_SCOPE_MISMATCH'; END IF;
  IF v_correlation IS NULL OR NEW.correlation_id<>v_correlation THEN RAISE EXCEPTION 'DECISION_PROPOSAL_CORRELATION_SCOPE_MISMATCH'; END IF;
  IF NEW.status<>'PENDING_APPROVAL' OR NEW.row_version<>1 THEN RAISE EXCEPTION 'DECISION_PROPOSAL_INVALID_INITIAL_STATE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_decision_proposal_validate_insert BEFORE INSERT ON ristoairen.decision_proposals FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_decision_proposal_insert();

CREATE OR REPLACE FUNCTION ristoairen.guard_decision_proposal_lifecycle_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_identity uuid := security.current_identity_id();
BEGIN
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.location_id<>OLD.location_id OR NEW.subject_domain<>OLD.subject_domain OR NEW.subject_reference<>OLD.subject_reference OR NEW.recommendation<>OLD.recommendation OR NEW.rationale<>OLD.rationale OR NEW.proposal_hash<>OLD.proposal_hash OR NEW.target_row_version IS DISTINCT FROM OLD.target_row_version OR NEW.created_by_identity_id<>OLD.created_by_identity_id OR NEW.create_idempotency_key<>OLD.create_idempotency_key OR NEW.correlation_id<>OLD.correlation_id OR NEW.environment_class<>OLD.environment_class OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'DECISION_PROPOSAL_IDENTITY_IMMUTABLE'; END IF;
  IF OLD.status IN ('REJECTED','INVALIDATED','APPLIED') THEN RAISE EXCEPTION 'DECISION_PROPOSAL_TERMINAL_STATE'; END IF;
  IF NEW.row_version<>OLD.row_version+1 THEN RAISE EXCEPTION 'DECISION_PROPOSAL_ROW_VERSION_INVALID'; END IF;
  IF OLD.status='PENDING_APPROVAL' AND NEW.status IN ('APPROVED','REJECTED') THEN
    IF v_identity IS NULL OR NEW.reviewed_by_identity_id<>v_identity OR NEW.reviewed_at IS NULL OR NEW.review_idempotency_key IS NULL THEN RAISE EXCEPTION 'DECISION_PROPOSAL_REVIEW_ACTOR_SCOPE_MISMATCH'; END IF;
    IF (NEW.status='APPROVED' AND NEW.review_decision<>'APPROVE') OR (NEW.status='REJECTED' AND NEW.review_decision<>'REJECT') THEN RAISE EXCEPTION 'DECISION_PROPOSAL_REVIEW_STATE_MISMATCH'; END IF;
  ELSIF OLD.status='APPROVED' AND NEW.status='INVALIDATED' THEN
    IF NEW.invalidated_at IS NULL OR NEW.invalidation_reason IS NULL THEN RAISE EXCEPTION 'DECISION_PROPOSAL_INVALIDATION_EVIDENCE_REQUIRED'; END IF;
  ELSIF OLD.status='APPROVED' AND NEW.status='APPLIED' THEN
    IF v_identity IS NULL OR NEW.applied_by_identity_id<>v_identity OR NEW.applied_at IS NULL OR NEW.apply_idempotency_key IS NULL OR NEW.target_effect_reference IS NULL THEN RAISE EXCEPTION 'DECISION_PROPOSAL_APPLY_ACTOR_SCOPE_MISMATCH'; END IF;
  ELSE
    RAISE EXCEPTION 'DECISION_PROPOSAL_INVALID_TRANSITION';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_decision_proposal_lifecycle_update BEFORE UPDATE ON ristoairen.decision_proposals FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_decision_proposal_lifecycle_update();

CREATE OR REPLACE FUNCTION ristoairen.guard_decision_proposal_delete()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DECISION_PROPOSAL_DELETE_FORBIDDEN'; END $$;
CREATE TRIGGER trg_risto_decision_proposal_delete BEFORE DELETE ON ristoairen.decision_proposals FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_decision_proposal_delete();

CREATE OR REPLACE FUNCTION ristoairen.validate_decision_proposal_evidence_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid;
DECLARE v_location uuid;
BEGIN
  SELECT tenant_id,location_id INTO v_tenant,v_location FROM ristoairen.decision_proposals WHERE id=NEW.proposal_id;
  IF v_tenant IS NULL OR v_tenant<>NEW.tenant_id OR v_location<>NEW.location_id THEN RAISE EXCEPTION 'DECISION_PROPOSAL_EVIDENCE_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_decision_proposal_evidence_validate BEFORE INSERT ON ristoairen.decision_proposal_evidence FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_decision_proposal_evidence_insert();

CREATE OR REPLACE FUNCTION ristoairen.guard_decision_proposal_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'DECISION_PROPOSAL_EVIDENCE_IMMUTABLE'; END $$;
CREATE TRIGGER trg_risto_decision_proposal_evidence_immutable BEFORE UPDATE OR DELETE ON ristoairen.decision_proposal_evidence FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_decision_proposal_evidence_immutable();

ALTER TABLE ristoairen.decision_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.decision_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.decision_proposal_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.decision_proposal_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_decision_proposal_scope_select ON ristoairen.decision_proposals FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_decision_proposal_scope_insert ON ristoairen.decision_proposals FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id() AND created_by_identity_id=security.current_identity_id());
CREATE POLICY risto_decision_proposal_scope_update ON ristoairen.decision_proposals FOR UPDATE TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id())
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_decision_proposal_evidence_scope_select ON ristoairen.decision_proposal_evidence FOR SELECT TO airen_app
  USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY risto_decision_proposal_evidence_scope_insert ON ristoairen.decision_proposal_evidence FOR INSERT TO airen_app
  WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());

REVOKE ALL ON ristoairen.decision_proposals,ristoairen.decision_proposal_evidence FROM airen_app;
GRANT SELECT,INSERT ON ristoairen.decision_proposals TO airen_app;
GRANT UPDATE(status,reviewed_by_identity_id,reviewed_at,review_decision,review_idempotency_key,applied_by_identity_id,applied_at,apply_idempotency_key,target_effect_reference,applied_target_row_version,invalidated_at,invalidation_reason,row_version,updated_at) ON ristoairen.decision_proposals TO airen_app;
GRANT SELECT,INSERT ON ristoairen.decision_proposal_evidence TO airen_app;

COMMIT;
