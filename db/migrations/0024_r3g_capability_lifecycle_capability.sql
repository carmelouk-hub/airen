-- R3-G / 0024 Governed Capability catalog lifecycle
BEGIN;

CREATE OR REPLACE FUNCTION security.platform_mutate_capability(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_action text := p_payload->>'action';
  v_key text := p_payload->>'capabilityKey';
  v_idem text := p_payload->>'idempotencyKey';
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_corr text := NULLIF(current_setting('airen.correlation_id',true),'');
  v_permission text;
  v_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_entitlements text[];
  v_permissions text[];
  v_reason text := COALESCE(NULLIF(p_payload->>'reasonCode',''),'platform.change');
  v_row platform.capability_catalog%ROWTYPE;
  v_result jsonb;
  v_event text;
BEGIN
  IF v_action NOT IN ('create','update','activate','retire') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:capability_action' USING ERRCODE='22023'; END IF;
  IF v_idem IS NULL OR v_idem <> btrim(v_idem) OR char_length(v_idem) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF v_key IS NULL OR v_key <> lower(btrim(v_key)) OR v_key !~ '^[a-z][a-z0-9._:-]{2,127}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:capability_key' USING ERRCODE='22023'; END IF;
  IF v_reason !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;

  v_permission := CASE v_action WHEN 'create' THEN 'platform.capabilities.create' WHEN 'update' THEN 'platform.capabilities.update' WHEN 'activate' THEN 'platform.capabilities.activate' ELSE 'platform.capabilities.retire' END;
  PERFORM security.r3g_assert_platform_permission(v_permission);

  v_hash := encode(public.digest(p_payload::text,'sha256'),'hex');
  INSERT INTO platform.capability_idempotency(idempotency_key,request_hash,action_key,resource_kind,resource_key,actor_identity_id)
  VALUES(v_idem,v_hash,v_action,'capability',v_key,v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result FROM platform.capability_idempotency i WHERE i.idempotency_key=v_idem FOR UPDATE;
  IF v_existing_hash <> v_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN RETURN jsonb_build_object('resource',v_existing_result,'replayed',true); END IF;

  IF v_action IN ('create','update') THEN
    IF NULLIF(btrim(p_payload->>'name'),'') IS NULL OR char_length(btrim(p_payload->>'name'))>160 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:capability_name' USING ERRCODE='22023'; END IF;
    IF (p_payload->>'scopeKind') NOT IN ('tenant','location') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:scope_kind' USING ERRCODE='22023'; END IF;
    IF COALESCE(p_payload->>'auditLevel','standard') NOT IN ('standard','elevated','critical') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:audit_level' USING ERRCODE='22023'; END IF;
    IF COALESCE(p_payload->>'aiAccessMode','none') NOT IN ('none','read','propose','governed_write') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:ai_access_mode' USING ERRCODE='22023'; END IF;
    IF p_payload ? 'description' AND p_payload->>'description' IS NOT NULL AND char_length(p_payload->>'description')>2000 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:description' USING ERRCODE='22023'; END IF;
    IF jsonb_typeof(COALESCE(p_payload->'requiredEntitlements','[]'::jsonb)) <> 'array' OR jsonb_typeof(COALESCE(p_payload->'requiredPermissions','[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:requirements' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),ARRAY[]::text[]) INTO v_entitlements FROM jsonb_array_elements_text(COALESCE(p_payload->'requiredEntitlements','[]'::jsonb)) t(x);
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),ARRAY[]::text[]) INTO v_permissions FROM jsonb_array_elements_text(COALESCE(p_payload->'requiredPermissions','[]'::jsonb)) t(x);
    IF EXISTS(SELECT 1 FROM unnest(v_entitlements) x WHERE x !~ '^[a-z][a-z0-9._:-]{2,127}$') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:required_entitlements' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(v_permissions) x WHERE x !~ '^[a-z][a-z0-9._:-]{2,127}$') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:required_permissions' USING ERRCODE='22023'; END IF;
    IF NULLIF(p_payload->>'featureFlagKey','') IS NOT NULL AND (p_payload->>'featureFlagKey' <> lower(btrim(p_payload->>'featureFlagKey')) OR p_payload->>'featureFlagKey' !~ '^[a-z][a-z0-9._:-]{2,127}$') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:feature_flag_key' USING ERRCODE='22023'; END IF;
  END IF;

  IF v_action='create' THEN
    INSERT INTO platform.capability_catalog(capability_key,name,description,status,scope_kind,required_entitlements,required_permissions,feature_flag_key,audit_level,ai_access_mode)
    VALUES(v_key,btrim(p_payload->>'name'),NULLIF(p_payload->>'description',''),'draft',p_payload->>'scopeKind',v_entitlements,v_permissions,NULLIF(p_payload->>'featureFlagKey',''),COALESCE(p_payload->>'auditLevel','standard'),COALESCE(p_payload->>'aiAccessMode','none'))
    RETURNING * INTO v_row;
    v_event:='capability_created';
  ELSIF v_action='update' THEN
    SELECT * INTO v_row FROM platform.capability_catalog c WHERE c.capability_key=v_key FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_CAPABILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF v_row.status<>'draft' THEN RAISE EXCEPTION 'AIRENOS_CAPABILITY_ACTIVE_SEMANTICS_IMMUTABLE' USING ERRCODE='P0001'; END IF;
    UPDATE platform.capability_catalog c SET name=btrim(p_payload->>'name'),description=NULLIF(p_payload->>'description',''),scope_kind=p_payload->>'scopeKind',required_entitlements=v_entitlements,required_permissions=v_permissions,feature_flag_key=NULLIF(p_payload->>'featureFlagKey',''),audit_level=COALESCE(p_payload->>'auditLevel','standard'),ai_access_mode=COALESCE(p_payload->>'aiAccessMode','none'),updated_at=now() WHERE c.id=v_row.id RETURNING * INTO v_row;
    v_event:='capability_updated';
  ELSIF v_action='activate' THEN
    SELECT * INTO v_row FROM platform.capability_catalog c WHERE c.capability_key=v_key FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_CAPABILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF v_row.status<>'draft' THEN RAISE EXCEPTION 'AIRENOS_INVALID_CAPABILITY_STATE' USING ERRCODE='P0001'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(v_row.required_entitlements) req WHERE NOT EXISTS(SELECT 1 FROM billing.entitlement_catalog e WHERE e.entitlement_key=req AND e.status='active')) THEN RAISE EXCEPTION 'AIRENOS_CAPABILITY_ENTITLEMENT_REQUIREMENT_INVALID' USING ERRCODE='P0001'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(v_row.required_permissions) req WHERE NOT EXISTS(SELECT 1 FROM authz.permission_registry p WHERE p.permission_key=req)) THEN RAISE EXCEPTION 'AIRENOS_CAPABILITY_PERMISSION_REQUIREMENT_INVALID' USING ERRCODE='P0001'; END IF;
    IF v_row.feature_flag_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform.feature_flags f WHERE f.feature_flag_key=v_row.feature_flag_key AND f.status='active') THEN RAISE EXCEPTION 'AIRENOS_CAPABILITY_FEATURE_FLAG_INVALID' USING ERRCODE='P0001'; END IF;
    UPDATE platform.capability_catalog c SET status='active',activated_at=now(),updated_at=now() WHERE c.id=v_row.id RETURNING * INTO v_row;
    v_event:='capability_activated';
  ELSE
    SELECT * INTO v_row FROM platform.capability_catalog c WHERE c.capability_key=v_key FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_CAPABILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF v_row.status<>'active' THEN RAISE EXCEPTION 'AIRENOS_INVALID_CAPABILITY_STATE' USING ERRCODE='P0001'; END IF;
    UPDATE platform.capability_catalog c SET status='retired',retired_at=now(),updated_at=now() WHERE c.id=v_row.id RETURNING * INTO v_row;
    v_event:='capability_retired';
  END IF;

  v_result:=jsonb_build_object('id',v_row.id,'capabilityKey',v_row.capability_key,'name',v_row.name,'description',v_row.description,'status',v_row.status,'scopeKind',v_row.scope_kind,'requiredEntitlements',to_jsonb(v_row.required_entitlements),'requiredPermissions',to_jsonb(v_row.required_permissions),'featureFlagKey',v_row.feature_flag_key,'auditLevel',v_row.audit_level,'aiAccessMode',v_row.ai_access_mode,'createdAt',v_row.created_at,'updatedAt',v_row.updated_at,'activatedAt',v_row.activated_at,'retiredAt',v_row.retired_at);

  INSERT INTO platform.capability_events(resource_kind,resource_key,event_type,actor_identity_id,reason_code,correlation_id,metadata)
  VALUES('capability',v_key,v_event,v_actor,v_reason,v_corr,jsonb_build_object('status',v_row.status,'scopeKind',v_row.scope_kind,'requiredEntitlements',v_row.required_entitlements,'requiredPermissions',v_row.required_permissions,'featureFlagKey',v_row.feature_flag_key));
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(NULL,NULL,v_actor,'identity','capability.'||v_action,'Capability',v_key,v_corr,'success',jsonb_build_object('status',v_row.status,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(NULL,NULL,'capability.'||replace(v_action,'_','.'),'Capability',v_key,1,jsonb_build_object('capabilityKey',v_key,'status',v_row.status,'scopeKind',v_row.scope_kind,'reasonCode',v_reason),v_corr);

  UPDATE platform.capability_idempotency i SET status='completed',result=v_result,completed_at=now() WHERE i.idempotency_key=v_idem;
  RETURN jsonb_build_object('resource',v_result,'replayed',false);
END;
$$;
ALTER FUNCTION security.platform_mutate_capability(jsonb) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_capability(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_capability(jsonb) TO airen_control_plane;

COMMIT;
