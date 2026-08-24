-- R3-C / 0009 TenantDomain registry lifecycle + safe public resolution
-- Custom-domain registry is context resolution, never authorization.
BEGIN;

ALTER TABLE platform.tenant_domains
  ADD CONSTRAINT uq_tenant_domains_tenant_id_id UNIQUE (tenant_id, id);
ALTER TABLE platform.tenant_domains
  ADD CONSTRAINT ck_tenant_domains_verification_state
  CHECK (verification_state IN ('unverified','pending','verified','failed'));

CREATE TABLE platform.tenant_domain_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('pending','verified','active','disabled','error')),
  from_verification_state text,
  to_verification_state text NOT NULL CHECK (to_verification_state IN ('unverified','pending','verified','failed')),
  from_location_id uuid,
  to_location_id uuid,
  reason_code text NOT NULL,
  verification_evidence_ref text,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tenant_domain_transition_scope FOREIGN KEY (tenant_id, domain_id) REFERENCES platform.tenant_domains(tenant_id, id),
  CONSTRAINT fk_tenant_domain_transition_from_location_scope FOREIGN KEY (tenant_id, from_location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT fk_tenant_domain_transition_to_location_scope FOREIGN KEY (tenant_id, to_location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT ck_tenant_domain_transition_from_status CHECK (from_status IS NULL OR from_status IN ('pending','verified','active','disabled','error')),
  CONSTRAINT ck_tenant_domain_transition_from_verification CHECK (from_verification_state IS NULL OR from_verification_state IN ('unverified','pending','verified','failed')),
  CONSTRAINT ck_tenant_domain_transition_actual_change CHECK (
    from_status IS DISTINCT FROM to_status
    OR from_verification_state IS DISTINCT FROM to_verification_state
    OR from_location_id IS DISTINCT FROM to_location_id
  )
);
CREATE INDEX idx_tenant_domain_transitions_domain_created ON platform.tenant_domain_transitions(domain_id, created_at DESC);
CREATE INDEX idx_tenant_domain_transitions_tenant_created ON platform.tenant_domain_transitions(tenant_id, created_at DESC);
ALTER TABLE platform.tenant_domain_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_domain_transitions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.tenant_domain_transitions FROM PUBLIC;

CREATE TABLE platform.tenant_domain_lifecycle_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  action_key text NOT NULL CHECK (action_key IN ('register','start_verification','verify','fail_verification','retry_verification','activate','disable','set_location')),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  domain_id uuid,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT fk_tenant_domain_idempotency_scope FOREIGN KEY (tenant_id, domain_id) REFERENCES platform.tenant_domains(tenant_id, id),
  CONSTRAINT ck_tenant_domain_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_tenant_domain_idempotency_completed CHECK (status <> 'completed' OR (result IS NOT NULL AND completed_at IS NOT NULL))
);
ALTER TABLE platform.tenant_domain_lifecycle_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_domain_lifecycle_idempotency FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.tenant_domain_lifecycle_idempotency FROM PUBLIC;

INSERT INTO authz.permission_registry(permission_key, description, sensitivity) VALUES
  ('platform.domains.read', 'Read safe TenantDomain control-plane projections', 'high'),
  ('platform.domains.register', 'Register a custom TenantDomain', 'critical'),
  ('platform.domains.verify', 'Advance trusted TenantDomain verification state', 'critical'),
  ('platform.domains.activate', 'Activate a verified TenantDomain', 'critical'),
  ('platform.domains.disable', 'Disable an active TenantDomain', 'critical'),
  ('platform.domains.bind_location', 'Bind, rebind or detach a TenantDomain Location', 'critical')
ON CONFLICT (permission_key) DO NOTHING;

-- R3-C authority cutover: the application role may read tenant-scoped rows through RLS,
-- but it may no longer mutate the registry directly.
REVOKE INSERT, UPDATE, DELETE ON platform.tenant_domains FROM airen_app;
REVOKE INSERT, UPDATE, DELETE ON platform.tenant_domains FROM airen_control_plane;

