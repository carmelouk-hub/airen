-- R3-E / 0017 Governed Subscription lifecycle mutation capability
BEGIN;
CREATE OR REPLACE FUNCTION security.platform_mutate_subscription(
  p_action text,
  p_idempotency_key text,
  p_subscription_id uuid,
  p_to_plan_id uuid,
  p_cancel_mode text,
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
  v_permission text;
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_subscription billing.subscriptions%ROWTYPE;
  v_from_status text;
  v_from_plan_id uuid;
  v_tenant_status text;
  v_target_plan_status text;
  v_new_status text;
  v_reason text;
  v_event_type text;
  v_outbox_type text;
  v_effective_at timestamptz := now();
  v_result jsonb;
BEGIN
  IF p_action NOT IN ('activate','suspend','reactivate','schedule_cancel','unschedule_cancel','cancel','expire','change_plan') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:subscription_action' USING ERRCODE='22023'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_subscription_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:subscription_id' USING ERRCODE='22023'; END IF;
  IF p_action='change_plan' AND p_to_plan_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:to_plan_id' USING ERRCODE='22023'; END IF;
  IF p_action<>'change_plan' AND p_to_plan_id IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:unexpected_to_plan_id' USING ERRCODE='22023'; END IF;
  IF p_action='cancel' AND p_cancel_mode NOT IN ('immediate','finalize_scheduled') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:cancel_mode' USING ERRCODE='22023'; END IF;
  IF p_action<>'cancel' AND p_cancel_mode IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:unexpected_cancel_mode' USING ERRCODE='22023'; END IF;
  IF p_action IN ('suspend','cancel','expire') AND (p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;

  v_permission := CASE p_action
    WHEN 'activate' THEN 'platform.subscriptions.activate'
    WHEN 'suspend' THEN 'platform.subscriptions.suspend'
    WHEN 'reactivate' THEN 'platform.subscriptions.reactivate'
    WHEN 'schedule_cancel' THEN 'platform.subscriptions.schedule_cancel'
    WHEN 'unschedule_cancel' THEN 'platform.subscriptions.unschedule_cancel'
    WHEN 'cancel' THEN 'platform.subscriptions.cancel'
    WHEN 'expire' THEN 'platform.subscriptions.expire'
    ELSE 'platform.subscriptions.change_plan'
  END;
  PERFORM security.r3e_assert_platform_permission(v_permission);

  v_request_hash := encode(public.digest(jsonb_build_object(
    'action',p_action,'subscriptionId',p_subscription_id,'toPlanId',p_to_plan_id,'cancelMode',p_cancel_mode,'reasonCode',p_reason_code
  )::text,'sha256'),'hex');
  INSERT INTO billing.lifecycle_idempotency(idempotency_key,request_hash,action_key,resource_kind,resource_id,actor_identity_id)
  VALUES(p_idempotency_key,v_request_hash,'subscription.'||p_action,'subscription',p_subscription_id,v_actor)
  ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT i.request_hash,i.status,i.result INTO v_existing_hash,v_existing_status,v_existing_result
  FROM billing.lifecycle_idempotency i WHERE i.idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT p_action,
      (v_existing_result->>'id')::uuid,(v_existing_result->>'tenantId')::uuid,(v_existing_result->>'planId')::uuid,v_existing_result->>'status',
      (v_existing_result->>'startsAt')::timestamptz,NULLIF(v_existing_result->>'trialEndsAt','')::timestamptz,
      (v_existing_result->>'currentPeriodStart')::timestamptz,(v_existing_result->>'currentPeriodEnd')::timestamptz,
      NULLIF(v_existing_result->>'cancelEffectiveAt','')::timestamptz,NULLIF(v_existing_result->>'canceledAt','')::timestamptz,NULLIF(v_existing_result->>'suspendedAt','')::timestamptz,
      v_existing_result->>'sourceKind',NULLIF(v_existing_result->>'providerKey',''),NULLIF(v_existing_result->>'providerSubscriptionRef',''),NULLIF(v_existing_result->>'providerCustomerRef',''),
      (v_existing_result->>'createdAt')::timestamptz,(v_existing_result->>'updatedAt')::timestamptz,true;
    RETURN;
  END IF;

  SELECT s.* INTO v_subscription FROM billing.subscriptions s WHERE s.id=p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_SUBSCRIPTION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  v_from_status := v_subscription.status;
  v_from_plan_id := v_subscription.plan_id;

  IF p_action IN ('activate','reactivate','unschedule_cancel','change_plan') THEN
    SELECT t.status INTO v_tenant_status FROM platform.tenants t WHERE t.id=v_subscription.tenant_id;
    IF v_tenant_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'AIRENOS_TENANT_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;
  END IF;

  IF p_action='activate' THEN
    IF v_subscription.status='scheduled' THEN
      IF v_subscription.starts_at > now() THEN RAISE EXCEPTION 'AIRENOS_SUBSCRIPTION_START_NOT_REACHED' USING ERRCODE='P0001'; END IF;
      v_new_status := CASE WHEN v_subscription.trial_ends_at IS NOT NULL AND v_subscription.trial_ends_at>now() THEN 'trialing' ELSE 'active' END;
      UPDATE billing.subscriptions AS s SET status=v_new_status,updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
      v_reason := COALESCE(p_reason_code,'subscription.started'); v_event_type := 'started'; v_outbox_type := 'billing.subscription.started';
    ELSIF v_subscription.status='trialing' THEN
      UPDATE billing.subscriptions AS s SET status='active',updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
      v_reason := COALESCE(p_reason_code,'subscription.activated'); v_event_type := 'trial_activated'; v_outbox_type := 'billing.subscription.activated';
    ELSE
      RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:activate' USING ERRCODE='P0001';
    END IF;
  ELSIF p_action='suspend' THEN
    IF v_subscription.status<>'active' THEN RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:suspend' USING ERRCODE='P0001'; END IF;
    UPDATE billing.subscriptions AS s SET status='suspended',suspended_at=now(),updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
    v_reason := p_reason_code; v_event_type := 'suspended'; v_outbox_type := 'billing.subscription.suspended';
  ELSIF p_action='reactivate' THEN
    IF v_subscription.status<>'suspended' THEN RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:reactivate' USING ERRCODE='P0001'; END IF;
    UPDATE billing.subscriptions AS s SET status='active',suspended_at=NULL,updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
    v_reason := COALESCE(p_reason_code,'subscription.reactivated'); v_event_type := 'reactivated'; v_outbox_type := 'billing.subscription.reactivated';
  ELSIF p_action='schedule_cancel' THEN
    IF v_subscription.status NOT IN ('trialing','active') THEN RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:schedule_cancel' USING ERRCODE='P0001'; END IF;
    UPDATE billing.subscriptions AS s SET status='cancel_pending',cancel_effective_at=current_period_end,updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
    v_reason := COALESCE(p_reason_code,'subscription.cancel_scheduled'); v_event_type := 'cancel_scheduled'; v_outbox_type := 'billing.subscription.cancel_scheduled';
  ELSIF p_action='unschedule_cancel' THEN
    IF v_subscription.status<>'cancel_pending' THEN RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:unschedule_cancel' USING ERRCODE='P0001'; END IF;
    v_new_status := CASE WHEN v_subscription.trial_ends_at IS NOT NULL AND v_subscription.trial_ends_at>now() THEN 'trialing' ELSE 'active' END;
    UPDATE billing.subscriptions AS s SET status=v_new_status,cancel_effective_at=NULL,updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
    v_reason := COALESCE(p_reason_code,'subscription.cancel_unscheduled'); v_event_type := 'cancel_unscheduled'; v_outbox_type := 'billing.subscription.cancel_unscheduled';
  ELSIF p_action='cancel' THEN
    IF p_cancel_mode='immediate' THEN
      IF v_subscription.status NOT IN ('scheduled','trialing','active','suspended','cancel_pending') THEN RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:cancel' USING ERRCODE='P0001'; END IF;
    ELSE
      IF v_subscription.status<>'cancel_pending' THEN RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:finalize_scheduled_cancel' USING ERRCODE='P0001'; END IF;
      IF v_subscription.cancel_effective_at IS NULL OR v_subscription.cancel_effective_at>now() THEN RAISE EXCEPTION 'AIRENOS_CANCEL_EFFECTIVE_NOT_REACHED' USING ERRCODE='P0001'; END IF;
      v_effective_at := v_subscription.cancel_effective_at;
    END IF;
    UPDATE billing.subscriptions AS s SET status='canceled',canceled_at=now(),suspended_at=NULL,updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
    v_reason := p_reason_code; v_event_type := 'canceled'; v_outbox_type := 'billing.subscription.canceled';
  ELSIF p_action='expire' THEN
    IF v_subscription.status NOT IN ('scheduled','trialing','active','suspended','cancel_pending') THEN RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:expire' USING ERRCODE='P0001'; END IF;
    IF v_subscription.current_period_end>now() THEN RAISE EXCEPTION 'AIRENOS_PERIOD_NOT_ENDED' USING ERRCODE='P0001'; END IF;
    v_effective_at := v_subscription.current_period_end;
    UPDATE billing.subscriptions AS s SET status='expired',suspended_at=NULL,updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
    v_reason := p_reason_code; v_event_type := 'expired'; v_outbox_type := 'billing.subscription.expired';
  ELSE
    IF v_subscription.status NOT IN ('scheduled','trialing','active','suspended') THEN RAISE EXCEPTION 'AIRENOS_INVALID_SUBSCRIPTION_STATE:change_plan' USING ERRCODE='P0001'; END IF;
    IF p_to_plan_id=v_subscription.plan_id THEN RAISE EXCEPTION 'AIRENOS_PLAN_CHANGE_REQUIRES_DIFFERENT_PLAN' USING ERRCODE='P0001'; END IF;
    SELECT p.status INTO v_target_plan_status FROM billing.plans p WHERE p.id=p_to_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_PLAN_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF v_target_plan_status<>'active' THEN RAISE EXCEPTION 'AIRENOS_PLAN_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;
    UPDATE billing.subscriptions AS s SET plan_id=p_to_plan_id,updated_at=now() WHERE s.id=p_subscription_id RETURNING s.* INTO v_subscription;
    v_reason := COALESCE(p_reason_code,'subscription.plan_changed'); v_event_type := 'plan_changed'; v_outbox_type := 'billing.subscription.plan_changed';
  END IF;

  INSERT INTO billing.subscription_events(subscription_id,tenant_id,event_type,from_status,to_status,from_plan_id,to_plan_id,effective_at,actor_identity_id,reason_code,correlation_id,metadata)
  VALUES(v_subscription.id,v_subscription.tenant_id,v_event_type,v_from_status,v_subscription.status,v_from_plan_id,v_subscription.plan_id,v_effective_at,v_actor,v_reason,v_correlation,
    jsonb_build_object('cancelMode',p_cancel_mode));
  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES(v_subscription.tenant_id,NULL,v_actor,'user','billing.subscription.'||p_action,'Subscription',v_subscription.id::text,v_correlation,'success',
    jsonb_build_object('subscriptionId',v_subscription.id,'fromStatus',v_from_status,'status',v_subscription.status,'fromPlanId',v_from_plan_id,'planId',v_subscription.plan_id,'reasonCode',v_reason));
  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES(v_subscription.tenant_id,NULL,v_outbox_type,'Subscription',v_subscription.id::text,1,
    jsonb_build_object('subscriptionId',v_subscription.id,'fromStatus',v_from_status,'status',v_subscription.status,'fromPlanId',v_from_plan_id,'planId',v_subscription.plan_id,'reasonCode',v_reason),v_correlation);

  v_result := jsonb_build_object(
    'id',v_subscription.id,'tenantId',v_subscription.tenant_id,'planId',v_subscription.plan_id,'status',v_subscription.status,'startsAt',v_subscription.starts_at,
    'trialEndsAt',COALESCE(v_subscription.trial_ends_at::text,''),'currentPeriodStart',v_subscription.current_period_start,'currentPeriodEnd',v_subscription.current_period_end,
    'cancelEffectiveAt',COALESCE(v_subscription.cancel_effective_at::text,''),'canceledAt',COALESCE(v_subscription.canceled_at::text,''),'suspendedAt',COALESCE(v_subscription.suspended_at::text,''),
    'sourceKind',v_subscription.source_kind,'providerKey',COALESCE(v_subscription.provider_key,''),'providerSubscriptionRef',COALESCE(v_subscription.provider_subscription_ref,''),
    'providerCustomerRef',COALESCE(v_subscription.provider_customer_ref,''),'createdAt',v_subscription.created_at,'updatedAt',v_subscription.updated_at
  );
  UPDATE billing.lifecycle_idempotency AS i SET status='completed',result=v_result,completed_at=now() WHERE i.idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT p_action,v_subscription.id,v_subscription.tenant_id,v_subscription.plan_id,v_subscription.status,v_subscription.starts_at,v_subscription.trial_ends_at,
    v_subscription.current_period_start,v_subscription.current_period_end,v_subscription.cancel_effective_at,v_subscription.canceled_at,v_subscription.suspended_at,
    v_subscription.source_kind,v_subscription.provider_key,v_subscription.provider_subscription_ref,v_subscription.provider_customer_ref,v_subscription.created_at,v_subscription.updated_at,false;
END;
$$;
ALTER FUNCTION security.platform_mutate_subscription(text,text,uuid,uuid,text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_subscription(text,text,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_subscription(text,text,uuid,uuid,text,text) TO airen_control_plane;


COMMIT;
