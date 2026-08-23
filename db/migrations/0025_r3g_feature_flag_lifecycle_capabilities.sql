-- R3-G / 0025 Governed Feature Flag and override lifecycle capabilities
BEGIN;

CREATE OR REPLACE FUNCTION security.platform_mutate_feature_flag(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_action text := p_payload->>'action';
  v_key text := p_payload->>'featureFlagKey';
  v_idem text := p_payload->>'idempotencyKey';
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_corr text := NULLIF(current_setting('airen.correlation_id',true),'');
  v_permission text;
  v_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_reason text := COALESCE(NULLIF(p_payload->>'reasonCode',''),'platform.change');
  v_from timestamptz := NULLIF(p_payload->>'validFrom','')::timestamptz;
  v_until timestamptz := NULLIF(p_payload->>'validUntil','')::timestamptz;
  v_row platform.feature_flags%ROWTYPE;
  v_result jsonb;
  v_event text;
BEGIN
  IF v_action NOT IN ('create','update','set_default','retire') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:feature_flag_action' USING ERRCODE='22023'; END IF;
  IF v_idem IS NULL OR v_idem<>btrim(v_idem) OR char_length(v_idem) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF v_key IS NULL OR v_key<>lower(btrim(v_key)) OR v_key !~ '^[a-z][a-z0-9._:-]{2,127}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:feature_flag_key' USING ERRCODE='22023'; END IF;
  IF v_reason !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;
  IF v_from IS NOT NULL AND v_until IS NOT NULL AND v_until<=v_from THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:feature_window' USING ERRCODE='22023'; END IF;
  IF p_payload ? 'description' AND p_payload->>'description' IS NOT NULL AND char_length(p_payload->>'description')>2000 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:description' USING ERRCODE='22023'; END IF;
  IF v_action IN ('create','set_default') AND jsonb_typeof(p_payload->'enabledDefault')<>'boolean' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:enabled_default' USING ERRCODE='22023'; END IF;
  IF v_action='update' AND p_payload ? 'enabledDefault' THEN RAISE EXCEPTION 'AIRENOS_FEATURE_DEFAULT_REQUIRES_EXPLICIT_ACTION' USING ERRCODE='P0001'; END IF;

  v_permission:=CASE v_action WHEN 'create' THEN 'platform.feature_flags.create' WHEN 'update' THEN 'platform.feature_flags.update' WHEN 'set_default' THEN 'platform.feature_flags.set_default' ELSE 'platform.feature_flags.retire' END;
  PERFORM security.r3g_assert_platform_permission(v_permission);

  v_hash:=encode(public.digest(p_payload::text,'sha256'),'hex');
  INSERT INTO platform.capability_idempotency(idempotency_key,request_hash,action_key,resource_kind,resource_key,actor_identity_id)
  VALUES(v_idem,v_hash,v_action,'feature_flag',v_key,v_actor) ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result FROM platform.capability_idempotency i WHERE i.idempotency_key=v_idem FOR UPDATE;
  IF v_existing_hash<>v_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN RETURN jsonb_build_object('resource',v_existing_result,'replayed',true); END IF;

  IF v_action='create' THEN
    INSERT INTO platform.feature_flags(feature_flag_key,description,status,enabled_default,valid_from,valid_until)
    VALUES(v_key,NULLIF(p_payload->>'description',''),'active',(p_payload->>'enabledDefault')::boolean,v_from,v_until) RETURNING * INTO v_row;
    v_event:='feature_flag_created';
  ELSE
    SELECT * INTO v_row FROM platform.feature_flags f WHERE f.feature_flag_key=v_key FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_FEATURE_FLAG_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF v_row.status<>'active' THEN RAISE EXCEPTION 'AIRENOS_INVALID_FEATURE_FLAG_STATE' USING ERRCODE='P0001'; END IF;
    IF v_action='update' THEN
      UPDATE platform.feature_flags f SET description=NULLIF(p_payload->>'description',''),valid_from=v_from,valid_until=v_until,updated_at=now() WHERE f.id=v_row.id RETURNING * INTO v_row;
      v_event:='feature_flag_updated';
    ELSIF v_action='set_default' THEN
      UPDATE platform.feature_flags f SET enabled_default=(p_payload->>'enabledDefault')::boolean,updated_at=now() WHERE f.id=v_row.id RETURNING * INTO v_row;
      v_event:='feature_flag_default_changed';
    ELSE
      UPDATE platform.feature_flags f SET status='retired',retired_at=now(),updated_at=now() WHERE f.id=v_row.id RETURNING * INTO v_row;
      v_event:='feature_flag_retired';
    END IF;
  END IF;

  v_result:=jsonb_build_object('id',v_row.id,'featureFlagKey',v_row.feature_flag_key,'description',v_row.description,'status',v_row.status,'enabledDefault',v_row.enabled_default,'validFrom',v_row.valid_from,'validUntil',v_row.valid_until,'createdAt',v_row.created_at,'updatedAt',v_row.updated_at,'retiredAt',v_row.retired_at);
  INSERT INTO platform.capability_events(resource_kind,resource_key,event_type,actor_identity_id,reason_code,correlation_id,metadata)
  VALUES('feature_flag',v_key,v_event,v_actor,v_reason,v_corr,jsonb_build_object('status',v_row.status,'enabledDefault',v_row.enabled_default,'validFrom',v_row.valid_from,'validUntil',v_row.valid_until));
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(NULL,NULL,v_actor,'identity','feature_flag.'||v_action,'FeatureFlag',v_key,v_corr,'success',jsonb_build_object('status',v_row.status,'enabledDefault',v_row.enabled_default,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(NULL,NULL,'feature_flag.'||replace(v_action,'_','.'),'FeatureFlag',v_key,1,jsonb_build_object('featureFlagKey',v_key,'status',v_row.status,'enabledDefault',v_row.enabled_default,'reasonCode',v_reason),v_corr);
  UPDATE platform.capability_idempotency i SET status='completed',result=v_result,completed_at=now() WHERE i.idempotency_key=v_idem;
  RETURN jsonb_build_object('resource',v_result,'replayed',false);
END;
$$;
ALTER FUNCTION security.platform_mutate_feature_flag(jsonb) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_feature_flag(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_feature_flag(jsonb) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_mutate_feature_flag_override(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_action text := p_payload->>'action';
  v_key text := p_payload->>'featureFlagKey';
  v_idem text := p_payload->>'idempotencyKey';
  v_subject text := p_payload->>'subjectKind';
  v_tenant uuid := NULLIF(p_payload->>'tenantId','')::uuid;
  v_location uuid := NULLIF(p_payload->>'locationId','')::uuid;
  v_enabled boolean;
  v_from timestamptz := NULLIF(p_payload->>'validFrom','')::timestamptz;
  v_until timestamptz := NULLIF(p_payload->>'validUntil','')::timestamptz;
  v_reason text := NULLIF(p_payload->>'reasonCode','');
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_corr text := NULLIF(current_setting('airen.correlation_id',true),'');
  v_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_flag platform.feature_flags%ROWTYPE;
  v_row platform.feature_flag_overrides%ROWTYPE;
  v_result jsonb;
  v_resource_key text;
  v_event text;
BEGIN
  IF v_action NOT IN ('set_override','remove_override') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:override_action' USING ERRCODE='22023'; END IF;
  IF v_idem IS NULL OR v_idem<>btrim(v_idem) OR char_length(v_idem) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF v_key IS NULL OR v_key<>lower(btrim(v_key)) OR v_key !~ '^[a-z][a-z0-9._:-]{2,127}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:feature_flag_key' USING ERRCODE='22023'; END IF;
  IF v_subject NOT IN ('tenant','location') OR v_tenant IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:override_scope' USING ERRCODE='22023'; END IF;
  IF (v_subject='tenant' AND v_location IS NOT NULL) OR (v_subject='location' AND v_location IS NULL) THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:override_scope' USING ERRCODE='22023'; END IF;
  IF v_reason IS NULL OR v_reason !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;
  IF v_from IS NOT NULL AND v_until IS NOT NULL AND v_until<=v_from THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:override_window' USING ERRCODE='22023'; END IF;
  IF v_action='set_override' AND jsonb_typeof(p_payload->'enabled')<>'boolean' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:override_enabled' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM platform.tenants t WHERE t.id=v_tenant) THEN RAISE EXCEPTION 'AIRENOS_TENANT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_subject='location' AND NOT EXISTS(SELECT 1 FROM platform.locations l WHERE l.id=v_location AND l.tenant_id=v_tenant) THEN RAISE EXCEPTION 'AIRENOS_INVALID_OVERRIDE_LOCATION_SCOPE' USING ERRCODE='P0001'; END IF;

  PERFORM security.r3g_assert_platform_permission(CASE v_action WHEN 'set_override' THEN 'platform.feature_flags.set_override' ELSE 'platform.feature_flags.remove_override' END);
  SELECT * INTO v_flag FROM platform.feature_flags f WHERE f.feature_flag_key=v_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_FEATURE_FLAG_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_flag.status<>'active' THEN RAISE EXCEPTION 'AIRENOS_INVALID_FEATURE_FLAG_STATE' USING ERRCODE='P0001'; END IF;

  v_resource_key:=v_key||':'||v_subject||':'||v_tenant::text||':'||COALESCE(v_location::text,'');
  v_hash:=encode(public.digest(p_payload::text,'sha256'),'hex');
  INSERT INTO platform.capability_idempotency(idempotency_key,request_hash,action_key,resource_kind,resource_key,actor_identity_id)
  VALUES(v_idem,v_hash,v_action,'feature_flag_override',v_resource_key,v_actor) ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result FROM platform.capability_idempotency i WHERE i.idempotency_key=v_idem FOR UPDATE;
  IF v_existing_hash<>v_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN RETURN jsonb_build_object('resource',v_existing_result,'replayed',true); END IF;

  IF v_action='set_override' THEN
    v_enabled:=(p_payload->>'enabled')::boolean;
    SELECT * INTO v_row FROM platform.feature_flag_overrides o WHERE o.feature_flag_id=v_flag.id AND o.tenant_id=v_tenant AND o.status='active' AND o.subject_kind=v_subject AND ((v_subject='tenant' AND o.location_id IS NULL) OR (v_subject='location' AND o.location_id=v_location)) FOR UPDATE;
    IF FOUND THEN
      UPDATE platform.feature_flag_overrides o SET enabled=v_enabled,valid_from=v_from,valid_until=v_until,reason_code=v_reason,updated_at=now() WHERE o.id=v_row.id RETURNING * INTO v_row;
    ELSE
      INSERT INTO platform.feature_flag_overrides(feature_flag_id,subject_kind,tenant_id,location_id,enabled,valid_from,valid_until,reason_code,status)
      VALUES(v_flag.id,v_subject,v_tenant,v_location,v_enabled,v_from,v_until,v_reason,'active') RETURNING * INTO v_row;
    END IF;
    v_event:='feature_flag_override_set';
  ELSE
    SELECT * INTO v_row FROM platform.feature_flag_overrides o WHERE o.feature_flag_id=v_flag.id AND o.tenant_id=v_tenant AND o.status='active' AND o.subject_kind=v_subject AND ((v_subject='tenant' AND o.location_id IS NULL) OR (v_subject='location' AND o.location_id=v_location)) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_FEATURE_FLAG_OVERRIDE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    UPDATE platform.feature_flag_overrides o SET status='removed',removed_at=now(),updated_at=now(),reason_code=v_reason WHERE o.id=v_row.id RETURNING * INTO v_row;
    v_event:='feature_flag_override_removed';
  END IF;

  v_result:=jsonb_build_object('id',v_row.id,'featureFlagKey',v_key,'subjectKind',v_row.subject_kind,'tenantId',v_row.tenant_id,'locationId',v_row.location_id,'enabled',v_row.enabled,'validFrom',v_row.valid_from,'validUntil',v_row.valid_until,'reasonCode',v_row.reason_code,'status',v_row.status,'createdAt',v_row.created_at,'updatedAt',v_row.updated_at,'removedAt',v_row.removed_at);
  INSERT INTO platform.capability_events(resource_kind,resource_key,tenant_id,location_id,event_type,actor_identity_id,reason_code,correlation_id,metadata)
  VALUES('feature_flag_override',v_resource_key,v_tenant,v_location,v_event,v_actor,v_reason,v_corr,jsonb_build_object('featureFlagKey',v_key,'subjectKind',v_subject,'enabled',v_row.enabled,'status',v_row.status,'validFrom',v_row.valid_from,'validUntil',v_row.valid_until));
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(v_tenant,v_location,v_actor,'identity','feature_flag.'||v_action,'FeatureFlagOverride',v_resource_key,v_corr,'success',jsonb_build_object('featureFlagKey',v_key,'subjectKind',v_subject,'enabled',v_row.enabled,'status',v_row.status,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(v_tenant,v_location,'feature_flag.'||replace(v_action,'_','.'),'FeatureFlagOverride',v_resource_key,1,jsonb_build_object('featureFlagKey',v_key,'subjectKind',v_subject,'enabled',v_row.enabled,'status',v_row.status,'reasonCode',v_reason),v_corr);
  UPDATE platform.capability_idempotency i SET status='completed',result=v_result,completed_at=now() WHERE i.idempotency_key=v_idem;
  RETURN jsonb_build_object('resource',v_result,'replayed',false);
END;
$$;
ALTER FUNCTION security.platform_mutate_feature_flag_override(jsonb) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_feature_flag_override(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_feature_flag_override(jsonb) TO airen_control_plane;

COMMIT;