GRANT SELECT, INSERT, UPDATE ON platform.tenant_domains TO airen_control_plane_owner;
GRANT SELECT ON platform.tenants, platform.locations TO airen_control_plane_owner;
GRANT SELECT ON authz.platform_role_assignments, authz.role_permission_grants TO airen_control_plane_owner;
GRANT SELECT, INSERT, UPDATE ON platform.tenant_domain_lifecycle_idempotency TO airen_control_plane_owner;
GRANT SELECT, INSERT ON platform.tenant_domain_transitions TO airen_control_plane_owner;
GRANT INSERT ON audit.audit_events, events.outbox_events TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.platform_register_tenant_domain(
  p_idempotency_key text,
  p_tenant_id uuid,
  p_hostname text,
  p_location_id uuid
)
RETURNS TABLE (
  action_key text,
  domain_id uuid,
  tenant_id uuid,
  location_id uuid,
  domain_hostname text,
  domain_status text,
  verification_state text,
  domain_created_at timestamptz,
  domain_updated_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id', true), '');
  v_host text;
  v_tenant_status text;
  v_location_status text;
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_domain platform.tenant_domains%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.domains.register' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:tenant_id' USING ERRCODE='22023'; END IF;

  v_host := lower(btrim(p_hostname));
  IF right(v_host,1)='.' THEN v_host := left(v_host,char_length(v_host)-1); END IF;
  IF char_length(v_host) NOT BETWEEN 1 AND 253 OR v_host !~ '^[a-z0-9.-]+$' OR v_host LIKE '.%' OR v_host LIKE '%.' OR v_host LIKE '%..%' OR v_host ~ '[:/[:space:]]' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:hostname' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM regexp_split_to_table(v_host, '\.') AS label(value)
    WHERE char_length(label.value) > 63 OR label.value !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  ) THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:hostname_label' USING ERRCODE='22023'; END IF;
  IF v_host='ristoairen.com' OR right(v_host,char_length('.ristoairen.com'))='.ristoairen.com' THEN
    RAISE EXCEPTION 'AIRENOS_RESERVED_PLATFORM_HOSTNAME' USING ERRCODE='P0001';
  END IF;

  SELECT t.status INTO v_tenant_status FROM platform.tenants t WHERE t.id=p_tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_TENANT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_tenant_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_TENANT_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;

  IF p_location_id IS NOT NULL THEN
    SELECT l.status INTO v_location_status FROM platform.locations l WHERE l.id=p_location_id AND l.tenant_id=p_tenant_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_LOCATION_SCOPE_MISMATCH' USING ERRCODE='P0001'; END IF;
    IF v_location_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_LOCATION_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;
  END IF;

  v_request_hash := encode(public.digest(jsonb_build_object('action','register','tenantId',p_tenant_id,'hostname',v_host,'locationId',p_location_id)::text,'sha256'),'hex');
  INSERT INTO platform.tenant_domain_lifecycle_idempotency(idempotency_key,request_hash,action_key,tenant_id,actor_identity_id)
  VALUES (p_idempotency_key,v_request_hash,'register',p_tenant_id,v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result
  FROM platform.tenant_domain_lifecycle_idempotency i WHERE i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT 'register', (v_existing_result->>'id')::uuid, (v_existing_result->>'tenantId')::uuid, NULLIF(v_existing_result->>'locationId','')::uuid,
      v_existing_result->>'hostname', v_existing_result->>'status', v_existing_result->>'verificationState',
      (v_existing_result->>'createdAt')::timestamptz, (v_existing_result->>'updatedAt')::timestamptz, true;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM platform.tenant_domains d WHERE lower(d.hostname)=v_host) THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_HOSTNAME_CONFLICT' USING ERRCODE='23505'; END IF;
  INSERT INTO platform.tenant_domains(tenant_id,location_id,hostname,status,verification_state)
  VALUES (p_tenant_id,p_location_id,v_host,'pending','unverified') RETURNING * INTO v_domain;

  INSERT INTO platform.tenant_domain_transitions(domain_id,tenant_id,from_status,to_status,from_verification_state,to_verification_state,from_location_id,to_location_id,reason_code,actor_identity_id,correlation_id)
  VALUES (v_domain.id,v_domain.tenant_id,NULL,v_domain.status,NULL,v_domain.verification_state,NULL,v_domain.location_id,'domain.registered',v_actor,v_correlation);
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES (v_domain.tenant_id,v_domain.location_id,v_actor,'user','platform.tenant_domain.register','TenantDomain',v_domain.id::text,v_correlation,'success',jsonb_build_object('hostname',v_domain.hostname));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES (v_domain.tenant_id,v_domain.location_id,'platform.tenant_domain.registered','TenantDomain',v_domain.id::text,1,jsonb_build_object('tenantId',v_domain.tenant_id,'domainId',v_domain.id,'hostname',v_domain.hostname,'status',v_domain.status),v_correlation);

  v_result := jsonb_build_object('id',v_domain.id,'tenantId',v_domain.tenant_id,'locationId',v_domain.location_id,'hostname',v_domain.hostname,'status',v_domain.status,'verificationState',v_domain.verification_state,'createdAt',v_domain.created_at,'updatedAt',v_domain.updated_at);
  UPDATE platform.tenant_domain_lifecycle_idempotency SET domain_id=v_domain.id,status='completed',result=v_result,completed_at=now() WHERE idempotency_key=p_idempotency_key;
  RETURN QUERY SELECT 'register',v_domain.id,v_domain.tenant_id,v_domain.location_id,v_domain.hostname,v_domain.status,v_domain.verification_state,v_domain.created_at,v_domain.updated_at,false;
