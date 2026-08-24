-- R3-H / 0027 Platform Audit Query Surface
-- Read-only platform capability over the existing audit.audit_events authority.
BEGIN;

INSERT INTO authz.permission_registry(permission_key,description,sensitivity)
VALUES ('platform.audit.read','Read bounded sanitized Platform Audit projections','high')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
VALUES ('platform','platform_admin','platform.audit.read','allow')
ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow';

-- Additive read indexes only. No replacement Audit table and no metadata index.
CREATE INDEX idx_r3h_audit_created_id ON audit.audit_events(created_at DESC,id DESC);
CREATE INDEX idx_r3h_audit_tenant_created_id ON audit.audit_events(tenant_id,created_at DESC,id DESC);
CREATE INDEX idx_r3h_audit_location_created_id ON audit.audit_events(tenant_id,location_id,created_at DESC,id DESC);
CREATE INDEX idx_r3h_audit_actor_created_id ON audit.audit_events(actor_identity_id,created_at DESC,id DESC);
CREATE INDEX idx_r3h_audit_correlation_created_id ON audit.audit_events(correlation_id,created_at DESC,id DESC);
CREATE INDEX idx_r3h_audit_action_created_id ON audit.audit_events(action_key,created_at DESC,id DESC);
CREATE INDEX idx_r3h_audit_resource_created_id ON audit.audit_events(resource_type,resource_id,created_at DESC,id DESC);

-- Invocation roles do not receive a direct platform-wide table read path.
REVOKE SELECT ON audit.audit_events FROM PUBLIC;
REVOKE SELECT ON audit.audit_events FROM airen_control_plane;

-- The existing Tenant/Location airen_app SELECT/RLS contract is intentionally untouched.
GRANT USAGE ON SCHEMA audit,platform,authz,security TO airen_control_plane_owner;
GRANT SELECT ON audit.audit_events,platform.locations,authz.platform_role_assignments,authz.role_permission_grants TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.r3h_assert_platform_audit_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='platform'
     AND rpg.role_key=pra.role_key
     AND rpg.permission_key='platform.audit.read'
     AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor
      AND pra.status='active'
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_AUDIT_PERMISSION_DENIED' USING ERRCODE='42501';
  END IF;
