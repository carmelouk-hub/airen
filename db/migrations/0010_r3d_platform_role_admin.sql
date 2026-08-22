-- R3-D / 0010 Platform Principal & Role Administration
-- Platform roles are authority. No Tenant role shortcut is permitted.
BEGIN;

ALTER TABLE authz.platform_role_assignments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE authz.platform_protected_roles (
  role_key text PRIMARY KEY,
  minimum_active_assignments integer NOT NULL DEFAULT 1 CHECK (minimum_active_assignments >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_platform_protected_role_key CHECK (role_key ~ '^[a-z][a-z0-9._:-]{2,63}$')
);
INSERT INTO authz.platform_protected_roles(role_key,minimum_active_assignments)
VALUES ('platform_admin',1)
ON CONFLICT (role_key) DO NOTHING;
ALTER TABLE authz.platform_protected_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.platform_protected_roles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON authz.platform_protected_roles FROM PUBLIC;

CREATE TABLE authz.platform_role_assignment_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  role_key text NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('active','suspended','revoked')),
  reason_code text NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_platform_role_transition_assignment FOREIGN KEY (identity_id,role_key) REFERENCES authz.platform_role_assignments(identity_id,role_key),
  CONSTRAINT ck_platform_role_transition_from_status CHECK (from_status IS NULL OR from_status IN ('active','suspended','revoked')),
  CONSTRAINT ck_platform_role_transition_actual_change CHECK (from_status IS DISTINCT FROM to_status)
);
CREATE INDEX idx_platform_role_transitions_identity_created ON authz.platform_role_assignment_transitions(identity_id,created_at DESC);
CREATE INDEX idx_platform_role_transitions_role_created ON authz.platform_role_assignment_transitions(role_key,created_at DESC);
ALTER TABLE authz.platform_role_assignment_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.platform_role_assignment_transitions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON authz.platform_role_assignment_transitions FROM PUBLIC;

CREATE TABLE authz.platform_role_lifecycle_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  action_key text NOT NULL CHECK (action_key IN ('assign','suspend','reactivate','revoke')),
  target_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  role_key text NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_platform_role_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_platform_role_idempotency_role_key CHECK (role_key ~ '^[a-z][a-z0-9._:-]{2,63}$'),
  CONSTRAINT ck_platform_role_idempotency_completed CHECK (status <> 'completed' OR (result IS NOT NULL AND completed_at IS NOT NULL))
);
ALTER TABLE authz.platform_role_lifecycle_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.platform_role_lifecycle_idempotency FORCE ROW LEVEL SECURITY;
REVOKE ALL ON authz.platform_role_lifecycle_idempotency FROM PUBLIC;

INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES
  ('platform.principals.read','Read safe platform principal projections','high'),
  ('platform.roles.read','Read platform role catalog and assignment summaries','high'),
  ('platform.roles.assign','Assign or re-grant a platform role','critical'),
  ('platform.roles.suspend','Suspend a platform role assignment','critical'),
  ('platform.roles.reactivate','Reactivate a suspended platform role assignment','critical'),
  ('platform.roles.revoke','Revoke a platform role assignment','critical')
ON CONFLICT (permission_key) DO NOTHING;

-- Invocation roles never mutate platform authority tables directly.
REVOKE INSERT,UPDATE,DELETE ON authz.platform_role_assignments FROM airen_app;
REVOKE INSERT,UPDATE,DELETE ON authz.platform_role_assignments FROM airen_control_plane;