END;
$$;
ALTER FUNCTION security.platform_register_tenant_domain(text,uuid,text,uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_register_tenant_domain(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_register_tenant_domain(text,uuid,text,uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_mutate_tenant_domain(
  p_action text,
  p_idempotency_key text,
  p_domain_id uuid,
  p_location_id uuid,
  p_reason_code text,
  p_verification_evidence_ref text
)
RETURNS TABLE (
  action_key text,
  domain_id uuid,
  tenant_id uuid,
  location_id uuid,
  domain_hostname text,
  domain_status text,
  verification_state text,
  domain_created_at timestamptz,
  domain_updated_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id', true), '');
  v_permission text;
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_tenant_status text;
  v_location_status text;
  v_effective_location_id uuid;
  v_from_status text;
  v_from_verification text;
  v_from_location uuid;
  v_reason text;
  v_domain platform.tenant_domains%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('start_verification','verify','fail_verification','retry_verification','activate','disable','set_location') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:action' USING ERRCODE='22023'; END IF;
  v_permission := CASE
    WHEN p_action IN ('start_verification','verify','fail_verification','retry_verification') THEN 'platform.domains.verify'
    WHEN p_action='activate' THEN 'platform.domains.activate'
    WHEN p_action='disable' THEN 'platform.domains.disable'
    ELSE 'platform.domains.bind_location'
  END;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key=v_permission AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_domain_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:domain_id' USING ERRCODE='22023'; END IF;
  IF p_action IN ('fail_verification','disable','set_location') AND (p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;
  IF p_action IN ('verify','fail_verification') AND (p_verification_evidence_ref IS NULL OR char_length(btrim(p_verification_evidence_ref)) NOT BETWEEN 3 AND 256) THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:verification_evidence_ref' USING ERRCODE='22023'; END IF;
  IF p_action NOT IN ('verify','fail_verification') AND p_verification_evidence_ref IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:unexpected_verification_evidence' USING ERRCODE='22023'; END IF;
  IF p_action <> 'set_location' AND p_location_id IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:unexpected_location' USING ERRCODE='22023'; END IF;

  SELECT d.* INTO v_domain FROM platform.tenant_domains d WHERE d.id=p_domain_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_TENANT_DOMAIN_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  v_request_hash := encode(public.digest(jsonb_build_object('action',p_action,'domainId',p_domain_id,'locationId',p_location_id,'reasonCode',p_reason_code,'verificationEvidenceRef',p_verification_evidence_ref)::text,'sha256'),'hex');
  INSERT INTO platform.tenant_domain_lifecycle_idempotency(idempotency_key,request_hash,action_key,tenant_id,domain_id,actor_identity_id)
  VALUES (p_idempotency_key,v_request_hash,p_action,v_domain.tenant_id,p_domain_id,v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result
  FROM platform.tenant_domain_lifecycle_idempotency i WHERE i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT p_action, (v_existing_result->>'id')::uuid, (v_existing_result->>'tenantId')::uuid, NULLIF(v_existing_result->>'locationId','')::uuid,
      v_existing_result->>'hostname', v_existing_result->>'status', v_existing_result->>'verificationState',
      (v_existing_result->>'createdAt')::timestamptz, (v_existing_result->>'updatedAt')::timestamptz, true;
    RETURN;
  END IF;

  v_from_status := v_domain.status;
  v_from_verification := v_domain.verification_state;
  v_from_location := v_domain.location_id;

  IF p_action='start_verification' THEN
    IF v_domain.status <> 'pending' OR v_domain.verification_state <> 'unverified' THEN RAISE EXCEPTION 'AIRENOS_INVALID_DOMAIN_STATE:start_verification' USING ERRCODE='P0001'; END IF;
    v_reason := 'verification.started';
    UPDATE platform.tenant_domains SET verification_state='pending',updated_at=now() WHERE id=p_domain_id RETURNING * INTO v_domain;
  ELSIF p_action='verify' THEN
    IF v_domain.status <> 'pending' OR v_domain.verification_state <> 'pending' THEN RAISE EXCEPTION 'AIRENOS_INVALID_DOMAIN_STATE:verify' USING ERRCODE='P0001'; END IF;
    v_reason := 'verification.passed';
    UPDATE platform.tenant_domains SET status='verified',verification_state='verified',updated_at=now() WHERE id=p_domain_id RETURNING * INTO v_domain;
  ELSIF p_action='fail_verification' THEN
    IF v_domain.status <> 'pending' OR v_domain.verification_state <> 'pending' THEN RAISE EXCEPTION 'AIRENOS_INVALID_DOMAIN_STATE:fail_verification' USING ERRCODE='P0001'; END IF;
    v_reason := p_reason_code;
    UPDATE platform.tenant_domains SET status='error',verification_state='failed',updated_at=now() WHERE id=p_domain_id RETURNING * INTO v_domain;
  ELSIF p_action='retry_verification' THEN
    IF v_domain.status <> 'error' OR v_domain.verification_state <> 'failed' THEN RAISE EXCEPTION 'AIRENOS_INVALID_DOMAIN_STATE:retry_verification' USING ERRCODE='P0001'; END IF;
    v_reason := 'verification.retried';
    UPDATE platform.tenant_domains SET status='pending',verification_state='pending',updated_at=now() WHERE id=p_domain_id RETURNING * INTO v_domain;
  ELSIF p_action='activate' THEN
    IF v_domain.status NOT IN ('verified','disabled') OR v_domain.verification_state <> 'verified' THEN RAISE EXCEPTION 'AIRENOS_INVALID_DOMAIN_STATE:activate_requires_verified' USING ERRCODE='P0001'; END IF;
    SELECT t.status INTO v_tenant_status FROM platform.tenants t WHERE t.id=v_domain.tenant_id FOR SHARE;
    IF v_tenant_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_TENANT_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;
    v_effective_location_id := v_domain.location_id;
    IF v_effective_location_id IS NULL THEN SELECT l.id INTO v_effective_location_id FROM platform.locations l WHERE l.tenant_id=v_domain.tenant_id AND l.is_primary=true AND l.status='active'; END IF;
    IF v_effective_location_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_ACTIVE_LOCATION_REQUIRED' USING ERRCODE='P0001'; END IF;
    SELECT l.status INTO v_location_status FROM platform.locations l WHERE l.id=v_effective_location_id AND l.tenant_id=v_domain.tenant_id;
    IF v_location_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_ACTIVE_LOCATION_REQUIRED' USING ERRCODE='P0001'; END IF;
    v_reason := 'domain.activated';
    UPDATE platform.tenant_domains SET status='active',updated_at=now() WHERE id=p_domain_id RETURNING * INTO v_domain;
  ELSIF p_action='disable' THEN
    IF v_domain.status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_INVALID_DOMAIN_STATE:disable_requires_active' USING ERRCODE='P0001'; END IF;
    v_reason := p_reason_code;
    UPDATE platform.tenant_domains SET status='disabled',updated_at=now() WHERE id=p_domain_id RETURNING * INTO v_domain;
  ELSE
    IF v_domain.location_id IS NOT DISTINCT FROM p_location_id THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_BINDING_UNCHANGED' USING ERRCODE='P0001'; END IF;
    IF p_location_id IS NOT NULL THEN
      SELECT l.status INTO v_location_status FROM platform.locations l WHERE l.id=p_location_id AND l.tenant_id=v_domain.tenant_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_LOCATION_SCOPE_MISMATCH' USING ERRCODE='P0001'; END IF;
      IF v_location_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_LOCATION_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;
    ELSIF v_domain.status='active' THEN
      SELECT l.id INTO v_effective_location_id FROM platform.locations l WHERE l.tenant_id=v_domain.tenant_id AND l.is_primary=true AND l.status='active';
      IF v_effective_location_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_DOMAIN_ACTIVE_LOCATION_REQUIRED' USING ERRCODE='P0001'; END IF;
    END IF;
    v_reason := p_reason_code;
    UPDATE platform.tenant_domains SET location_id=p_location_id,updated_at=now() WHERE id=p_domain_id RETURNING * INTO v_domain;
  END IF;

  INSERT INTO platform.tenant_domain_transitions(domain_id,tenant_id,from_status,to_status,from_verification_state,to_verification_state,from_location_id,to_location_id,reason_code,verification_evidence_ref,actor_identity_id,correlation_id)
  VALUES (v_domain.id,v_domain.tenant_id,v_from_status,v_domain.status,v_from_verification,v_domain.verification_state,v_from_location,v_domain.location_id,v_reason,p_verification_evidence_ref,v_actor,v_correlation);
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES (v_domain.tenant_id,v_domain.location_id,v_actor,'user','platform.tenant_domain.'||p_action,'TenantDomain',v_domain.id::text,v_correlation,'success',
    jsonb_strip_nulls(jsonb_build_object('hostname',v_domain.hostname,'reasonCode',v_reason,'verificationEvidenceRef',p_verification_evidence_ref,'fromStatus',v_from_status,'status',v_domain.status,'fromVerificationState',v_from_verification,'verificationState',v_domain.verification_state,'fromLocationId',v_from_location,'locationId',v_domain.location_id)));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES (v_domain.tenant_id,v_domain.location_id,'platform.tenant_domain.'||p_action,'TenantDomain',v_domain.id::text,1,
    jsonb_strip_nulls(jsonb_build_object('tenantId',v_domain.tenant_id,'domainId',v_domain.id,'hostname',v_domain.hostname,'status',v_domain.status,'verificationState',v_domain.verification_state,'locationId',v_domain.location_id,'reasonCode',v_reason)),v_correlation);

  v_result := jsonb_build_object('id',v_domain.id,'tenantId',v_domain.tenant_id,'locationId',v_domain.location_id,'hostname',v_domain.hostname,'status',v_domain.status,'verificationState',v_domain.verification_state,'createdAt',v_domain.created_at,'updatedAt',v_domain.updated_at);
  UPDATE platform.tenant_domain_lifecycle_idempotency SET status='completed',result=v_result,completed_at=now() WHERE idempotency_key=p_idempotency_key;
  RETURN QUERY SELECT p_action,v_domain.id,v_domain.tenant_id,v_domain.location_id,v_domain.hostname,v_domain.status,v_domain.verification_state,v_domain.created_at,v_domain.updated_at,false;
END;
$$;
ALTER FUNCTION security.platform_mutate_tenant_domain(text,text,uuid,uuid,text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_tenant_domain(text,text,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_tenant_domain(text,text,uuid,uuid,text,text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_get_tenant_domain(p_domain_id uuid)
RETURNS TABLE(domain_id uuid,tenant_id uuid,location_id uuid,domain_hostname text,domain_status text,verification_state text,domain_created_at timestamptz,domain_updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.domains.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT d.id,d.tenant_id,d.location_id,d.hostname,d.status,d.verification_state,d.created_at,d.updated_at FROM platform.tenant_domains d WHERE d.id=p_domain_id;
END; $$;
ALTER FUNCTION security.platform_get_tenant_domain(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_tenant_domain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_tenant_domain(uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_tenant_domains(p_tenant_id uuid,p_status text,p_after_id uuid,p_limit integer)
RETURNS TABLE(domain_id uuid,tenant_id uuid,location_id uuid,domain_hostname text,domain_status text,verification_state text,domain_created_at timestamptz,domain_updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.domains.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  IF p_tenant_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_status IS NOT NULL AND p_status NOT IN ('pending','verified','active','disabled','error')) THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT d.id,d.tenant_id,d.location_id,d.hostname,d.status,d.verification_state,d.created_at,d.updated_at
  FROM platform.tenant_domains d WHERE d.tenant_id=p_tenant_id AND (p_status IS NULL OR d.status=p_status) AND (p_after_id IS NULL OR d.id>p_after_id)
  ORDER BY d.id ASC LIMIT p_limit;
END; $$;
ALTER FUNCTION security.platform_list_tenant_domains(uuid,text,uuid,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_tenant_domains(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_tenant_domains(uuid,text,uuid,integer) TO airen_control_plane;

-- Public route capability for exact registered custom hostnames. It returns only active,
-- verified Tenant + effective active Location projections and does not grant private data authority.
CREATE OR REPLACE FUNCTION security.resolve_active_tenant_domain_route(p_hostname text)
RETURNS TABLE(
  domain_id uuid, domain_tenant_id uuid, domain_location_id uuid, domain_hostname text, domain_status text,
  tenant_id_out uuid, tenant_slug text, tenant_name text, tenant_status text,
  location_id_out uuid, location_tenant_id uuid, location_slug text, location_name text, location_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT d.id,d.tenant_id,d.location_id,d.hostname,d.status,
         t.id,t.slug,t.name,t.status,
         l.id,l.tenant_id,l.slug,l.name,l.status
  FROM platform.tenant_domains d
  JOIN platform.tenants t ON t.id=d.tenant_id AND t.status='active'
  JOIN platform.locations l ON l.tenant_id=d.tenant_id AND l.id=COALESCE(d.location_id,(SELECT p.id FROM platform.locations p WHERE p.tenant_id=d.tenant_id AND p.is_primary=true LIMIT 1)) AND l.status='active'
  WHERE d.hostname=lower(btrim(p_hostname)) AND d.status='active' AND d.verification_state='verified'
  LIMIT 1
$$;
ALTER FUNCTION security.resolve_active_tenant_domain_route(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.resolve_active_tenant_domain_route(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.resolve_active_tenant_domain_route(text) TO airen_app;

CREATE OR REPLACE FUNCTION security.resolve_active_tenant_slug_route(p_slug text)
RETURNS TABLE(
  tenant_id_out uuid, tenant_slug text, tenant_name text, tenant_status text,
  location_id_out uuid, location_tenant_id uuid, location_slug text, location_name text, location_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT t.id,t.slug,t.name,t.status,l.id,l.tenant_id,l.slug,l.name,l.status
  FROM platform.tenants t
  JOIN platform.locations l ON l.tenant_id=t.id AND l.is_primary=true AND l.status='active'
  WHERE t.slug=lower(btrim(p_slug)) AND t.status='active'
  LIMIT 1
$$;
ALTER FUNCTION security.resolve_active_tenant_slug_route(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.resolve_active_tenant_slug_route(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.resolve_active_tenant_slug_route(text) TO airen_app;

COMMIT;
