-- R3-G / 0026 Admin query surfaces and trusted current capability availability resolver
BEGIN;

CREATE OR REPLACE FUNCTION security.platform_get_capability(p_capability_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v jsonb;
BEGIN
  PERFORM security.r3g_assert_platform_permission('platform.capabilities.read');
  SELECT jsonb_build_object('id',c.id,'capabilityKey',c.capability_key,'name',c.name,'description',c.description,'status',c.status,'scopeKind',c.scope_kind,'requiredEntitlements',to_jsonb(c.required_entitlements),'requiredPermissions',to_jsonb(c.required_permissions),'featureFlagKey',c.feature_flag_key,'auditLevel',c.audit_level,'aiAccessMode',c.ai_access_mode,'createdAt',c.created_at,'updatedAt',c.updated_at,'activatedAt',c.activated_at,'retiredAt',c.retired_at) INTO v
  FROM platform.capability_catalog c WHERE c.capability_key=p_capability_key;
  RETURN v;
END; $$;
ALTER FUNCTION security.platform_get_capability(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_capability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_capability(text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_capabilities(p_status text,p_scope_kind text,p_after_key text,p_limit integer)
RETURNS TABLE(id uuid,capability_key text,name text,description text,status text,scope_kind text,required_entitlements text[],required_permissions text[],feature_flag_key text,audit_level text,ai_access_mode text,created_at timestamptz,updated_at timestamptz,activated_at timestamptz,retired_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3g_assert_platform_permission('platform.capabilities.read');
  IF p_status IS NOT NULL AND p_status NOT IN ('draft','active','retired') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:capability_status_filter' USING ERRCODE='22023'; END IF;
  IF p_scope_kind IS NOT NULL AND p_scope_kind NOT IN ('tenant','location') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:capability_scope_filter' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT c.id,c.capability_key,c.name,c.description,c.status,c.scope_kind,c.required_entitlements,c.required_permissions,c.feature_flag_key,c.audit_level,c.ai_access_mode,c.created_at,c.updated_at,c.activated_at,c.retired_at
  FROM platform.capability_catalog c WHERE (p_status IS NULL OR c.status=p_status) AND (p_scope_kind IS NULL OR c.scope_kind=p_scope_kind) AND (p_after_key IS NULL OR c.capability_key>p_after_key) ORDER BY c.capability_key LIMIT p_limit;
END; $$;
ALTER FUNCTION security.platform_list_capabilities(text,text,text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_capabilities(text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_capabilities(text,text,text,integer) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_get_feature_flag(p_feature_flag_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v jsonb;
BEGIN
  PERFORM security.r3g_assert_platform_permission('platform.feature_flags.read');
  SELECT jsonb_build_object('id',f.id,'featureFlagKey',f.feature_flag_key,'description',f.description,'status',f.status,'enabledDefault',f.enabled_default,'validFrom',f.valid_from,'validUntil',f.valid_until,'createdAt',f.created_at,'updatedAt',f.updated_at,'retiredAt',f.retired_at) INTO v FROM platform.feature_flags f WHERE f.feature_flag_key=p_feature_flag_key;
  RETURN v;
END; $$;
ALTER FUNCTION security.platform_get_feature_flag(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_feature_flag(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_feature_flag(text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_feature_flags(p_status text,p_after_key text,p_limit integer)
RETURNS TABLE(id uuid,feature_flag_key text,description text,status text,enabled_default boolean,valid_from timestamptz,valid_until timestamptz,created_at timestamptz,updated_at timestamptz,retired_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3g_assert_platform_permission('platform.feature_flags.read');
  IF p_status IS NOT NULL AND p_status NOT IN ('active','retired') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:feature_status_filter' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT f.id,f.feature_flag_key,f.description,f.status,f.enabled_default,f.valid_from,f.valid_until,f.created_at,f.updated_at,f.retired_at FROM platform.feature_flags f WHERE (p_status IS NULL OR f.status=p_status) AND (p_after_key IS NULL OR f.feature_flag_key>p_after_key) ORDER BY f.feature_flag_key LIMIT p_limit;
END; $$;
ALTER FUNCTION security.platform_list_feature_flags(text,text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_feature_flags(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_feature_flags(text,text,integer) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_feature_flag_overrides(p_feature_flag_key text,p_tenant_id uuid,p_subject_kind text,p_status text,p_limit integer)
RETURNS TABLE(id uuid,feature_flag_key text,subject_kind text,tenant_id uuid,location_id uuid,enabled boolean,valid_from timestamptz,valid_until timestamptz,reason_code text,status text,created_at timestamptz,updated_at timestamptz,removed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM security.r3g_assert_platform_permission('platform.feature_flags.read');
  IF p_subject_kind IS NOT NULL AND p_subject_kind NOT IN ('tenant','location') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:override_subject_filter' USING ERRCODE='22023'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active','removed') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:override_status_filter' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:list_limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT o.id,f.feature_flag_key,o.subject_kind,o.tenant_id,o.location_id,o.enabled,o.valid_from,o.valid_until,o.reason_code,o.status,o.created_at,o.updated_at,o.removed_at
  FROM platform.feature_flag_overrides o JOIN platform.feature_flags f ON f.id=o.feature_flag_id
  WHERE (p_feature_flag_key IS NULL OR f.feature_flag_key=p_feature_flag_key) AND (p_tenant_id IS NULL OR o.tenant_id=p_tenant_id) AND (p_subject_kind IS NULL OR o.subject_kind=p_subject_kind) AND (p_status IS NULL OR o.status=p_status)
  ORDER BY o.created_at DESC LIMIT p_limit;
END; $$;
ALTER FUNCTION security.platform_list_feature_flag_overrides(text,uuid,text,text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_feature_flag_overrides(text,uuid,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_feature_flag_overrides(text,uuid,text,text,integer) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.resolve_current_capability_availability()
RETURNS TABLE(capability_key text,scope_kind text,required_permissions text[],available boolean,denial_reasons text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_tenant uuid := NULLIF(current_setting('airen.tenant_id',true),'')::uuid;
  v_location uuid := NULLIF(current_setting('airen.location_id',true),'')::uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'AIRENOS_TENANT_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  WITH effective_entitlements AS (
    SELECT e.entitlement_key FROM security.resolve_current_tenant_entitlements() e
  ), evaluated AS (
    SELECT c.capability_key,c.scope_kind,c.required_permissions,
      (t.status='active') AS tenant_active,
      CASE WHEN c.scope_kind='tenant' THEN true
           WHEN v_location IS NULL THEN false
           ELSE EXISTS(SELECT 1 FROM platform.locations l WHERE l.id=v_location AND l.tenant_id=v_tenant AND l.status='active') END AS scope_ok,
      NOT EXISTS(SELECT 1 FROM unnest(c.required_entitlements) req WHERE NOT EXISTS(SELECT 1 FROM effective_entitlements ee WHERE ee.entitlement_key=req)) AS entitlements_ok,
      c.feature_flag_key,
      ff.status AS flag_status,
      (ff.status='active' AND COALESCE(ff.valid_from,'-infinity'::timestamptz)<=now() AND (ff.valid_until IS NULL OR ff.valid_until>now())) AS flag_in_window,
      CASE WHEN c.feature_flag_key IS NULL THEN true
           WHEN ff.status<>'active' OR COALESCE(ff.valid_from,'-infinity'::timestamptz)>now() OR (ff.valid_until IS NOT NULL AND ff.valid_until<=now()) THEN false
           ELSE COALESCE(ov.enabled,ff.enabled_default) END AS flag_ok
    FROM platform.capability_catalog c
    JOIN platform.tenants t ON t.id=v_tenant
    LEFT JOIN platform.feature_flags ff ON ff.feature_flag_key=c.feature_flag_key
    LEFT JOIN LATERAL (
      SELECT o.enabled FROM platform.feature_flag_overrides o
      WHERE ff.id IS NOT NULL AND o.feature_flag_id=ff.id AND o.tenant_id=v_tenant AND o.status='active'
        AND COALESCE(o.valid_from,'-infinity'::timestamptz)<=now() AND (o.valid_until IS NULL OR o.valid_until>now())
        AND (
          (c.scope_kind='location' AND v_location IS NOT NULL AND o.subject_kind='location' AND o.location_id=v_location)
          OR (o.subject_kind='tenant' AND o.location_id IS NULL)
        )
      ORDER BY CASE WHEN o.subject_kind='location' THEN 0 ELSE 1 END,o.updated_at DESC
      LIMIT 1
    ) ov ON true
    WHERE c.status='active'
  )
  SELECT e.capability_key,e.scope_kind,e.required_permissions,
    (e.tenant_active AND e.scope_ok AND e.entitlements_ok AND e.flag_ok) AS available,
    array_remove(ARRAY[
      CASE WHEN NOT e.tenant_active THEN 'invalid_scope' END,
      CASE WHEN e.scope_kind='location' AND v_location IS NULL THEN 'location_context_required' END,
      CASE WHEN e.scope_kind='location' AND v_location IS NOT NULL AND NOT e.scope_ok THEN 'invalid_scope' END,
      CASE WHEN NOT e.entitlements_ok THEN 'entitlement_missing' END,
      CASE WHEN e.feature_flag_key IS NOT NULL AND e.flag_status='active' AND NOT e.flag_in_window THEN 'feature_out_of_window' END,
      CASE WHEN e.feature_flag_key IS NOT NULL AND (e.flag_status IS NULL OR e.flag_status<>'active' OR (e.flag_in_window AND NOT e.flag_ok)) THEN 'feature_disabled' END
    ]::text[],NULL) AS denial_reasons
  FROM evaluated e ORDER BY e.capability_key;
END;
$$;
ALTER FUNCTION security.resolve_current_capability_availability() OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.resolve_current_capability_availability() FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_app;
GRANT EXECUTE ON FUNCTION security.resolve_current_capability_availability() TO airen_app;

COMMIT;
