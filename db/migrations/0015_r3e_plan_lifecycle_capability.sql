-- R3-E / 0015 Governed Plan lifecycle capability
BEGIN;
CREATE OR REPLACE FUNCTION security.platform_mutate_plan(
  p_action text,
  p_idempotency_key text,
  p_plan_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_currency text,
  p_price_minor bigint,
  p_billing_period text,
  p_default_trial_days integer,
  p_reason_code text
)
RETURNS TABLE(
  result_action text,
  result_plan_id uuid,
  result_slug text,
  result_name text,
  result_description text,
  result_status text,
  result_currency text,
  result_price_minor bigint,
  result_billing_period text,
  result_default_trial_days integer,
  result_created_at timestamptz,
  result_updated_at timestamptz,
  result_activated_at timestamptz,
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
  v_plan billing.plans%ROWTYPE;
  v_reason text;
  v_event_type text;
  v_resource_id uuid;
  v_result jsonb;
BEGIN
  IF p_action NOT IN ('create','update','activate','retire') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:plan_action' USING ERRCODE='22023'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;

  v_permission := CASE p_action
    WHEN 'create' THEN 'platform.plans.create'
    WHEN 'update' THEN 'platform.plans.update'
    WHEN 'activate' THEN 'platform.plans.activate'
    ELSE 'platform.plans.retire'
  END;
  PERFORM security.r3e_assert_platform_permission(v_permission);

  IF p_action='create' THEN
    IF p_plan_id IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:create_plan_id' USING ERRCODE='22023'; END IF;
    IF p_slug IS NULL OR p_slug <> lower(btrim(p_slug)) OR p_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:plan_slug' USING ERRCODE='22023'; END IF;
    IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:plan_name' USING ERRCODE='22023'; END IF;
    IF p_description IS NOT NULL AND char_length(p_description)>2000 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:description' USING ERRCODE='22023'; END IF;
    IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:currency' USING ERRCODE='22023'; END IF;
    IF p_price_minor IS NULL OR p_price_minor<0 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:price_minor' USING ERRCODE='22023'; END IF;
    IF p_billing_period NOT IN ('monthly','annual') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:billing_period' USING ERRCODE='22023'; END IF;
    IF p_default_trial_days IS NULL OR p_default_trial_days NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:default_trial_days' USING ERRCODE='22023'; END IF;
  ELSE
    IF p_plan_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:plan_id' USING ERRCODE='22023'; END IF;
    IF p_action='update' THEN
      IF p_slug IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_PLAN_SLUG_IMMUTABLE' USING ERRCODE='P0001'; END IF;
      IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:plan_name' USING ERRCODE='22023'; END IF;
      IF p_description IS NOT NULL AND char_length(p_description)>2000 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:description' USING ERRCODE='22023'; END IF;
      IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:currency' USING ERRCODE='22023'; END IF;
      IF p_price_minor IS NULL OR p_price_minor<0 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:price_minor' USING ERRCODE='22023'; END IF;
      IF p_billing_period NOT IN ('monthly','annual') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:billing_period' USING ERRCODE='22023'; END IF;
      IF p_default_trial_days IS NULL OR p_default_trial_days NOT BETWEEN 0 AND 365 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:default_trial_days' USING ERRCODE='22023'; END IF;
    END IF;
  END IF;

  v_request_hash := encode(public.digest(jsonb_build_object(
    'action',p_action,'planId',p_plan_id,'slug',p_slug,'name',p_name,'description',p_description,'currency',p_currency,
    'priceMinor',p_price_minor,'billingPeriod',p_billing_period,'defaultTrialDays',p_default_trial_days,'reasonCode',p_reason_code
  )::text,'sha256'),'hex');

  INSERT INTO billing.lifecycle_idempotency(idempotency_key,request_hash,action_key,resource_kind,resource_id,actor_identity_id)
  VALUES(p_idempotency_key,v_request_hash,'plan.'||p_action,'plan',p_plan_id,v_actor)
  ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result
  FROM billing.lifecycle_idempotency i WHERE i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT p_action,
      (v_existing_result->>'id')::uuid,v_existing_result->>'slug',v_existing_result->>'name',NULLIF(v_existing_result->>'description',''),v_existing_result->>'status',
      v_existing_result->>'currency',(v_existing_result->>'priceMinor')::bigint,v_existing_result->>'billingPeriod',(v_existing_result->>'defaultTrialDays')::integer,
      (v_existing_result->>'createdAt')::timestamptz,(v_existing_result->>'updatedAt')::timestamptz,
      NULLIF(v_existing_result->>'activatedAt','')::timestamptz,NULLIF(v_existing_result->>'retiredAt','')::timestamptz,true;
    RETURN;
  END IF;

  IF p_action='create' THEN
    INSERT INTO billing.plans(slug,name,description,currency,price_minor,billing_period,default_trial_days)
    VALUES(p_slug,btrim(p_name),p_description,p_currency,p_price_minor,p_billing_period,p_default_trial_days)
    RETURNING * INTO v_plan;
    v_reason := COALESCE(p_reason_code,'plan.created');
    v_event_type := 'billing.plan.created';
  ELSE
    SELECT p.* INTO v_plan FROM billing.plans p WHERE p.id=p_plan_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_PLAN_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF p_action='update' THEN
      IF v_plan.status <> 'draft' THEN RAISE EXCEPTION 'AIRENOS_PLAN_REQUIRES_DRAFT' USING ERRCODE='P0001'; END IF;
      UPDATE billing.plans AS p SET name=btrim(p_name),description=p_description,currency=p_currency,price_minor=p_price_minor,
        billing_period=p_billing_period,default_trial_days=p_default_trial_days,updated_at=now()
      WHERE p.id=p_plan_id RETURNING p.* INTO v_plan;
      v_reason := COALESCE(p_reason_code,'plan.updated');
      v_event_type := 'billing.plan.updated';
    ELSIF p_action='activate' THEN
      IF v_plan.status <> 'draft' THEN RAISE EXCEPTION 'AIRENOS_PLAN_REQUIRES_DRAFT' USING ERRCODE='P0001'; END IF;
      UPDATE billing.plans AS p SET status='active',activated_at=now(),updated_at=now() WHERE p.id=p_plan_id RETURNING p.* INTO v_plan;
      v_reason := COALESCE(p_reason_code,'plan.activated');
      v_event_type := 'billing.plan.activated';
    ELSE
      IF v_plan.status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_PLAN_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;
      UPDATE billing.plans AS p SET status='retired',retired_at=now(),updated_at=now() WHERE p.id=p_plan_id RETURNING p.* INTO v_plan;
      v_reason := COALESCE(p_reason_code,'plan.retired');
      v_event_type := 'billing.plan.retired';
    END IF;
  END IF;

  v_resource_id := v_plan.id;
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(NULL,NULL,v_actor,'user','billing.plan.'||p_action,'Plan',v_plan.id::text,v_correlation,'success',
    jsonb_build_object('planId',v_plan.id,'slug',v_plan.slug,'status',v_plan.status,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(NULL,NULL,v_event_type,'Plan',v_plan.id::text,1,jsonb_build_object('planId',v_plan.id,'slug',v_plan.slug,'status',v_plan.status,'reasonCode',v_reason),v_correlation);

  v_result := jsonb_build_object(
    'id',v_plan.id,'slug',v_plan.slug,'name',v_plan.name,'description',COALESCE(v_plan.description,''),'status',v_plan.status,'currency',v_plan.currency,
    'priceMinor',v_plan.price_minor,'billingPeriod',v_plan.billing_period,'defaultTrialDays',v_plan.default_trial_days,'createdAt',v_plan.created_at,'updatedAt',v_plan.updated_at,
    'activatedAt',COALESCE(v_plan.activated_at::text,''),'retiredAt',COALESCE(v_plan.retired_at::text,'')
  );
  UPDATE billing.lifecycle_idempotency AS i SET resource_id=v_resource_id,status='completed',result=v_result,completed_at=now() WHERE i.idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT p_action,v_plan.id,v_plan.slug,v_plan.name,v_plan.description,v_plan.status,v_plan.currency,v_plan.price_minor,v_plan.billing_period,
    v_plan.default_trial_days,v_plan.created_at,v_plan.updated_at,v_plan.activated_at,v_plan.retired_at,false;
END;
$$;
ALTER FUNCTION security.platform_mutate_plan(text,text,uuid,text,text,text,text,bigint,text,integer,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_plan(text,text,uuid,text,text,text,text,bigint,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_plan(text,text,uuid,text,text,text,text,bigint,text,integer,text) TO airen_control_plane;


COMMIT;