GRANT SELECT ON identity.identities TO airen_control_plane_owner;
GRANT SELECT ON authz.role_permission_grants,authz.permission_registry TO airen_control_plane_owner;
GRANT SELECT,INSERT,UPDATE ON authz.platform_role_assignments TO airen_control_plane_owner;
GRANT SELECT ON authz.platform_protected_roles TO airen_control_plane_owner;
GRANT SELECT,INSERT ON authz.platform_role_assignment_transitions TO airen_control_plane_owner;
GRANT SELECT,INSERT,UPDATE ON authz.platform_role_lifecycle_idempotency TO airen_control_plane_owner;
GRANT INSERT ON audit.audit_events,events.outbox_events TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.platform_mutate_role_assignment(
  p_action text,
  p_idempotency_key text,
  p_target_identity_id uuid,
  p_role_key text,
  p_reason_code text
)
RETURNS TABLE(
  action_key text,
  target_identity_id uuid,
  role_key text,
  assignment_status text,
  assignment_created_at timestamptz,
  assignment_updated_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
  v_permission text;
  v_target_identity_status text;
  v_current_status text;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_from_status text;
  v_reason text;
  v_protected_min integer;
  v_is_protected boolean := false;
  v_active_count integer;
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('assign','suspend','reactivate','revoke') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:action' USING ERRCODE='22023'; END IF;
  IF p_target_identity_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:target_identity_id' USING ERRCODE='22023'; END IF;
  IF p_role_key IS NULL OR p_role_key <> lower(btrim(p_role_key)) OR p_role_key !~ '^[a-z][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:role_key' USING ERRCODE='22023'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_action IN ('suspend','revoke') AND (p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;

  v_permission := CASE p_action
    WHEN 'assign' THEN 'platform.roles.assign'
    WHEN 'suspend' THEN 'platform.roles.suspend'
    WHEN 'reactivate' THEN 'platform.roles.reactivate'
    ELSE 'platform.roles.revoke'
  END;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key=v_permission AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;

  SELECT i.status INTO v_target_identity_status FROM identity.identities i WHERE i.id=p_target_identity_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PRINCIPAL_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_action IN ('assign','reactivate') AND v_target_identity_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PRINCIPAL_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM authz.role_permission_grants rpg
    WHERE rpg.scope_kind='platform' AND rpg.role_key=p_role_key AND rpg.effect='allow'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_ROLE_UNDEFINED' USING ERRCODE='P0002'; END IF;

  SELECT ppr.minimum_active_assignments INTO v_protected_min FROM authz.platform_protected_roles ppr WHERE ppr.role_key=p_role_key;
  v_is_protected := FOUND;

  IF p_action IN ('assign','reactivate') AND p_target_identity_id=v_actor THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_SELF_AUTHORITY_GAIN_DENIED' USING ERRCODE='42501';
  END IF;

  IF v_is_protected THEN
    IF NOT EXISTS (SELECT 1 FROM authz.platform_role_assignments pra WHERE pra.identity_id=v_actor AND pra.role_key=p_role_key AND pra.status='active') THEN
      RAISE EXCEPTION 'AIRENOS_PROTECTED_ROLE_PEER_REQUIRED' USING ERRCODE='42501';
    END IF;
    IF p_action IN ('suspend','revoke') AND p_target_identity_id=v_actor THEN
      RAISE EXCEPTION 'AIRENOS_PROTECTED_ROLE_SELF_MUTATION_DENIED' USING ERRCODE='42501';
    END IF;
  END IF;

  v_request_hash := encode(public.digest(jsonb_build_object('action',p_action,'targetIdentityId',p_target_identity_id,'roleKey',p_role_key,'reasonCode',p_reason_code)::text,'sha256'),'hex');
  INSERT INTO authz.platform_role_lifecycle_idempotency(idempotency_key,request_hash,action_key,target_identity_id,role_key,actor_identity_id)
  VALUES(p_idempotency_key,v_request_hash,p_action,p_target_identity_id,p_role_key,v_actor)
  ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result
  FROM authz.platform_role_lifecycle_idempotency i WHERE i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT p_action,(v_existing_result->>'identityId')::uuid,v_existing_result->>'roleKey',v_existing_result->>'status',(v_existing_result->>'createdAt')::timestamptz,(v_existing_result->>'updatedAt')::timestamptz,true;
    RETURN;
  END IF;

  SELECT pra.status,pra.created_at,pra.updated_at INTO v_current_status,v_created_at,v_updated_at
  FROM authz.platform_role_assignments pra WHERE pra.identity_id=p_target_identity_id AND pra.role_key=p_role_key FOR UPDATE;
  v_from_status := v_current_status;

  IF p_action='assign' THEN
    IF v_current_status IS NULL THEN
      INSERT INTO authz.platform_role_assignments(identity_id,role_key,status,updated_at)
      VALUES(p_target_identity_id,p_role_key,'active',now())
      RETURNING status,created_at,updated_at INTO v_current_status,v_created_at,v_updated_at;
      v_reason := COALESCE(p_reason_code,'role.assigned');
    ELSIF v_current_status='revoked' THEN
      UPDATE authz.platform_role_assignments SET status='active',updated_at=now()
      WHERE identity_id=p_target_identity_id AND role_key=p_role_key
      RETURNING status,created_at,updated_at INTO v_current_status,v_created_at,v_updated_at;
      v_reason := COALESCE(p_reason_code,'role.regranted');
    ELSE
      RAISE EXCEPTION 'AIRENOS_INVALID_PLATFORM_ROLE_STATE:assign' USING ERRCODE='P0001';
    END IF;
  ELSIF p_action='suspend' THEN
    IF v_current_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'AIRENOS_INVALID_PLATFORM_ROLE_STATE:suspend' USING ERRCODE='P0001'; END IF;
    IF v_is_protected THEN
      PERFORM 1 FROM authz.platform_role_assignments pra WHERE pra.role_key=p_role_key FOR UPDATE;
      SELECT count(*) INTO v_active_count FROM authz.platform_role_assignments pra WHERE pra.role_key=p_role_key AND pra.status='active';
      IF v_active_count-1 < v_protected_min THEN RAISE EXCEPTION 'AIRENOS_PROTECTED_ROLE_MINIMUM_ACTIVE' USING ERRCODE='P0001'; END IF;
    END IF;
    UPDATE authz.platform_role_assignments SET status='suspended',updated_at=now()
    WHERE identity_id=p_target_identity_id AND role_key=p_role_key
    RETURNING status,created_at,updated_at INTO v_current_status,v_created_at,v_updated_at;
    v_reason := p_reason_code;
  ELSIF p_action='reactivate' THEN
    IF v_current_status IS DISTINCT FROM 'suspended' THEN RAISE EXCEPTION 'AIRENOS_INVALID_PLATFORM_ROLE_STATE:reactivate' USING ERRCODE='P0001'; END IF;
    UPDATE authz.platform_role_assignments SET status='active',updated_at=now()
    WHERE identity_id=p_target_identity_id AND role_key=p_role_key
    RETURNING status,created_at,updated_at INTO v_current_status,v_created_at,v_updated_at;
    v_reason := COALESCE(p_reason_code,'role.reactivated');
  ELSE
    IF v_current_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'AIRENOS_INVALID_PLATFORM_ROLE_STATE:revoke' USING ERRCODE='P0001'; END IF;
    IF v_is_protected AND v_current_status='active' THEN
      PERFORM 1 FROM authz.platform_role_assignments pra WHERE pra.role_key=p_role_key FOR UPDATE;
      SELECT count(*) INTO v_active_count FROM authz.platform_role_assignments pra WHERE pra.role_key=p_role_key AND pra.status='active';
      IF v_active_count-1 < v_protected_min THEN RAISE EXCEPTION 'AIRENOS_PROTECTED_ROLE_MINIMUM_ACTIVE' USING ERRCODE='P0001'; END IF;
    END IF;
    UPDATE authz.platform_role_assignments SET status='revoked',updated_at=now()
    WHERE identity_id=p_target_identity_id AND role_key=p_role_key
    RETURNING status,created_at,updated_at INTO v_current_status,v_created_at,v_updated_at;
    v_reason := p_reason_code;
  END IF;

  INSERT INTO authz.platform_role_assignment_transitions(identity_id,role_key,from_status,to_status,reason_code,actor_identity_id,correlation_id)
  VALUES(p_target_identity_id,p_role_key,v_from_status,v_current_status,v_reason,v_actor,v_correlation);
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(NULL,NULL,v_actor,'user','platform.role_assignment.'||p_action,'PlatformRoleAssignment',p_target_identity_id::text||':'||p_role_key,v_correlation,'success',
    jsonb_build_object('targetIdentityId',p_target_identity_id,'roleKey',p_role_key,'fromStatus',v_from_status,'status',v_current_status,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(NULL,NULL,'platform.role_assignment.'||p_action,'PlatformRoleAssignment',p_target_identity_id::text||':'||p_role_key,1,
    jsonb_build_object('targetIdentityId',p_target_identity_id,'roleKey',p_role_key,'fromStatus',v_from_status,'status',v_current_status,'reasonCode',v_reason),v_correlation);

  v_result := jsonb_build_object('identityId',p_target_identity_id,'roleKey',p_role_key,'status',v_current_status,'createdAt',v_created_at,'updatedAt',v_updated_at);
  UPDATE authz.platform_role_lifecycle_idempotency SET status='completed',result=v_result,completed_at=now() WHERE idempotency_key=p_idempotency_key;
  RETURN QUERY SELECT p_action,p_target_identity_id,p_role_key,v_current_status,v_created_at,v_updated_at,false;
END;
$$;
ALTER FUNCTION security.platform_mutate_role_assignment(text,text,uuid,text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_role_assignment(text,text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_role_assignment(text,text,uuid,text,text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_get_principal(p_identity_id uuid)
RETURNS TABLE(identity_id uuid,display_name text,primary_email text,identity_status text,role_assignments jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.principals.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT i.id,i.display_name,i.primary_email,i.status,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('identityId',pra.identity_id,'roleKey',pra.role_key,'status',pra.status,'createdAt',pra.created_at,'updatedAt',pra.updated_at) ORDER BY pra.role_key) FROM authz.platform_role_assignments pra WHERE pra.identity_id=i.id),'[]'::jsonb)
  FROM identity.identities i WHERE i.id=p_identity_id;
END; $$;
ALTER FUNCTION security.platform_get_principal(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_principal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_principal(uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_principals(p_active_role_key text,p_after_identity_id uuid,p_limit integer)
RETURNS TABLE(identity_id uuid,display_name text,primary_email text,identity_status text,role_assignments jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.principals.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  IF p_active_role_key IS NOT NULL AND p_active_role_key !~ '^[a-z][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:role_filter' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT i.id,i.display_name,i.primary_email,i.status,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('identityId',pra.identity_id,'roleKey',pra.role_key,'status',pra.status,'createdAt',pra.created_at,'updatedAt',pra.updated_at) ORDER BY pra.role_key) FROM authz.platform_role_assignments pra WHERE pra.identity_id=i.id),'[]'::jsonb)
  FROM identity.identities i
  WHERE (p_after_identity_id IS NULL OR i.id>p_after_identity_id)
    AND (p_active_role_key IS NULL OR EXISTS (SELECT 1 FROM authz.platform_role_assignments f WHERE f.identity_id=i.id AND f.role_key=p_active_role_key AND f.status='active'))
  ORDER BY i.id ASC LIMIT p_limit;
END; $$;
ALTER FUNCTION security.platform_list_principals(text,uuid,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_principals(text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_principals(text,uuid,integer) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_roles(p_after_role_key text,p_limit integer)
RETURNS TABLE(role_key text,permission_keys text[],is_protected boolean,minimum_active_assignments integer,active_assignment_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.roles.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT roles.role_key,
    roles.permission_keys,
    (ppr.role_key IS NOT NULL),
    COALESCE(ppr.minimum_active_assignments,0),
    (SELECT count(*)::integer FROM authz.platform_role_assignments pra WHERE pra.role_key=roles.role_key AND pra.status='active')
  FROM (
    SELECT rpg.role_key,array_agg(DISTINCT rpg.permission_key ORDER BY rpg.permission_key) AS permission_keys
    FROM authz.role_permission_grants rpg
    WHERE rpg.scope_kind='platform' AND rpg.effect='allow'
    GROUP BY rpg.role_key
  ) roles
  LEFT JOIN authz.platform_protected_roles ppr ON ppr.role_key=roles.role_key
  WHERE p_after_role_key IS NULL OR roles.role_key>p_after_role_key
  ORDER BY roles.role_key ASC LIMIT p_limit;
END; $$;
ALTER FUNCTION security.platform_list_roles(text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_roles(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_roles(text,integer) TO airen_control_plane;

COMMIT;
