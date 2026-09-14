-- AOS-NOVA-IDENTITY-ROLE-055 — Session Authority identityId -> platform role resolution.
-- Narrow SECURITY DEFINER boundary: airen_auth receives EXECUTE only, never direct table SELECT.
BEGIN;

CREATE OR REPLACE FUNCTION security.resolve_airenos_identity(
  p_identity_id uuid
)
RETURNS TABLE (
  identity_id uuid,
  identity_status text,
  platform_roles text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity, authz, security
AS $$
  SELECT
    i.id AS identity_id,
    i.status AS identity_status,
    COALESCE(
      array_agg(DISTINCT pra.role_key ORDER BY pra.role_key)
        FILTER (WHERE pra.role_key IS NOT NULL AND pra.status = 'active'),
      ARRAY[]::text[]
    ) AS platform_roles
  FROM identity.identities i
  LEFT JOIN authz.platform_role_assignments pra ON pra.identity_id = i.id
  WHERE i.id = p_identity_id
  GROUP BY i.id, i.status;
$$;

REVOKE ALL ON FUNCTION security.resolve_airenos_identity(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_auth;
GRANT EXECUTE ON FUNCTION security.resolve_airenos_identity(uuid) TO airen_auth;

INSERT INTO security.identity_schema_migrations(version)
VALUES ('AOS-NOVA-IDENTITY-ROLE-055-0004')
ON CONFLICT (version) DO NOTHING;

COMMIT;
