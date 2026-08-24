-- R3-F / 0020 Governed Entitlement catalog lifecycle capability
BEGIN;

CREATE OR REPLACE FUNCTION security.platform_mutate_entitlement_catalog(
  p_action text,
  p_idempotency_key text,
  p_entitlement_key text,
  p_description text,
  p_reason_code text
)
RETURNS TABLE(
  result_action text,
  result_entitlement_key text,
  result_description text,
  result_status text,
  result_created_at timestamptz,
  result_updated_at timestamptz,
  result_retired_at timestamptz,
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
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_row billing.entitlement_catalog%ROWTYPE;
  v_reason text;
  v_event_type text;
  v_result jsonb;
BEGIN
  IF p_action NOT IN ('create','update','retire') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:entitlement_catalog_action' USING ERRCODE='22023'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_entitlement_key IS NULL OR p_entitlement_key <> lower(btrim(p_entitlement_key)) OR p_entitlement_key !~ '^[a-z][a-z0-9._:-]{2,127}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:entitlement_key' USING ERRCODE='22023'; END IF;
  IF p_description IS NOT NULL AND char_length(p_description)>2000 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:description' USING ERRCODE='22023'; END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;

  v_permission := CASE p_action
    WHEN 'create' THEN 'platform.entitlements.catalog.create'
    WHEN 'update' THEN 'platform.entitlements.catalog.update'
    ELSE 'platform.entitlements.catalog.retire'
  END;
  PERFORM security.r3f_assert_platform_permission(v_permission);

  v_request_hash := encode(public.digest(jsonb_build_object('action',p_action,'entitlementKey',p_entitlement_key,'description',p_description,'reasonCode',p_reason_code)::text,'sha256'),'hex');
  INSERT INTO billing.entitlement_lifecycle_idempotency(idempotency_key,request_hash,action_key,resource_kind,tenant_id,entitlement_key,actor_identity_id)
  VALUES(p_idempotency_key,v_request_hash,'entitlement.catalog.'||p_action,'catalog',NULL,p_entitlement_key,v_actor)
  ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result
  FROM billing.entitlement_lifecycle_idempotency i WHERE i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT p_action,v_existing_result->>'entitlementKey',NULLIF(v_existing_result->>'description',''),v_existing_result->>'status',
      (v_existing_result->>'createdAt')::timestamptz,(v_existing_result->>'updatedAt')::timestamptz,NULLIF(v_existing_result->>'retiredAt','')::timestamptz,true;
    RETURN;
  END IF;

  IF p_action='create' THEN
    INSERT INTO billing.entitlement_catalog(entitlement_key,description,status,updated_at)
    VALUES(p_entitlement_key,p_description,'active',now())
    RETURNING * INTO v_row;
    v_reason:=COALESCE(p_reason_code,'entitlement.catalog.created');
    v_event_type:='entitlement.catalog.created';
  ELSE
    SELECT e.* INTO v_row FROM billing.entitlement_catalog e WHERE e.entitlement_key=p_entitlement_key FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_ENTITLEMENT_CATALOG_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF v_row.status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_ENTITLEMENT_CATALOG_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;
    IF p_action='update' THEN
      UPDATE billing.entitlement_catalog AS e SET description=p_description,updated_at=now() WHERE e.entitlement_key=p_entitlement_key RETURNING e.* INTO v_row;
      v_reason:=COALESCE(p_reason_code,'entitlement.catalog.updated');
      v_event_type:='entitlement.catalog.updated';
    ELSE
      UPDATE billing.entitlement_catalog AS e SET status='retired',retired_at=now(),updated_at=now() WHERE e.entitlement_key=p_entitlement_key RETURNING e.* INTO v_row;
      v_reason:=COALESCE(p_reason_code,'entitlement.catalog.retired');
      v_event_type:='entitlement.catalog.retired';
    END IF;
  END IF;

  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(NULL,NULL,v_actor,'user','entitlement.catalog.'||p_action,'EntitlementCatalog',v_row.entitlement_key,v_correlation,'success',
    jsonb_build_object('entitlementKey',v_row.entitlement_key,'status',v_row.status,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(NULL,NULL,v_event_type,'EntitlementCatalog',v_row.entitlement_key,1,
    jsonb_build_object('entitlementKey',v_row.entitlement_key,'status',v_row.status,'reasonCode',v_reason),v_correlation);

  v_result:=jsonb_build_object('entitlementKey',v_row.entitlement_key,'description',COALESCE(v_row.description,''),'status',v_row.status,
    'createdAt',v_row.created_at,'updatedAt',v_row.updated_at,'retiredAt',COALESCE(v_row.retired_at::text,''));
  UPDATE billing.entitlement_lifecycle_idempotency AS i SET status='completed',result=v_result,completed_at=now() WHERE i.idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT p_action,v_row.entitlement_key,v_row.description,v_row.status,v_row.created_at,v_row.updated_at,v_row.retired_at,false;
END;
$$;
ALTER FUNCTION security.platform_mutate_entitlement_catalog(text,text,text,text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_entitlement_catalog(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_entitlement_catalog(text,text,text,text,text) TO airen_control_plane;

COMMIT;
