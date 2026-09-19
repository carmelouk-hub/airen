-- AOS-02 / Organization + Tenant binding control plane
-- Additive post-R3 migration. Existing Tenant, Location, TenantMembership and TenantDomain authority is preserved unchanged.
BEGIN;

CREATE TABLE platform.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  legal_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_organizations_slug_normalized CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT uq_organizations_slug UNIQUE (slug)
);

CREATE TABLE authz.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  role_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_organization_memberships_org_identity UNIQUE (organization_id, identity_id)
);
CREATE INDEX idx_organization_memberships_identity ON authz.organization_memberships(identity_id);

CREATE TABLE platform.organization_tenants (
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, tenant_id),
  CONSTRAINT uq_organization_tenants_tenant UNIQUE (tenant_id)
);
CREATE INDEX idx_organization_tenants_org ON platform.organization_tenants(organization_id);

CREATE TABLE platform.organization_provisioning_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  organization_id uuid REFERENCES platform.organizations(id),
  organization_membership_id uuid REFERENCES authz.organization_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_organization_provisioning_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_organization_provisioning_completed CHECK (
    status <> 'completed' OR (organization_id IS NOT NULL AND organization_membership_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE TABLE platform.organization_tenant_binding_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_organization_binding_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_organization_binding_completed CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

ALTER TABLE platform.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE authz.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.organization_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_provisioning_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_provisioning_idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_tenant_binding_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_tenant_binding_idempotency FORCE ROW LEVEL SECURITY;

REVOKE ALL ON platform.organizations, authz.organization_memberships, platform.organization_tenants,
  platform.organization_provisioning_idempotency, platform.organization_tenant_binding_idempotency FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON platform.organizations, authz.organization_memberships, platform.organization_tenants,
  platform.organization_provisioning_idempotency, platform.organization_tenant_binding_idempotency FROM airen_app, airen_control_plane;

INSERT INTO authz.permission_registry(permission_key, description, sensitivity) VALUES
  ('platform.organizations.provision', 'Provision AIRenOS Organizations and initial owner membership', 'critical'),
  ('platform.organizations.read', 'Read safe AIRenOS Organization projections', 'high'),
  ('platform.organizations.bind_tenant', 'Bind an existing Tenant to an AIRenOS Organization', 'critical')
ON CONFLICT (permission_key) DO NOTHING;

GRANT USAGE ON SCHEMA platform, authz, identity, audit, events, security TO airen_control_plane_owner;
GRANT SELECT, INSERT ON platform.organizations TO airen_control_plane_owner;
GRANT SELECT, INSERT ON authz.organization_memberships TO airen_control_plane_owner;
GRANT SELECT, INSERT ON platform.organization_tenants TO airen_control_plane_owner;
GRANT SELECT, INSERT, UPDATE ON platform.organization_provisioning_idempotency, platform.organization_tenant_binding_idempotency TO airen_control_plane_owner;
GRANT SELECT ON platform.tenants, authz.tenant_memberships, authz.platform_role_assignments, authz.role_permission_grants TO airen_control_plane_owner;
GRANT INSERT ON audit.audit_events, events.outbox_events TO airen_control_plane_owner;
GRANT CREATE ON SCHEMA security TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.platform_provision_organization(
  p_idempotency_key text,
  p_slug text,
  p_name text,
  p_legal_name text DEFAULT NULL
)
RETURNS TABLE (
  result_organization_id uuid,
  result_membership_id uuid,
  organization_slug text,
  organization_name text,
  organization_legal_name text,
  organization_status text,
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
  v_organization_id uuid;
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
     AND rpg.permission_key = 'platform.organizations.provision'
     AND rpg.effect = 'allow'
    WHERE pra.identity_id = v_actor AND pra.status = 'active'
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR p_slug <> lower(p_slug) OR p_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$' OR p_slug ~ '-$' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:organization_slug' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:organization_name' USING ERRCODE = '22023';
  END IF;

  v_request_hash := encode(public.digest(concat_ws(chr(31), p_slug, p_name, COALESCE(p_legal_name, '')), 'sha256'), 'hex');
  INSERT INTO platform.organization_provisioning_idempotency(idempotency_key, request_hash, actor_identity_id)
  VALUES (p_idempotency_key, v_request_hash, v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT request_hash, status, organization_id, organization_membership_id
    INTO v_existing_hash, v_existing_status, v_organization_id, v_membership_id
  FROM platform.organization_provisioning_idempotency
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
    RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF v_existing_status = 'completed' THEN
    RETURN QUERY
    SELECT o.id, i.organization_membership_id, o.slug, o.name, o.legal_name, o.status, true
    FROM platform.organization_provisioning_idempotency i
    JOIN platform.organizations o ON o.id = i.organization_id
    WHERE i.idempotency_key = p_idempotency_key;
    RETURN;
  END IF;

  INSERT INTO platform.organizations(slug, name, legal_name)
  VALUES (p_slug, btrim(p_name), NULLIF(btrim(COALESCE(p_legal_name, '')), ''))
  RETURNING id INTO v_organization_id;

  INSERT INTO authz.organization_memberships(organization_id, identity_id, role_key, status)
  VALUES (v_organization_id, v_actor, 'organization_owner', 'active')
  RETURNING id INTO v_membership_id;

  INSERT INTO audit.audit_events(actor_identity_id, actor_kind, action_key, resource_type, resource_id, correlation_id, outcome, metadata)
  VALUES (v_actor, 'user', 'platform.organization.provision', 'Organization', v_organization_id::text, v_correlation, 'success',
    jsonb_build_object('idempotencyKey', p_idempotency_key, 'initialMembershipId', v_membership_id));

  INSERT INTO events.outbox_events(event_type, aggregate_type, aggregate_id, payload_version, payload, correlation_id)
  VALUES ('platform.organization.provisioned', 'Organization', v_organization_id::text, 1,
    jsonb_build_object('organizationId', v_organization_id, 'slug', p_slug, 'initialMembershipId', v_membership_id), v_correlation);

  UPDATE platform.organization_provisioning_idempotency
  SET status = 'completed', organization_id = v_organization_id, organization_membership_id = v_membership_id, completed_at = now()
  WHERE idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_organization_id, v_membership_id, p_slug, btrim(p_name), NULLIF(btrim(COALESCE(p_legal_name, '')), ''), 'active'::text, false;
END;
$$;

CREATE OR REPLACE FUNCTION security.platform_bind_tenant_to_organization(
  p_idempotency_key text,
  p_organization_id uuid,
  p_tenant_id uuid
)
RETURNS TABLE (
  result_organization_id uuid,
  result_tenant_id uuid,
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
  v_bound_organization_id uuid;
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
     AND rpg.permission_key = 'platform.organizations.bind_tenant'
     AND rpg.effect = 'allow'
    WHERE pra.identity_id = v_actor AND pra.status = 'active'
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations WHERE id = p_organization_id AND status = 'active') THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:organization_not_active' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.tenants WHERE id = p_tenant_id AND status = 'active') THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:tenant_not_active' USING ERRCODE = '22023';
  END IF;

  v_request_hash := encode(public.digest(concat_ws(chr(31), p_organization_id::text, p_tenant_id::text), 'sha256'), 'hex');
  INSERT INTO platform.organization_tenant_binding_idempotency(idempotency_key, request_hash, actor_identity_id, organization_id, tenant_id)
  VALUES (p_idempotency_key, v_request_hash, v_actor, p_organization_id, p_tenant_id)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT request_hash, status INTO v_existing_hash, v_existing_status
  FROM platform.organization_tenant_binding_idempotency
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
    RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF v_existing_status = 'completed' THEN
    RETURN QUERY SELECT p_organization_id, p_tenant_id, true;
    RETURN;
  END IF;

  SELECT organization_id INTO v_bound_organization_id
  FROM platform.organization_tenants
  WHERE tenant_id = p_tenant_id;

  IF v_bound_organization_id IS NOT NULL AND v_bound_organization_id <> p_organization_id THEN
    RAISE EXCEPTION 'AIRENOS_TENANT_ALREADY_BOUND_TO_OTHER_ORGANIZATION' USING ERRCODE = '23505';
  END IF;

  IF v_bound_organization_id = p_organization_id THEN
    UPDATE platform.organization_tenant_binding_idempotency SET status = 'completed', completed_at = now() WHERE idempotency_key = p_idempotency_key;
    RETURN QUERY SELECT p_organization_id, p_tenant_id, true;
    RETURN;
  END IF;

  INSERT INTO platform.organization_tenants(organization_id, tenant_id) VALUES (p_organization_id, p_tenant_id);

  INSERT INTO audit.audit_events(tenant_id, actor_identity_id, actor_kind, action_key, resource_type, resource_id, correlation_id, outcome, metadata)
  VALUES (p_tenant_id, v_actor, 'user', 'platform.organization.bind_tenant', 'OrganizationTenant', p_tenant_id::text, v_correlation, 'success',
    jsonb_build_object('organizationId', p_organization_id, 'idempotencyKey', p_idempotency_key));

  INSERT INTO events.outbox_events(tenant_id, event_type, aggregate_type, aggregate_id, payload_version, payload, correlation_id)
  VALUES (p_tenant_id, 'platform.organization.tenant_bound', 'OrganizationTenant', p_tenant_id::text, 1,
    jsonb_build_object('organizationId', p_organization_id, 'tenantId', p_tenant_id), v_correlation);

  UPDATE platform.organization_tenant_binding_idempotency SET status = 'completed', completed_at = now() WHERE idempotency_key = p_idempotency_key;
  RETURN QUERY SELECT p_organization_id, p_tenant_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION security.resolve_active_organization_for_tenant(p_tenant_id uuid)
RETURNS TABLE (
  organization_id uuid,
  organization_slug text,
  organization_name text,
  organization_legal_name text,
  organization_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT o.id, o.slug, o.name, o.legal_name, o.status
  FROM platform.organization_tenants ot
  JOIN platform.organizations o ON o.id = ot.organization_id
  JOIN platform.tenants t ON t.id = ot.tenant_id
  WHERE ot.tenant_id = p_tenant_id AND o.status = 'active' AND t.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION security.resolve_active_organization_membership(p_organization_id uuid, p_identity_id uuid)
RETURNS TABLE (
  membership_id uuid,
  organization_id uuid,
  identity_id uuid,
  role_key text,
  membership_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
BEGIN
  IF v_actor IS NULL OR v_actor <> p_identity_id THEN
    RAISE EXCEPTION 'AIRENOS_IDENTITY_CONTEXT_MISMATCH' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT om.id, om.organization_id, om.identity_id, om.role_key, om.status
  FROM authz.organization_memberships om
  JOIN platform.organizations o ON o.id = om.organization_id
  WHERE om.organization_id = p_organization_id
    AND om.identity_id = p_identity_id
    AND om.status = 'active'
    AND o.status = 'active'
  LIMIT 1;
END;
$$;

ALTER FUNCTION security.platform_provision_organization(text,text,text,text) OWNER TO airen_control_plane_owner;
ALTER FUNCTION security.platform_bind_tenant_to_organization(text,uuid,uuid) OWNER TO airen_control_plane_owner;
ALTER FUNCTION security.resolve_active_organization_for_tenant(uuid) OWNER TO airen_control_plane_owner;
ALTER FUNCTION security.resolve_active_organization_membership(uuid,uuid) OWNER TO airen_control_plane_owner;
REVOKE CREATE ON SCHEMA security FROM airen_control_plane_owner;

REVOKE ALL ON FUNCTION security.platform_provision_organization(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.platform_bind_tenant_to_organization(text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.resolve_active_organization_for_tenant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.resolve_active_organization_membership(uuid,uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_control_plane, airen_app;
GRANT EXECUTE ON FUNCTION security.platform_provision_organization(text,text,text,text) TO airen_control_plane;
GRANT EXECUTE ON FUNCTION security.platform_bind_tenant_to_organization(text,uuid,uuid) TO airen_control_plane;
GRANT EXECUTE ON FUNCTION security.resolve_active_organization_for_tenant(uuid) TO airen_app, airen_control_plane;
GRANT EXECUTE ON FUNCTION security.resolve_active_organization_membership(uuid,uuid) TO airen_app, airen_control_plane;

COMMIT;
