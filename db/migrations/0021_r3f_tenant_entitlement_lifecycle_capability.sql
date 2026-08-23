-- R3-F / 0021 Governed Tenant Entitlement lifecycle capability
BEGIN;

CREATE OR REPLACE FUNCTION security.platform_mutate_tenant_entitlement(
  p_action text,
  p_idempotency_key text,
  p_tenant_id uuid,
  p_entitlement_key text,
  p_source_kind text,
  p_source_ref text,
  p_limit_value numeric,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_config jsonb,
  p_reason_code text
)
RETURNS TABLE(
  result_action text,
  result_tenant_id uuid,
  result_entitlement_key text,
  result_source_kind text,
  result_source_ref text,
  result_enabled boolean,
  result_derived_state text,
  result_limit_value numeric,
  result_valid_from timestamptz,
  result_valid_until timestamptz,
  result_config jsonb,
  result_created_at timestamptz,
  result_updated_at timestamptz,
  result_revoked_at timestamptz,
  result_expired_at timestamptz,
  result_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
  v_permission text;
  v_tenant_status text;
  v_catalog_status text;
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_row billing.tenant_entitlements%ROWTYPE;
  v_found boolean := false;
  v_from_state text;
  v_to_state text;
  v_event_type text;
  v_reason text;
  v_effective_valid_from timestamptz;
  v_effective_valid_until timestamptz;
  v_result jsonb;
BEGIN
  IF p_action NOT IN ('grant','revoke','expire','change_limit','change_config','change_validity') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:entitlement_action' USING ERRCODE='22023'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:tenant_id' USING ERRCODE='22023'; END IF;
  IF p_entitlement_key IS NULL OR p_entitlement_key <> lower(btrim(p_entitlement_key)) OR p_entitlement_key !~ '^[a-z][a-z0-9._:-]{2,127}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:entitlement_key' USING ERRCODE='22023'; END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;

  v_permission := CASE p_action
    WHEN 'grant' THEN 'platform.entitlements.grant'
    WHEN 'revoke' THEN 'platform.entitlements.revoke'
    WHEN 'expire' THEN 'platform.entitlements.expire'
    WHEN 'change_limit' THEN 'platform.entitlements.change_limit'
    WHEN 'change_config' THEN 'platform.entitlements.change_config'
    ELSE 'platform.entitlements.change_validity'
  END;
  PERFORM security.r3f_assert_platform_permission(v_permission);

  SELECT t.status INTO v_tenant_status FROM platform.tenants t WHERE t.id=p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_TENANT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_action IN ('grant','change_limit','change_config','change_validity') AND v_tenant_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_TENANT_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;

  IF p_action='grant' THEN
    IF p_source_kind IS NULL OR p_source_kind <> lower(btrim(p_source_kind)) OR p_source_kind !~ '^[a-z0-9][a-z0-9._:-]{0,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:source_kind' USING ERRCODE='22023'; END IF;
    IF p_source_ref IS NOT NULL AND char_length(p_source_ref) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:source_ref' USING ERRCODE='22023'; END IF;
    IF p_limit_value IS NOT NULL AND p_limit_value < 0 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:limit_value' USING ERRCODE='22023'; END IF;
    IF p_config IS NOT NULL AND jsonb_typeof(p_config) <> 'object' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:config' USING ERRCODE='22023'; END IF;
    SELECT e.status INTO v_catalog_status FROM billing.entitlement_catalog e WHERE e.entitlement_key=p_entitlement_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_ENTITLEMENT_CATALOG_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF v_catalog_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_ENTITLEMENT_CATALOG_RETIRED' USING ERRCODE='P0001'; END IF;
    v_effective_valid_from := COALESCE(p_valid_from,now());
    v_effective_valid_until := p_valid_until;
    IF v_effective_valid_until IS NOT NULL AND (v_effective_valid_until <= v_effective_valid_from OR v_effective_valid_until <= now()) THEN RAISE EXCEPTION 'AIRENOS_INVALID_ENTITLEMENT_VALIDITY' USING ERRCODE='P0001'; END IF;
  ELSE
    IF p_source_kind IS NOT NULL OR p_source_ref IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_ENTITLEMENT_SOURCE_IMMUTABLE' USING ERRCODE='P0001'; END IF;
    IF p_action='change_limit' AND p_limit_value IS NOT NULL AND p_limit_value < 0 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:limit_value' USING ERRCODE='22023'; END IF;
    IF p_action='change_config' AND (p_config IS NULL OR jsonb_typeof(p_config) <> 'object') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:config' USING ERRCODE='22023'; END IF;
  END IF;

  v_request_hash := encode(public.digest(jsonb_build_object(
    'action',p_action,'tenantId',p_tenant_id,'entitlementKey',p_entitlement_key,'sourceKind',p_source_kind,'sourceRef',p_source_ref,
    'limitValue',p_limit_value,'validFrom',p_valid_from,'validUntil',p_valid_until,'config',p_config,'reasonCode',p_reason_code
  )::text,'sha256'),'hex');
  INSERT INTO billing.entitlement_lifecycle_idempotency(idempotency_key,request_hash,action_key,resource_kind,tenant_id,entitlement_key,actor_identity_id)
  VALUES(p_idempotency_key,v_request_hash,'entitlement.'||p_action,'tenant_entitlement',p_tenant_id,p_entitlement_key,v_actor)
  ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result
  FROM billing.entitlement_lifecycle_idempotency i WHERE i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT p_action,(v_existing_result->>'tenantId')::uuid,v_existing_result->>'entitlementKey',v_existing_result->>'sourceKind',NULLIF(v_existing_result->>'sourceRef',''),
      (v_existing_result->>'enabled')::boolean,v_existing_result->>'derivedState',NULLIF(v_existing_result->>'limitValue','')::numeric,
      NULLIF(v_existing_result->>'validFrom','')::timestamptz,NULLIF(v_existing_result->>'validUntil','')::timestamptz,COALESCE(v_existing_result->'config','{}'::jsonb),
      (v_existing_result->>'createdAt')::timestamptz,(v_existing_result->>'updatedAt')::timestamptz,
      NULLIF(v_existing_result->>'revokedAt','')::timestamptz,NULLIF(v_existing_result->>'expiredAt','')::timestamptz,true;
    RETURN;
  END IF;

  SELECT e.* INTO v_row FROM billing.tenant_entitlements e WHERE e.tenant_id=p_tenant_id AND e.entitlement_key=p_entitlement_key FOR UPDATE;
  v_found := FOUND;
  IF v_found THEN
    v_from_state := CASE
      WHEN NOT v_row.enabled AND v_row.expired_at IS NOT NULL THEN 'expired'
      WHEN NOT v_row.enabled AND v_row.revoked_at IS NOT NULL THEN 'revoked'
      WHEN NOT v_row.enabled THEN 'inactive'
      WHEN v_row.valid_from IS NOT NULL AND v_row.valid_from > now() THEN 'scheduled'
      WHEN v_row.valid_until IS NOT NULL AND v_row.valid_until <= now() THEN 'inactive'
      ELSE 'effective'
    END;
  ELSE
    v_from_state := NULL;
  END IF;

  IF p_action='grant' THEN
    IF v_found AND v_row.enabled THEN RAISE EXCEPTION 'AIRENOS_ENTITLEMENT_ALREADY_ACTIVE' USING ERRCODE='P0001'; END IF;
    IF NOT v_found THEN
      INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,source_ref,enabled,limit_value,valid_from,valid_until,config,created_at,updated_at,revoked_at,expired_at)
      VALUES(p_tenant_id,p_entitlement_key,p_source_kind,p_source_ref,true,p_limit_value,v_effective_valid_from,v_effective_valid_until,COALESCE(p_config,'{}'::jsonb),now(),now(),NULL,NULL)
      RETURNING * INTO v_row;
      v_event_type:='granted'; v_reason:=COALESCE(p_reason_code,'entitlement.granted');
    ELSE
      UPDATE billing.tenant_entitlements AS e
      SET source_kind=p_source_kind,source_ref=p_source_ref,enabled=true,limit_value=p_limit_value,valid_from=v_effective_valid_from,valid_until=v_effective_valid_until,
          config=COALESCE(p_config,'{}'::jsonb),updated_at=now(),revoked_at=NULL,expired_at=NULL
      WHERE e.tenant_id=p_tenant_id AND e.entitlement_key=p_entitlement_key RETURNING e.* INTO v_row;
      v_event_type:='regranted'; v_reason:=COALESCE(p_reason_code,'entitlement.regranted');
    END IF;
  ELSE
    IF NOT v_found THEN RAISE EXCEPTION 'AIRENOS_TENANT_ENTITLEMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF p_action='revoke' THEN
      IF NOT v_row.enabled THEN RAISE EXCEPTION 'AIRENOS_INVALID_ENTITLEMENT_STATE:revoke' USING ERRCODE='P0001'; END IF;
      UPDATE billing.tenant_entitlements AS e SET enabled=false,updated_at=now(),revoked_at=now(),expired_at=NULL
      WHERE e.tenant_id=p_tenant_id AND e.entitlement_key=p_entitlement_key RETURNING e.* INTO v_row;
      v_event_type:='revoked'; v_reason:=COALESCE(p_reason_code,'entitlement.revoked');
    ELSIF p_action='expire' THEN
      IF NOT v_row.enabled OR v_row.valid_until IS NULL OR v_row.valid_until > now() THEN RAISE EXCEPTION 'AIRENOS_ENTITLEMENT_EXPIRY_NOT_REACHED' USING ERRCODE='P0001'; END IF;
      UPDATE billing.tenant_entitlements AS e SET enabled=false,updated_at=now(),expired_at=now(),revoked_at=NULL
      WHERE e.tenant_id=p_tenant_id AND e.entitlement_key=p_entitlement_key RETURNING e.* INTO v_row;
      v_event_type:='expired'; v_reason:=COALESCE(p_reason_code,'entitlement.expired');
    ELSE
      IF NOT v_row.enabled OR (v_row.valid_until IS NOT NULL AND v_row.valid_until <= now()) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='AIRENOS_INVALID_ENTITLEMENT_STATE:'||p_action; END IF;
      IF p_action='change_limit' THEN
        UPDATE billing.tenant_entitlements AS e SET limit_value=p_limit_value,updated_at=now()
        WHERE e.tenant_id=p_tenant_id AND e.entitlement_key=p_entitlement_key RETURNING e.* INTO v_row;
        v_event_type:='limit_changed'; v_reason:=COALESCE(p_reason_code,'entitlement.limit_changed');
      ELSIF p_action='change_config' THEN
        UPDATE billing.tenant_entitlements AS e SET config=p_config,updated_at=now()
        WHERE e.tenant_id=p_tenant_id AND e.entitlement_key=p_entitlement_key RETURNING e.* INTO v_row;
        v_event_type:='config_changed'; v_reason:=COALESCE(p_reason_code,'entitlement.config_changed');
      ELSE
        v_effective_valid_from := COALESCE(p_valid_from,v_row.valid_from,now());
        v_effective_valid_until := COALESCE(p_valid_until,v_row.valid_until);
        IF v_effective_valid_until IS NOT NULL AND (v_effective_valid_until <= v_effective_valid_from OR v_effective_valid_until <= now()) THEN RAISE EXCEPTION 'AIRENOS_INVALID_ENTITLEMENT_VALIDITY' USING ERRCODE='P0001'; END IF;
        UPDATE billing.tenant_entitlements AS e SET valid_from=v_effective_valid_from,valid_until=v_effective_valid_until,updated_at=now()
        WHERE e.tenant_id=p_tenant_id AND e.entitlement_key=p_entitlement_key RETURNING e.* INTO v_row;
        v_event_type:='validity_changed'; v_reason:=COALESCE(p_reason_code,'entitlement.validity_changed');
      END IF;
    END IF;
  END IF;

  v_to_state := CASE
    WHEN NOT v_row.enabled AND v_row.expired_at IS NOT NULL THEN 'expired'
    WHEN NOT v_row.enabled AND v_row.revoked_at IS NOT NULL THEN 'revoked'
    WHEN NOT v_row.enabled THEN 'inactive'
    WHEN v_row.valid_from IS NOT NULL AND v_row.valid_from > now() THEN 'scheduled'
    WHEN v_row.valid_until IS NOT NULL AND v_row.valid_until <= now() THEN 'inactive'
    ELSE 'effective'
  END;

  INSERT INTO billing.entitlement_events(tenant_id,entitlement_key,event_type,from_state,to_state,effective_at,actor_identity_id,reason_code,correlation_id,metadata)
  VALUES(v_row.tenant_id,v_row.entitlement_key,v_event_type,v_from_state,v_to_state,now(),v_actor,v_reason,v_correlation,
    jsonb_build_object('sourceKind',v_row.source_kind,'sourceRef',v_row.source_ref,'limitValue',v_row.limit_value,'validFrom',v_row.valid_from,'validUntil',v_row.valid_until));
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(v_row.tenant_id,NULL,v_actor,'user','entitlement.'||p_action,'TenantEntitlement',v_row.tenant_id::text||':'||v_row.entitlement_key,v_correlation,'success',
    jsonb_build_object('entitlementKey',v_row.entitlement_key,'fromState',v_from_state,'state',v_to_state,'sourceKind',v_row.source_kind,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(v_row.tenant_id,NULL,'entitlement.'||v_event_type,'TenantEntitlement',v_row.tenant_id::text||':'||v_row.entitlement_key,1,
    jsonb_build_object('tenantId',v_row.tenant_id,'entitlementKey',v_row.entitlement_key,'fromState',v_from_state,'state',v_to_state,'limitValue',v_row.limit_value,'validFrom',v_row.valid_from,'validUntil',v_row.valid_until,'reasonCode',v_reason),v_correlation);

  v_result:=jsonb_build_object('tenantId',v_row.tenant_id,'entitlementKey',v_row.entitlement_key,'sourceKind',v_row.source_kind,'sourceRef',COALESCE(v_row.source_ref,''),
    'enabled',v_row.enabled,'derivedState',v_to_state,'limitValue',COALESCE(v_row.limit_value::text,''),'validFrom',COALESCE(v_row.valid_from::text,''),'validUntil',COALESCE(v_row.valid_until::text,''),
    'config',v_row.config,'createdAt',v_row.created_at,'updatedAt',v_row.updated_at,'revokedAt',COALESCE(v_row.revoked_at::text,''),'expiredAt',COALESCE(v_row.expired_at::text,''));
  UPDATE billing.entitlement_lifecycle_idempotency AS i SET status='completed',result=v_result,completed_at=now() WHERE i.idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT p_action,v_row.tenant_id,v_row.entitlement_key,v_row.source_kind,v_row.source_ref,v_row.enabled,v_to_state,v_row.limit_value,v_row.valid_from,v_row.valid_until,
    v_row.config,v_row.created_at,v_row.updated_at,v_row.revoked_at,v_row.expired_at,false;
END;
$$;
ALTER FUNCTION security.platform_mutate_tenant_entitlement(text,text,uuid,text,text,text,numeric,timestamptz,timestamptz,jsonb,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_tenant_entitlement(text,text,uuid,text,text,text,numeric,timestamptz,timestamptz,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_tenant_entitlement(text,text,uuid,text,text,text,numeric,timestamptz,timestamptz,jsonb,text) TO airen_control_plane;

COMMIT;