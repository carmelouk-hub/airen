-- R3-F / 0022 Entitlement admin queries and trusted current-Tenant effective resolver
BEGIN;

CREATE OR REPLACE FUNCTION security.platform_get_entitlement_catalog(p_entitlement_key text)
RETURNS TABLE(entitlement_key text,description text,catalog_status text,created_at timestamptz,updated_at timestamptz,retired_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3f_assert_platform_permission('platform.entitlements.read');
  RETURN QUERY SELECT e.entitlement_key,e.description,e.status,e.created_at,e.updated_at,e.retired_at
  FROM billing.entitlement_catalog e WHERE e.entitlement_key=p_entitlement_key;
END;
$$;
ALTER FUNCTION security.platform_get_entitlement_catalog(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_entitlement_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_entitlement_catalog(text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_entitlement_catalog(p_status text,p_after_key text,p_limit integer)
RETURNS TABLE(entitlement_key text,description text,catalog_status text,created_at timestamptz,updated_at timestamptz,retired_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3f_assert_platform_permission('platform.entitlements.read');
  IF p_status IS NOT NULL AND p_status NOT IN ('active','retired') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:catalog_status_filter' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT e.entitlement_key,e.description,e.status,e.created_at,e.updated_at,e.retired_at
  FROM billing.entitlement_catalog e
  WHERE (p_status IS NULL OR e.status=p_status) AND (p_after_key IS NULL OR e.entitlement_key>p_after_key)
  ORDER BY e.entitlement_key LIMIT p_limit;
END;
$$;
ALTER FUNCTION security.platform_list_entitlement_catalog(text,text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_entitlement_catalog(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_entitlement_catalog(text,text,integer) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_get_tenant_entitlement(p_tenant_id uuid,p_entitlement_key text)
RETURNS TABLE(
  tenant_id uuid,entitlement_key text,source_kind text,source_ref text,enabled boolean,derived_state text,limit_value numeric,valid_from timestamptz,valid_until timestamptz,
  config jsonb,created_at timestamptz,updated_at timestamptz,revoked_at timestamptz,expired_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3f_assert_platform_permission('platform.entitlements.read');
  RETURN QUERY SELECT e.tenant_id,e.entitlement_key,e.source_kind,e.source_ref,e.enabled,
    CASE WHEN NOT e.enabled AND e.expired_at IS NOT NULL THEN 'expired'
         WHEN NOT e.enabled AND e.revoked_at IS NOT NULL THEN 'revoked'
         WHEN NOT e.enabled THEN 'inactive'
         WHEN e.valid_from IS NOT NULL AND e.valid_from>now() THEN 'scheduled'
         WHEN e.valid_until IS NOT NULL AND e.valid_until<=now() THEN 'inactive'
         ELSE 'effective' END,
    e.limit_value,e.valid_from,e.valid_until,e.config,e.created_at,e.updated_at,e.revoked_at,e.expired_at
  FROM billing.tenant_entitlements e WHERE e.tenant_id=p_tenant_id AND e.entitlement_key=p_entitlement_key;
END;
$$;
ALTER FUNCTION security.platform_get_tenant_entitlement(uuid,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_tenant_entitlement(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_tenant_entitlement(uuid,text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_tenant_entitlements(p_tenant_id uuid,p_entitlement_key text,p_derived_state text,p_after_key text,p_limit integer)
RETURNS TABLE(
  tenant_id uuid,entitlement_key text,source_kind text,source_ref text,enabled boolean,derived_state text,limit_value numeric,valid_from timestamptz,valid_until timestamptz,
  config jsonb,created_at timestamptz,updated_at timestamptz,revoked_at timestamptz,expired_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3f_assert_platform_permission('platform.entitlements.read');
  IF p_derived_state IS NOT NULL AND p_derived_state NOT IN ('scheduled','effective','revoked','expired','inactive') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:derived_state_filter' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  SELECT q.tenant_id,q.entitlement_key,q.source_kind,q.source_ref,q.enabled,q.derived_state,q.limit_value,q.valid_from,q.valid_until,q.config,q.created_at,q.updated_at,q.revoked_at,q.expired_at
  FROM (
    SELECT e.tenant_id,e.entitlement_key,e.source_kind,e.source_ref,e.enabled,
      CASE WHEN NOT e.enabled AND e.expired_at IS NOT NULL THEN 'expired'
           WHEN NOT e.enabled AND e.revoked_at IS NOT NULL THEN 'revoked'
           WHEN NOT e.enabled THEN 'inactive'
           WHEN e.valid_from IS NOT NULL AND e.valid_from>now() THEN 'scheduled'
           WHEN e.valid_until IS NOT NULL AND e.valid_until<=now() THEN 'inactive'
           ELSE 'effective' END AS derived_state,
      e.limit_value,e.valid_from,e.valid_until,e.config,e.created_at,e.updated_at,e.revoked_at,e.expired_at
    FROM billing.tenant_entitlements e
  ) q
  WHERE (p_tenant_id IS NULL OR q.tenant_id=p_tenant_id)
    AND (p_entitlement_key IS NULL OR q.entitlement_key=p_entitlement_key)
    AND (p_derived_state IS NULL OR q.derived_state=p_derived_state)
    AND (p_after_key IS NULL OR q.entitlement_key>p_after_key)
  ORDER BY q.tenant_id,q.entitlement_key LIMIT p_limit;
END;
$$;
ALTER FUNCTION security.platform_list_tenant_entitlements(uuid,text,text,text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_tenant_entitlements(uuid,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_tenant_entitlements(uuid,text,text,text,integer) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.resolve_current_tenant_entitlements()
RETURNS TABLE(entitlement_key text,limit_value numeric,config jsonb,valid_from timestamptz,valid_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_tenant uuid := NULLIF(current_setting('airen.tenant_id',true),'')::uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'AIRENOS_TENANT_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT e.entitlement_key,e.limit_value,e.config,e.valid_from,e.valid_until
  FROM billing.tenant_entitlements e
  JOIN billing.entitlement_catalog c ON c.entitlement_key=e.entitlement_key
  JOIN platform.tenants t ON t.id=e.tenant_id
  WHERE e.tenant_id=v_tenant AND t.status='active' AND c.status='active' AND e.enabled=true
    AND COALESCE(e.valid_from,'-infinity'::timestamptz) <= now()
    AND (e.valid_until IS NULL OR e.valid_until>now())
  ORDER BY e.entitlement_key;
END;
$$;
ALTER FUNCTION security.resolve_current_tenant_entitlements() OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.resolve_current_tenant_entitlements() FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_app;
GRANT EXECUTE ON FUNCTION security.resolve_current_tenant_entitlements() TO airen_app;

COMMIT;
