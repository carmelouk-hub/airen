-- AIRenOS Session Authority staging-only OIDC proof identity bootstrap.
-- Gate: AOS-SA-IDLINK-09
-- DO NOT APPLY TO PRODUCTION.
--
-- Purpose:
--   Idempotently link the governed Keycloak staging proof subject to an active,
--   synthetic AIRenOS Identity without storing personal email or provider secrets.
--
-- Preconditions:
--   * Run only against airenos_identity_f25_staging_db.
--   * Execute through the governed database bootstrap/admin channel.
--   * Do not use the bootstrap/admin credential as an application runtime credential.

BEGIN;

DO $$
DECLARE
  v_provider_key constant text := 'keycloak-staging';
  v_provider_subject constant text := 'a114e404-9818-4cdd-ba2b-6d7b81fa4f8e';
  v_identity_id uuid;
  v_identity_status text;
BEGIN
  SELECT psl.identity_id, i.status
  INTO v_identity_id, v_identity_status
  FROM identity.provider_subject_links AS psl
  JOIN identity.identities AS i ON i.id = psl.identity_id
  WHERE psl.provider_key = v_provider_key
    AND psl.provider_subject = v_provider_subject;

  IF v_identity_id IS NOT NULL THEN
    IF v_identity_status <> 'active' THEN
      RAISE EXCEPTION 'Existing staging OIDC proof identity is not active';
    END IF;
  ELSE
    INSERT INTO identity.identities(display_name, primary_email, status)
    VALUES ('AIRenOS OIDC Staging Proof', NULL, 'active')
    RETURNING id INTO v_identity_id;

    INSERT INTO identity.provider_subject_links(identity_id, provider_key, provider_subject)
    VALUES (v_identity_id, v_provider_key, v_provider_subject);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM identity.provider_subject_links AS psl
    JOIN identity.identities AS i ON i.id = psl.identity_id
    WHERE psl.provider_key = v_provider_key
      AND psl.provider_subject = v_provider_subject
      AND i.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Staging OIDC proof provider link validation failed';
  END IF;
END
$$;

COMMIT;
