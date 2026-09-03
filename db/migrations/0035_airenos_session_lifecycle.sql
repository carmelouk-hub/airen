BEGIN;

CREATE TABLE identity.airenos_sessions (
  session_id uuid PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_airenos_sessions_time_window CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'),
  CONSTRAINT ck_airenos_sessions_revocation_state CHECK (
    (status = 'active' AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND btrim(revocation_reason) <> '' AND char_length(revocation_reason) <= 256)
  )
);

CREATE INDEX idx_airenos_sessions_identity_status_expiry
  ON identity.airenos_sessions(identity_id, status, expires_at DESC);

ALTER TABLE identity.airenos_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE identity.airenos_sessions FROM PUBLIC;
REVOKE ALL ON TABLE identity.airenos_sessions FROM airen_app;
REVOKE ALL ON TABLE identity.airenos_sessions FROM airen_auth;

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
  IF NOT EXISTS (SELECT 1 FROM identity.identities i WHERE i.id = p_identity_id AND i.status = 'active') THEN
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

REVOKE ALL ON FUNCTION security.register_airenos_session(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.resolve_active_airenos_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.resolve_airenos_identity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.revoke_airenos_session(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.revoke_all_airenos_sessions(uuid, text) FROM PUBLIC;

GRANT USAGE ON SCHEMA security TO airen_auth;
GRANT EXECUTE ON FUNCTION security.register_airenos_session(uuid, uuid, timestamptz, timestamptz) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.resolve_active_airenos_session(uuid, uuid) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.resolve_airenos_identity(uuid) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.revoke_airenos_session(uuid, uuid, text) TO airen_auth;
GRANT EXECUTE ON FUNCTION security.revoke_all_airenos_sessions(uuid, text) TO airen_auth;

COMMIT;
