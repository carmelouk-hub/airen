-- R3-A / 0006 Tenant provisioning platform-authority capability
-- Narrow DB boundary: the application role can EXECUTE the capability but receives no direct Tenant INSERT authority.
BEGIN;

CREATE TABLE platform.tenant_provisioning_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  tenant_id uuid REFERENCES platform.tenants(id),
  location_id uuid,
  tenant_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_tenant_provisioning_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT fk_tenant_provisioning_location_scope FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT fk_tenant_provisioning_membership_scope FOREIGN KEY (tenant_id, tenant_membership_id) REFERENCES authz.tenant_memberships(tenant_id, id),
  CONSTRAINT ck_tenant_provisioning_completed_result CHECK (
    status <> 'completed' OR (tenant_id IS NOT NULL AND location_id IS NOT NULL AND tenant_membership_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
REVOKE ALL ON platform.tenant_provisioning_idempotency FROM PUBLIC;

INSERT INTO authz.permission_registry(permission_key, description, sensitivity)
VALUES ('platform.tenants.provision', 'Provision Tenant with primary Location and initial owner membership', 'high')
ON CONFLICT (permission_key) DO NOTHING;

GRANT USAGE ON SCHEMA platform, authz, audit, events, security TO airen_control_plane_owner;
GRANT SELECT, INSERT ON platform.tenants, platform.locations TO airen_control_plane_owner;
GRANT SELECT, INSERT, UPDATE ON platform.tenant_provisioning_idempotency TO airen_control_plane_owner;
GRANT SELECT ON authz.platform_role_assignments, authz.role_permission_grants TO airen_control_plane_owner;
GRANT INSERT ON authz.tenant_memberships TO airen_control_plane_owner;
GRANT INSERT ON audit.audit_events, events.outbox_events TO airen_control_plane_owner;
GRANT CREATE ON SCHEMA security TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.platform_provision_tenant(
  p_idempotency_key text,
  p_tenant_slug text,
  p_tenant_name text,
  p_locale text,
  p_timezone text,
  p_currency text,
  p_location_slug text,
  p_location_name text,
  p_location_timezone text
)
RETURNS TABLE (
  result_tenant_id uuid,
  result_location_id uuid,
  result_membership_id uuid,
  tenant_slug text,
  tenant_name text,
  tenant_status text,
  location_slug text,
  location_name text,
  location_status text,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id', true), '');
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_tenant_id uuid;
  v_location_id uuid;
  v_membership_id uuid;
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind = 'platform'
     AND rpg.role_key = pra.role_key
     AND rpg.permission_key = 'platform.tenants.provision'
     AND rpg.effect = 'allow'
    WHERE pra.identity_id = v_actor
      AND pra.status = 'active'
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE = '22023';
  END IF;
  IF p_tenant_slug IS NULL OR p_tenant_slug <> lower(p_tenant_slug) OR p_tenant_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$' OR p_tenant_slug ~ '-$' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:tenant_slug' USING ERRCODE = '22023';
  END IF;
  IF p_location_slug IS NULL OR p_location_slug <> lower(p_location_slug) OR p_location_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$' OR p_location_slug ~ '-$' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:location_slug' USING ERRCODE = '22023';
  END IF;
  IF p_tenant_name IS NULL OR btrim(p_tenant_name) = '' OR p_location_name IS NULL OR btrim(p_location_name) = '' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:name' USING ERRCODE = '22023';
  END IF;
  IF p_locale IS NULL OR btrim(p_locale) = '' OR p_timezone IS NULL OR btrim(p_timezone) = '' OR p_location_timezone IS NULL OR btrim(p_location_timezone) = '' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:locale_timezone' USING ERRCODE = '22023';
  END IF;
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:currency' USING ERRCODE = '22023';
  END IF;

  v_request_hash := encode(public.digest(
    concat_ws(chr(31), p_tenant_slug, p_tenant_name, p_locale, p_timezone, p_currency, p_location_slug, p_location_name, p_location_timezone),
    'sha256'
  ), 'hex');

  INSERT INTO platform.tenant_provisioning_idempotency(idempotency_key, request_hash, actor_identity_id)
  VALUES (p_idempotency_key, v_request_hash, v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT i.request_hash, i.status, i.tenant_id, i.location_id, i.tenant_membership_id
    INTO v_existing_hash, v_existing_status, v_tenant_id, v_location_id, v_membership_id
  FROM platform.tenant_provisioning_idempotency i
  WHERE i.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
    RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  IF v_existing_status = 'completed' THEN
    RETURN QUERY
    SELECT t.id, l.id, i.tenant_membership_id, t.slug, t.name, t.status, l.slug, l.name, l.status, true
    FROM platform.tenant_provisioning_idempotency i
    JOIN platform.tenants t ON t.id = i.tenant_id
    JOIN platform.locations l ON l.id = i.location_id AND l.tenant_id = i.tenant_id
    WHERE i.idempotency_key = p_idempotency_key;
    RETURN;
  END IF;

  INSERT INTO platform.tenants(slug, name, locale, timezone, currency)
  VALUES (p_tenant_slug, p_tenant_name, p_locale, p_timezone, p_currency)
  RETURNING id INTO v_tenant_id;

  INSERT INTO platform.locations(tenant_id, slug, name, timezone, is_primary)
  VALUES (v_tenant_id, p_location_slug, p_location_name, p_location_timezone, true)
  RETURNING id INTO v_location_id;

  INSERT INTO authz.tenant_memberships(tenant_id, identity_id, role_key, status)
  VALUES (v_tenant_id, v_actor, 'owner', 'active')
  RETURNING id INTO v_membership_id;

  INSERT INTO audit.audit_events(
    tenant_id, location_id, actor_identity_id, actor_kind, action_key, resource_type, resource_id, correlation_id, outcome, metadata
  ) VALUES (
    v_tenant_id, v_location_id, v_actor, 'user', 'platform.tenant.provision', 'Tenant', v_tenant_id::text, v_correlation, 'success',
    jsonb_build_object('idempotencyKey', p_idempotency_key, 'primaryLocationId', v_location_id, 'tenantMembershipId', v_membership_id)
  );

  INSERT INTO events.outbox_events(
    tenant_id, location_id, event_type, aggregate_type, aggregate_id, payload_version, payload, correlation_id
  ) VALUES (
    v_tenant_id, v_location_id, 'platform.tenant.provisioned', 'Tenant', v_tenant_id::text, 1,
    jsonb_build_object('tenantId', v_tenant_id, 'slug', p_tenant_slug, 'primaryLocationId', v_location_id, 'tenantMembershipId', v_membership_id),
    v_correlation
  );

  UPDATE platform.tenant_provisioning_idempotency
  SET status = 'completed', tenant_id = v_tenant_id, location_id = v_location_id, tenant_membership_id = v_membership_id, completed_at = now()
  WHERE idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_tenant_id, v_location_id, v_membership_id, p_tenant_slug, p_tenant_name, 'active'::text, p_location_slug, p_location_name, 'active'::text, false;
END;
$$;

ALTER FUNCTION security.platform_provision_tenant(text,text,text,text,text,text,text,text,text) OWNER TO airen_control_plane_owner;
REVOKE CREATE ON SCHEMA security FROM airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_provision_tenant(text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_control_plane;
GRANT EXECUTE ON FUNCTION security.platform_provision_tenant(text,text,text,text,text,text,text,text,text) TO airen_control_plane;

COMMIT;
