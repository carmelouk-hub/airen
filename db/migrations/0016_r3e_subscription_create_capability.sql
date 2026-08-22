-- R3-E / 0016 Governed Subscription creation capability
BEGIN;
CREATE OR REPLACE FUNCTION security.platform_create_subscription(
  p_idempotency_key text,
  p_tenant_id uuid,
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_trial_ends_at timestamptz,
  p_current_period_end timestamptz,
  p_source_kind text,
  p_provider_key text,
  p_provider_subscription_ref text,
  p_provider_customer_ref text,
  p_reason_code text
)
RETURNS TABLE(
  result_action text,
  result_subscription_id uuid,
  result_tenant_id uuid,
  result_plan_id uuid,
  result_status text,
  result_starts_at timestamptz,
  result_trial_ends_at timestamptz,
  result_current_period_start timestamptz,
  result_current_period_end timestamptz,
  result_cancel_effective_at timestamptz,
  result_canceled_at timestamptz,
  result_suspended_at timestamptz,
  result_source_kind text,
  result_provider_key text,
  result_provider_subscription_ref text,
  result_provider_customer_ref text,
  result_created_at timestamptz,
  result_updated_at timestamptz,
  result_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_plan billing.plans%ROWTYPE;
  v_tenant_status text;
  v_trial_ends_at timestamptz;
  v_initial_status text;
  v_subscription billing.subscriptions%ROWTYPE;
  v_reason text;
  v_result jsonb;
BEGIN
  PERFORM security.r3e_assert_platform_permission('platform.subscriptions.create');
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_tenant_id IS NULL OR p_plan_id IS NULL OR p_starts_at IS NULL OR p_current_period_end IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:subscription_required_fields' USING ERRCODE='22023'; END IF;
  IF p_current_period_end <= p_starts_at THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:current_period' USING ERRCODE='22023'; END IF;
  IF p_trial_ends_at IS NOT NULL AND p_trial_ends_at <= p_starts_at THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:trial_ends_at' USING ERRCODE='22023'; END IF;
  IF p_source_kind NOT IN ('manual','migration','provider') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:source_kind' USING ERRCODE='22023'; END IF;
  IF p_provider_key IS NOT NULL AND (p_provider_key <> lower(btrim(p_provider_key)) OR p_provider_key !~ '^[a-z0-9][a-z0-9._:-]{1,63}$') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:provider_key' USING ERRCODE='22023'; END IF;
  IF p_provider_subscription_ref IS NOT NULL AND char_length(p_provider_subscription_ref) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:provider_subscription_ref' USING ERRCODE='22023'; END IF;
  IF p_provider_customer_ref IS NOT NULL AND char_length(p_provider_customer_ref) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:provider_customer_ref' USING ERRCODE='22023'; END IF;
  IF (p_provider_subscription_ref IS NOT NULL OR p_provider_customer_ref IS NOT NULL) AND p_provider_key IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:provider_key_required' USING ERRCODE='22023'; END IF;
  IF p_source_kind='provider' AND (p_provider_key IS NULL OR p_provider_subscription_ref IS NULL) THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:provider_source_refs' USING ERRCODE='22023'; END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;

  SELECT t.status INTO v_tenant_status FROM platform.tenants t WHERE t.id=p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_TENANT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_tenant_status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_TENANT_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;
  SELECT p.* INTO v_plan FROM billing.plans p WHERE p.id=p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_PLAN_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_plan.status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_PLAN_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;

  v_trial_ends_at := p_trial_ends_at;
  IF v_trial_ends_at IS NULL AND v_plan.default_trial_days>0 THEN v_trial_ends_at := p_starts_at + make_interval(days=>v_plan.default_trial_days); END IF;
  v_initial_status := CASE
    WHEN p_starts_at > now() THEN 'scheduled'
    WHEN v_trial_ends_at IS NOT NULL AND v_trial_ends_at > now() THEN 'trialing'
    ELSE 'active'
  END;

  v_request_hash := encode(public.digest(jsonb_build_object(
    'action','create','tenantId',p_tenant_id,'planId',p_plan_id,'startsAt',p_starts_at,'trialEndsAt',p_trial_ends_at,'currentPeriodEnd',p_current_period_end,
    'sourceKind',p_source_kind,'providerKey',p_provider_key,'providerSubscriptionRef',p_provider_subscription_ref,'providerCustomerRef',p_provider_customer_ref,'reasonCode',p_reason_code
  )::text,'sha256'),'hex');
  INSERT INTO billing.lifecycle_idempotency(idempotency_key,request_hash,action_key,resource_kind,resource_id,actor_identity_id)
  VALUES(p_idempotency_key,v_request_hash,'subscription.create','subscription',NULL,v_actor)
  ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result
  FROM billing.lifecycle_idempotency i WHERE i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT 'create',
      (v_existing_result->>'id')::uuid,(v_existing_result->>'tenantId')::uuid,(v_existing_result->>'planId')::uuid,v_existing_result->>'status',
      (v_existing_result->>'startsAt')::timestamptz,NULLIF(v_existing_result->>'trialEndsAt','')::timestamptz,
      (v_existing_result->>'currentPeriodStart')::timestamptz,(v_existing_result->>'currentPeriodEnd')::timestamptz,
      NULLIF(v_existing_result->>'cancelEffectiveAt','')::timestamptz,NULLIF(v_existing_result->>'canceledAt','')::timestamptz,NULLIF(v_existing_result->>'suspendedAt','')::timestamptz,
      v_existing_result->>'sourceKind',NULLIF(v_existing_result->>'providerKey',''),NULLIF(v_existing_result->>'providerSubscriptionRef',''),NULLIF(v_existing_result->>'providerCustomerRef',''),
      (v_existing_result->>'createdAt')::timestamptz,(v_existing_result->>'updatedAt')::timestamptz,true;
    RETURN;
  END IF;

  INSERT INTO billing.subscriptions(tenant_id,plan_id,status,starts_at,trial_ends_at,current_period_start,current_period_end,source_kind,provider_key,provider_subscription_ref,provider_customer_ref)
  VALUES(p_tenant_id,p_plan_id,v_initial_status,p_starts_at,v_trial_ends_at,p_starts_at,p_current_period_end,p_source_kind,p_provider_key,p_provider_subscription_ref,p_provider_customer_ref)
  RETURNING * INTO v_subscription;
  v_reason := COALESCE(p_reason_code,'subscription.created');

  INSERT INTO billing.subscription_events(subscription_id,tenant_id,event_type,from_status,to_status,from_plan_id,to_plan_id,effective_at,actor_identity_id,reason_code,correlation_id,metadata)
  VALUES(v_subscription.id,v_subscription.tenant_id,'created',NULL,v_subscription.status,NULL,v_subscription.plan_id,now(),v_actor,v_reason,v_correlation,
    jsonb_build_object('sourceKind',v_subscription.source_kind));
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(v_subscription.tenant_id,NULL,v_actor,'user','billing.subscription.create','Subscription',v_subscription.id::text,v_correlation,'success',
    jsonb_build_object('subscriptionId',v_subscription.id,'planId',v_subscription.plan_id,'status',v_subscription.status,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(v_subscription.tenant_id,NULL,'billing.subscription.created','Subscription',v_subscription.id::text,1,
    jsonb_build_object('subscriptionId',v_subscription.id,'planId',v_subscription.plan_id,'status',v_subscription.status,'reasonCode',v_reason),v_correlation);

  v_result := jsonb_build_object(
    'id',v_subscription.id,'tenantId',v_subscription.tenant_id,'planId',v_subscription.plan_id,'status',v_subscription.status,'startsAt',v_subscription.starts_at,
    'trialEndsAt',COALESCE(v_subscription.trial_ends_at::text,''),'currentPeriodStart',v_subscription.current_period_start,'currentPeriodEnd',v_subscription.current_period_end,
    'cancelEffectiveAt','','canceledAt','','suspendedAt','', 'sourceKind',v_subscription.source_kind,'providerKey',COALESCE(v_subscription.provider_key,''),
    'providerSubscriptionRef',COALESCE(v_subscription.provider_subscription_ref,''),'providerCustomerRef',COALESCE(v_subscription.provider_customer_ref,''),
    'createdAt',v_subscription.created_at,'updatedAt',v_subscription.updated_at
  );
  UPDATE billing.lifecycle_idempotency AS i SET resource_id=v_subscription.id,status='completed',result=v_result,completed_at=now() WHERE i.idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT 'create',v_subscription.id,v_subscription.tenant_id,v_subscription.plan_id,v_subscription.status,v_subscription.starts_at,v_subscription.trial_ends_at,
    v_subscription.current_period_start,v_subscription.current_period_end,v_subscription.cancel_effective_at,v_subscription.canceled_at,v_subscription.suspended_at,
    v_subscription.source_kind,v_subscription.provider_key,v_subscription.provider_subscription_ref,v_subscription.provider_customer_ref,v_subscription.created_at,v_subscription.updated_at,false;
END;
$$;
ALTER FUNCTION security.platform_create_subscription(text,uuid,uuid,timestamptz,timestamptz,timestamptz,text,text,text,text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_create_subscription(text,uuid,uuid,timestamptz,timestamptz,timestamptz,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_create_subscription(text,uuid,uuid,timestamptz,timestamptz,timestamptz,text,text,text,text,text) TO airen_control_plane;


COMMIT;
