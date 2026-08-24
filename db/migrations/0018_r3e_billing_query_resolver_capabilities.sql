-- R3-E / 0018 Governed billing queries and current-tenant resolver
BEGIN;
CREATE OR REPLACE FUNCTION security.platform_get_plan(p_plan_id uuid)
RETURNS TABLE(
  plan_id uuid,plan_slug text,plan_name text,plan_description text,plan_status text,plan_currency text,plan_price_minor bigint,
  plan_billing_period text,plan_default_trial_days integer,plan_created_at timestamptz,plan_updated_at timestamptz,plan_activated_at timestamptz,plan_retired_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3e_assert_platform_permission('platform.plans.read');
  RETURN QUERY SELECT p.id,p.slug,p.name,p.description,p.status,p.currency,p.price_minor,p.billing_period,p.default_trial_days,p.created_at,p.updated_at,p.activated_at,p.retired_at
  FROM billing.plans p WHERE p.id=p_plan_id;
END;
$$;
ALTER FUNCTION security.platform_get_plan(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_plan(uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_plans(p_status text,p_after_slug text,p_limit integer)
RETURNS TABLE(
  plan_id uuid,plan_slug text,plan_name text,plan_description text,plan_status text,plan_currency text,plan_price_minor bigint,
  plan_billing_period text,plan_default_trial_days integer,plan_created_at timestamptz,plan_updated_at timestamptz,plan_activated_at timestamptz,plan_retired_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3e_assert_platform_permission('platform.plans.read');
  IF p_status IS NOT NULL AND p_status NOT IN ('draft','active','retired') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:plan_status_filter' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT p.id,p.slug,p.name,p.description,p.status,p.currency,p.price_minor,p.billing_period,p.default_trial_days,p.created_at,p.updated_at,p.activated_at,p.retired_at
  FROM billing.plans p WHERE (p_status IS NULL OR p.status=p_status) AND (p_after_slug IS NULL OR p.slug>p_after_slug) ORDER BY p.slug LIMIT p_limit;
END;
$$;
ALTER FUNCTION security.platform_list_plans(text,text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_plans(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_plans(text,text,integer) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_get_subscription(p_subscription_id uuid)
RETURNS TABLE(
  subscription_id uuid,tenant_id uuid,plan_id uuid,subscription_status text,starts_at timestamptz,trial_ends_at timestamptz,current_period_start timestamptz,current_period_end timestamptz,
  cancel_effective_at timestamptz,canceled_at timestamptz,suspended_at timestamptz,source_kind text,provider_key text,provider_subscription_ref text,provider_customer_ref text,created_at timestamptz,updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3e_assert_platform_permission('platform.subscriptions.read');
  RETURN QUERY SELECT s.id,s.tenant_id,s.plan_id,s.status,s.starts_at,s.trial_ends_at,s.current_period_start,s.current_period_end,s.cancel_effective_at,s.canceled_at,s.suspended_at,
    s.source_kind,s.provider_key,s.provider_subscription_ref,s.provider_customer_ref,s.created_at,s.updated_at
  FROM billing.subscriptions s WHERE s.id=p_subscription_id;
END;
$$;
ALTER FUNCTION security.platform_get_subscription(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_subscription(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_subscription(uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_subscriptions(p_tenant_id uuid,p_status text,p_plan_id uuid,p_after_subscription_id uuid,p_limit integer)
RETURNS TABLE(
  subscription_id uuid,tenant_id uuid,plan_id uuid,subscription_status text,starts_at timestamptz,trial_ends_at timestamptz,current_period_start timestamptz,current_period_end timestamptz,
  cancel_effective_at timestamptz,canceled_at timestamptz,suspended_at timestamptz,source_kind text,provider_key text,provider_subscription_ref text,provider_customer_ref text,created_at timestamptz,updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3e_assert_platform_permission('platform.subscriptions.read');
  IF p_status IS NOT NULL AND p_status NOT IN ('scheduled','trialing','active','suspended','cancel_pending','canceled','expired') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:subscription_status_filter' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT s.id,s.tenant_id,s.plan_id,s.status,s.starts_at,s.trial_ends_at,s.current_period_start,s.current_period_end,s.cancel_effective_at,s.canceled_at,s.suspended_at,
    s.source_kind,s.provider_key,s.provider_subscription_ref,s.provider_customer_ref,s.created_at,s.updated_at
  FROM billing.subscriptions s
  WHERE (p_tenant_id IS NULL OR s.tenant_id=p_tenant_id) AND (p_status IS NULL OR s.status=p_status) AND (p_plan_id IS NULL OR s.plan_id=p_plan_id)
    AND (p_after_subscription_id IS NULL OR s.id>p_after_subscription_id)
  ORDER BY s.id LIMIT p_limit;
END;
$$;
ALTER FUNCTION security.platform_list_subscriptions(uuid,text,uuid,uuid,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_subscriptions(uuid,text,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_subscriptions(uuid,text,uuid,uuid,integer) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.resolve_current_tenant_subscription()
RETURNS TABLE(
  subscription_id uuid,tenant_id uuid,plan_id uuid,plan_slug text,subscription_status text,starts_at timestamptz,trial_ends_at timestamptz,
  current_period_start timestamptz,current_period_end timestamptz,cancel_effective_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_tenant uuid := NULLIF(current_setting('airen.tenant_id',true),'')::uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'AIRENOS_TENANT_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT s.id,s.tenant_id,s.plan_id,p.slug,s.status,s.starts_at,s.trial_ends_at,s.current_period_start,s.current_period_end,s.cancel_effective_at
  FROM billing.subscriptions s JOIN billing.plans p ON p.id=s.plan_id
  WHERE s.tenant_id=v_tenant AND s.status IN ('scheduled','trialing','active','suspended','cancel_pending')
  LIMIT 1;
END;
$$;
ALTER FUNCTION security.resolve_current_tenant_subscription() OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.resolve_current_tenant_subscription() FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_app;
GRANT EXECUTE ON FUNCTION security.resolve_current_tenant_subscription() TO airen_app;


COMMIT;
