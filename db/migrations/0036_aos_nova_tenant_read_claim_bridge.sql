-- AOS-NOVA-CTRLPLANE-057 — read-only Tenant bridge for Session Authority role claims.
-- The Control Plane runtime may use only platformRoles obtained from the canonical
-- Session Authority principal endpoint. No client-declared role headers are trusted.
BEGIN;

CREATE OR REPLACE FUNCTION security.platform_permissions_for_roles(
  p_platform_roles text[]
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, authz, security
AS $$
  SELECT COALESCE(array_agg(DISTINCT rpg.permission_key ORDER BY rpg.permission_key), ARRAY[]::text[])
  FROM authz.role_permission_grants rpg
  WHERE rpg.scope_kind = 'platform'
    AND rpg.effect = 'allow'
    AND rpg.role_key = ANY(COALESCE(p_platform_roles, ARRAY[]::text[]));
$$;
ALTER FUNCTION security.platform_permissions_for_roles(text[]) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_permissions_for_roles(text[]) FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_control_plane;
GRANT EXECUTE ON FUNCTION security.platform_permissions_for_roles(text[]) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_get_tenant_for_roles(
  p_platform_roles text[],
  p_tenant_id uuid
)
RETURNS TABLE (
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  tenant_status text,
  tenant_locale text,
  tenant_timezone text,
  tenant_currency text,
  tenant_created_at timestamptz,
  tenant_updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:tenant_id' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM authz.role_permission_grants rpg
    WHERE rpg.scope_kind='platform'
      AND rpg.effect='allow'
      AND rpg.permission_key='platform.tenants.read'
      AND rpg.role_key = ANY(COALESCE(p_platform_roles, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT t.id,t.slug,t.name,t.status,t.locale,t.timezone,t.currency,t.created_at,t.updated_at
  FROM platform.tenants t
  WHERE t.id=p_tenant_id;
END;
$$;
ALTER FUNCTION security.platform_get_tenant_for_roles(text[],uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_tenant_for_roles(text[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_tenant_for_roles(text[],uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_tenants_for_roles(
  p_platform_roles text[],
  p_status text DEFAULT NULL,
  p_after uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  tenant_status text,
  tenant_locale text,
  tenant_timezone text,
  tenant_currency text,
  tenant_created_at timestamptz,
  tenant_updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM authz.role_permission_grants rpg
    WHERE rpg.scope_kind='platform'
      AND rpg.effect='allow'
      AND rpg.permission_key='platform.tenants.read'
      AND rpg.role_key = ANY(COALESCE(p_platform_roles, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active','suspended','archived') THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:status' USING ERRCODE='22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:limit' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  SELECT t.id,t.slug,t.name,t.status,t.locale,t.timezone,t.currency,t.created_at,t.updated_at
  FROM platform.tenants t
  WHERE (p_status IS NULL OR t.status=p_status)
    AND (p_after IS NULL OR t.id>p_after)
  ORDER BY t.id ASC
  LIMIT p_limit;
END;
$$;
ALTER FUNCTION security.platform_list_tenants_for_roles(text[],text,uuid,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_tenants_for_roles(text[],text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_tenants_for_roles(text[],text,uuid,integer) TO airen_control_plane;

COMMIT;
