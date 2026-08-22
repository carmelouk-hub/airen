-- R3-D second correction after CI #365 / run 32591873828.
-- The prior correction resolved schema USAGE. The remaining failure was caused by
-- SELECT ... FOR SHARE on identity.identities, which requires locking authority
-- beyond the SELECT-only capability required by R3-D.
-- Security decision: preserve SELECT-only Identity access; do not grant UPDATE.
BEGIN;

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

  -- Identity lifecycle is outside R3-D. This is deliberately a non-locking read-only validation.
  SELECT i.status INTO v_target_identity_status FROM identity.identities i WHERE i.id=p_target_identity_id;
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
    IF v_current_status IS NULL OR v_current_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'AIRENOS_INVALID_PLATFORM_ROLE_STATE:revoke' USING ERRCODE='P0001'; END IF;
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

COMMIT;
