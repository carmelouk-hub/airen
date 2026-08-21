-- B44-FX-011 / 0004 Authentication Bootstrap Boundary
-- Resolves verified provider subject -> AIRenOS Identity through a narrow SECURITY DEFINER function.
-- The airen_auth role receives no direct table SELECT privileges.
BEGIN;

CREATE OR REPLACE FUNCTION security.resolve_authentication_identity(
  p_provider_key text,
  p_provider_subject text
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
  FROM identity.provider_subject_links psl
  JOIN identity.identities i ON i.id = psl.identity_id
  LEFT JOIN authz.platform_role_assignments pra ON pra.identity_id = i.id
  WHERE psl.provider_key = p_provider_key
    AND psl.provider_subject = p_provider_subject
  GROUP BY i.id, i.status;
$$;

REVOKE ALL ON FUNCTION security.resolve_authentication_identity(text, text) FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_auth;
GRANT EXECUTE ON FUNCTION security.resolve_authentication_identity(text, text) TO airen_auth;

COMMIT;
