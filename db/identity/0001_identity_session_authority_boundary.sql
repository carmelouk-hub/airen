-- AIRenOS Identity F2.5D — dedicated Identity Session Authority database boundary
-- Render-managed bootstrap compatibility correction over F2.5C.
-- Provider-neutral, secret-free schema/bootstrap contract.
-- This file intentionally excludes Tenant, Location, Billing, Audit, Events and product schemas.
-- It is executed only by the dedicated Identity database bootstrap owner.

BEGIN;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS authz;
CREATE SCHEMA IF NOT EXISTS security;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airen_auth') THEN
    CREATE ROLE airen_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

-- Managed PostgreSQL providers may correctly deny changing SUPERUSER/BYPASSRLS
-- attributes even when setting them to their safe false value. Validate the
-- resulting group role fail-closed instead of attempting a privileged mutation.
DO $$
DECLARE
  v_airen_auth record;
BEGIN
  SELECT
    rolcanlogin,
    rolsuper,
    rolcreatedb,
    rolcreaterole,
    rolinherit,
    rolbypassrls,
    rolreplication
  INTO STRICT v_airen_auth
  FROM pg_roles
  WHERE rolname = 'airen_auth';

  IF v_airen_auth.rolcanlogin
     OR v_airen_auth.rolsuper
     OR v_airen_auth.rolcreatedb
     OR v_airen_auth.rolcreaterole
     OR v_airen_auth.rolinherit
     OR v_airen_auth.rolbypassrls
     OR v_airen_auth.rolreplication THEN
    RAISE EXCEPTION 'airen_auth role attributes are unsafe';
  END IF;
END
$$;

REVOKE ALL ON SCHEMA identity FROM PUBLIC;
REVOKE ALL ON SCHEMA authz FROM PUBLIC;
REVOKE ALL ON SCHEMA security FROM PUBLIC;

CREATE TABLE IF NOT EXISTS identity.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text,
  primary_email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_primary_email
  ON identity.identities(lower(primary_email))
  WHERE primary_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity.provider_subject_links (
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  provider_key text NOT NULL,
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_key, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_provider_subject_links_identity
  ON identity.provider_subject_links(identity_id);

CREATE TABLE IF NOT EXISTS authz.platform_role_assignments (
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  role_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, role_key)
);

CREATE TABLE IF NOT EXISTS identity.airenos_sessions (
  session_id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_airenos_sessions_time_window CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'
  ),
  CONSTRAINT ck_airenos_sessions_revocation_state CHECK (
    (status = 'active' AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL
      AND btrim(revocation_reason) <> '' AND char_length(revocation_reason) <= 256)
  )
);

CREATE INDEX IF NOT EXISTS idx_airenos_sessions_identity_status_expiry
  ON identity.airenos_sessions(identity_id, status, expires_at DESC);

ALTER TABLE identity.airenos_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA authz FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM airen_auth;
REVOKE ALL ON ALL TABLES IN SCHEMA authz FROM airen_auth;

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

CREATE OR REPLACE FUNCTION security.register_airenos_session(
  p_session_id uuid,
  p_identity_id uuid,
  p_issued_at timestamptz,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, security
AS $$
BEGIN
  IF p_session_id IS NULL OR p_identity_id IS NULL OR p_issued_at IS NULL OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'AIRenOS session registration requires complete metadata';
  END IF;
  IF p_expires_at <= p_issued_at OR p_expires_at > p_issued_at + interval '5 minutes' THEN
    RAISE EXCEPTION 'AIRenOS session lifetime is outside the permitted window';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM identity.identities i
    WHERE i.id = p_identity_id AND i.status = 'active'
  ) THEN
    RAISE EXCEPTION 'AIRenOS session identity is not active';
  END IF;

  INSERT INTO identity.airenos_sessions(session_id, identity_id, issued_at, expires_at)
  VALUES (p_session_id, p_identity_id, p_issued_at, p_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION security.resolve_active_airenos_session(
  p_session_id uuid,
  p_identity_id uuid
)
RETURNS TABLE (
  session_id uuid,
  identity_id uuid,
  issued_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity, security
AS $$
  SELECT s.session_id, s.identity_id, s.issued_at, s.expires_at
  FROM identity.airenos_sessions s
  JOIN identity.identities i ON i.id = s.identity_id
  WHERE s.session_id = p_session_id
    AND s.identity_id = p_identity_id
    AND s.status = 'active'
    AND s.expires_at > now()
    AND i.status = 'active';
$$;

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

CREATE OR REPLACE FUNCTION security.revoke_airenos_session(
  p_session_id uuid,
  p_identity_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, security
AS $$
DECLARE
  v_count integer;
  v_reason text := btrim(p_reason);
BEGIN
  IF v_reason IS NULL OR v_reason = '' OR char_length(v_reason) > 256 THEN
    RAISE EXCEPTION 'AIRenOS session revocation reason is invalid';
  END IF;

  UPDATE identity.airenos_sessions
  SET status = 'revoked', revoked_at = now(), revocation_reason = v_reason
  WHERE session_id = p_session_id
    AND identity_id = p_identity_id
    AND status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION security.revoke_all_airenos_sessions(
  p_identity_id uuid,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, identity, security
AS $$
DECLARE
  v_count integer;
  v_reason text := btrim(p_reason);
BEGIN
  IF v_reason IS NULL OR v_reason = '' OR char_length(v_reason) > 256 THEN
    RAISE EXCEPTION 'AIRenOS session revocation reason is invalid';
  END IF;

  UPDATE identity.airenos_sessions
  SET status = 'revoked', revoked_at = now(), revocation_reason = v_reason
  WHERE identity_id = p_identity_id
    AND status = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION security.resolve_authentication_identity(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.register_airenos_session(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.resolve_active_airenos_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.resolve_airenos_identity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.revoke_airenos_session(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.revoke_all_airenos_sessions(uuid, text) FROM PUBLIC;

GRANT USAGE ON SCHEMA security TO airen_auth;
GRANT EXECUTE ON FUNCTION security.resolve_authentication_identity(text, text) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.register_airenos_session(uuid, uuid, timestamptz, timestamptz) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.resolve_active_airenos_session(uuid, uuid) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.resolve_airenos_identity(uuid) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.revoke_airenos_session(uuid, uuid, text) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.revoke_all_airenos_sessions(uuid, text) TO airen_auth;

CREATE TABLE IF NOT EXISTS security.identity_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON security.identity_schema_migrations FROM PUBLIC;
REVOKE ALL ON security.identity_schema_migrations FROM airen_auth;
INSERT INTO security.identity_schema_migrations(version)
VALUES ('F2.5D-0001')
ON CONFLICT (version) DO NOTHING;

COMMIT;