END;
$$;
ALTER FUNCTION security.r3h_assert_platform_audit_read() OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.r3h_assert_platform_audit_read() FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.r3h_sanitize_audit_metadata(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_type text;
  v_key text;
  v_value jsonb;
  v_result jsonb;
BEGIN
  IF p_value IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_type := jsonb_typeof(p_value);
  IF v_type='object' THEN
    v_result := '{}'::jsonb;
    FOR v_key,v_value IN SELECT e.key,e.value FROM jsonb_each(p_value) e LOOP
      IF lower(v_key) IN (
        'password','passwd','pwd','otp','jwt','cookie','authorization','api_key','apikey',
        'access_token','refresh_token','session_token','id_token','webhook_secret','client_secret',
        'secret','cvv','cvc','pan','card_number'
      ) OR lower(v_key) ~ '(_token|_secret|_password)$' THEN
        CONTINUE;
      END IF;
      v_result := v_result || jsonb_build_object(v_key,security.r3h_sanitize_audit_metadata(v_value));
    END LOOP;
    RETURN v_result;
  ELSIF v_type='array' THEN
    SELECT COALESCE(jsonb_agg(security.r3h_sanitize_audit_metadata(a.value) ORDER BY a.ordinality),'[]'::jsonb)
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS a(value,ordinality);
    RETURN v_result;
  END IF;
  RETURN p_value;
END;
$$;
ALTER FUNCTION security.r3h_sanitize_audit_metadata(jsonb) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.r3h_sanitize_audit_metadata(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.platform_query_audit_events(
  p_created_from timestamptz,
  p_created_until timestamptz,
  p_tenant_id uuid,
  p_location_id uuid,
  p_actor_identity_id uuid,
  p_actor_kind text,
  p_action_key text,
  p_resource_type text,
  p_resource_id text,
  p_correlation_id text,
  p_outcome text,
  p_cursor_created_at timestamptz,
  p_cursor_id uuid,
  p_limit integer
)
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  location_id uuid,
  actor_identity_id uuid,
  actor_kind text,
  action_key text,
  resource_type text,
  resource_id text,
  correlation_id text,
  outcome text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
BEGIN
  PERFORM security.r3h_assert_platform_audit_read();

  IF p_created_from IS NULL OR p_created_until IS NULL OR p_created_from >= p_created_until THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:audit_window' USING ERRCODE='22023';
  END IF;
  IF p_created_until - p_created_from > interval '31 days' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:audit_window_max' USING ERRCODE='22023';
  END IF;
  IF p_location_id IS NOT NULL AND p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:location_requires_tenant' USING ERRCODE='22023';
  END IF;
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM platform.locations l WHERE l.id=p_location_id AND l.tenant_id=p_tenant_id
  ) THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:location_tenant_mismatch' USING ERRCODE='22023';
  END IF;
  IF p_outcome IS NOT NULL AND p_outcome NOT IN ('success','denied','failure') THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:outcome' USING ERRCODE='22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:limit' USING ERRCODE='22023';
  END IF;
  IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:cursor_pair' USING ERRCODE='22023';
  END IF;
  IF p_actor_kind IS NOT NULL AND (p_actor_kind<>lower(btrim(p_actor_kind)) OR char_length(p_actor_kind) NOT BETWEEN 1 AND 64) THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:actor_kind' USING ERRCODE='22023';
  END IF;
  IF p_action_key IS NOT NULL AND (p_action_key<>lower(btrim(p_action_key)) OR char_length(p_action_key) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:action_key' USING ERRCODE='22023';
  END IF;
  IF p_resource_type IS NOT NULL AND (p_resource_type<>btrim(p_resource_type) OR char_length(p_resource_type) NOT BETWEEN 1 AND 160) THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:resource_type' USING ERRCODE='22023';
  END IF;
  IF p_resource_id IS NOT NULL AND (p_resource_id<>btrim(p_resource_id) OR char_length(p_resource_id) NOT BETWEEN 1 AND 256) THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:resource_id' USING ERRCODE='22023';
  END IF;
  IF p_correlation_id IS NOT NULL AND (p_correlation_id<>btrim(p_correlation_id) OR char_length(p_correlation_id) NOT BETWEEN 1 AND 256) THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:correlation_id' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT
    ae.id,ae.tenant_id,ae.location_id,ae.actor_identity_id,ae.actor_kind,ae.action_key,
    ae.resource_type,ae.resource_id,ae.correlation_id,ae.outcome,
    CASE
      WHEN octet_length(convert_to(sm.sanitized::text,'UTF8')) > 8192
        THEN '{"_redacted":true,"_reason":"metadata_size_limit"}'::jsonb
      ELSE sm.sanitized
    END AS metadata,
    ae.created_at
  FROM audit.audit_events ae
  CROSS JOIN LATERAL (SELECT security.r3h_sanitize_audit_metadata(ae.metadata) AS sanitized) sm
  WHERE ae.created_at >= p_created_from
    AND ae.created_at < p_created_until
    AND (p_tenant_id IS NULL OR ae.tenant_id=p_tenant_id)
    AND (p_location_id IS NULL OR ae.location_id=p_location_id)
    AND (p_actor_identity_id IS NULL OR ae.actor_identity_id=p_actor_identity_id)
    AND (p_actor_kind IS NULL OR ae.actor_kind=p_actor_kind)
    AND (p_action_key IS NULL OR ae.action_key=p_action_key)
    AND (p_resource_type IS NULL OR ae.resource_type=p_resource_type)
    AND (p_resource_id IS NULL OR ae.resource_id=p_resource_id)
    AND (p_correlation_id IS NULL OR ae.correlation_id=p_correlation_id)
    AND (p_outcome IS NULL OR ae.outcome=p_outcome)
    AND (p_cursor_created_at IS NULL OR (ae.created_at,ae.id) < (p_cursor_created_at,p_cursor_id))
  ORDER BY ae.created_at DESC,ae.id DESC
  LIMIT p_limit + 1;
END;
$$;
ALTER FUNCTION security.platform_query_audit_events(timestamptz,timestamptz,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,uuid,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_query_audit_events(timestamptz,timestamptz,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,uuid,integer) FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_control_plane;
GRANT EXECUTE ON FUNCTION security.platform_query_audit_events(timestamptz,timestamptz,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,uuid,integer) TO airen_control_plane;

COMMIT;
