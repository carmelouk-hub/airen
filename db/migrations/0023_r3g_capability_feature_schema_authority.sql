-- R3-G / 0023 Capability and Feature Flag schema authority
BEGIN;

CREATE TABLE platform.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_flag_key text NOT NULL UNIQUE,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  enabled_default boolean NOT NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CONSTRAINT ck_r3g_feature_key CHECK (feature_flag_key = lower(feature_flag_key) AND feature_flag_key ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  CONSTRAINT ck_r3g_feature_window CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT ck_r3g_feature_retired CHECK ((status='active' AND retired_at IS NULL) OR (status='retired' AND retired_at IS NOT NULL))
);

CREATE TABLE platform.capability_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('tenant','location')),
  required_entitlements text[] NOT NULL DEFAULT ARRAY[]::text[],
  required_permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  feature_flag_key text,
  audit_level text NOT NULL DEFAULT 'standard' CHECK (audit_level IN ('standard','elevated','critical')),
  ai_access_mode text NOT NULL DEFAULT 'none' CHECK (ai_access_mode IN ('none','read','propose','governed_write')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  CONSTRAINT ck_r3g_capability_key CHECK (capability_key = lower(capability_key) AND capability_key ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  CONSTRAINT ck_r3g_capability_name CHECK (char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT ck_r3g_capability_state_markers CHECK (
    (status='draft' AND activated_at IS NULL AND retired_at IS NULL) OR
    (status='active' AND activated_at IS NOT NULL AND retired_at IS NULL) OR
    (status='retired' AND activated_at IS NOT NULL AND retired_at IS NOT NULL)
  )
);
CREATE INDEX idx_r3g_capability_status_key ON platform.capability_catalog(status,capability_key);

CREATE TABLE platform.feature_flag_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_flag_id uuid NOT NULL REFERENCES platform.feature_flags(id),
  subject_kind text NOT NULL CHECK (subject_kind IN ('tenant','location')),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid,
  enabled boolean NOT NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  reason_code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT ck_r3g_override_scope CHECK (
    (subject_kind='tenant' AND location_id IS NULL) OR
    (subject_kind='location' AND location_id IS NOT NULL)
  ),
  CONSTRAINT fk_r3g_override_location_scope FOREIGN KEY (tenant_id,location_id) REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT ck_r3g_override_window CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT ck_r3g_override_reason CHECK (reason_code ~ '^[a-z0-9][a-z0-9._:-]{2,63}$'),
  CONSTRAINT ck_r3g_override_removed CHECK ((status='active' AND removed_at IS NULL) OR (status='removed' AND removed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_r3g_active_tenant_override ON platform.feature_flag_overrides(feature_flag_id,tenant_id) WHERE subject_kind='tenant' AND status='active';
CREATE UNIQUE INDEX uq_r3g_active_location_override ON platform.feature_flag_overrides(feature_flag_id,tenant_id,location_id) WHERE subject_kind='location' AND status='active';
CREATE INDEX idx_r3g_override_tenant ON platform.feature_flag_overrides(tenant_id,status,updated_at DESC);

CREATE TABLE platform.capability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_kind text NOT NULL CHECK (resource_kind IN ('capability','feature_flag','feature_flag_override')),
  resource_key text NOT NULL,
  tenant_id uuid REFERENCES platform.tenants(id),
  location_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'capability_created','capability_updated','capability_activated','capability_retired',
    'feature_flag_created','feature_flag_updated','feature_flag_default_changed','feature_flag_retired',
    'feature_flag_override_set','feature_flag_override_removed'
  )),
  actor_identity_id uuid REFERENCES identity.identities(id),
  reason_code text NOT NULL,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_r3g_event_location_scope CHECK (location_id IS NULL OR tenant_id IS NOT NULL),
  CONSTRAINT fk_r3g_event_location_scope FOREIGN KEY (tenant_id,location_id) REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT ck_r3g_event_reason CHECK (reason_code ~ '^[a-z0-9][a-z0-9._:-]{2,63}$')
);
CREATE INDEX idx_r3g_events_resource ON platform.capability_events(resource_kind,resource_key,created_at DESC);
CREATE INDEX idx_r3g_events_tenant ON platform.capability_events(tenant_id,created_at DESC);

CREATE TABLE platform.capability_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  action_key text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('capability','feature_flag','feature_flag_override')),
  resource_key text NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_r3g_idem_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_r3g_idem_completed CHECK (status <> 'completed' OR (result IS NOT NULL AND completed_at IS NOT NULL))
);

ALTER TABLE platform.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.feature_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.capability_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.capability_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.feature_flag_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.feature_flag_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.capability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.capability_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.capability_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.capability_idempotency FORCE ROW LEVEL SECURITY;

REVOKE ALL ON platform.feature_flags,platform.capability_catalog,platform.feature_flag_overrides,platform.capability_events,platform.capability_idempotency FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE ON platform.feature_flags,platform.capability_catalog,platform.feature_flag_overrides,platform.capability_events,platform.capability_idempotency FROM airen_app;
REVOKE INSERT,UPDATE,DELETE ON platform.feature_flags,platform.capability_catalog,platform.feature_flag_overrides,platform.capability_events,platform.capability_idempotency FROM airen_control_plane;

INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES
  ('platform.capabilities.read','Read Capability catalog projections','high'),
  ('platform.capabilities.create','Create draft Capability definitions','critical'),
  ('platform.capabilities.update','Update draft Capability definitions','critical'),
  ('platform.capabilities.activate','Activate Capability definitions','critical'),
  ('platform.capabilities.retire','Retire Capability definitions','critical'),
  ('platform.feature_flags.read','Read Feature Flag and override projections','high'),
  ('platform.feature_flags.create','Create Feature Flags','critical'),
  ('platform.feature_flags.update','Update active Feature Flag metadata/window','critical'),
  ('platform.feature_flags.retire','Retire Feature Flags','critical'),
  ('platform.feature_flags.set_default','Change Feature Flag default rollout state','critical'),
  ('platform.feature_flags.set_override','Set Tenant/Location Feature Flag override','critical'),
  ('platform.feature_flags.remove_override','Remove Tenant/Location Feature Flag override','critical')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
SELECT 'platform','platform_admin',p.permission_key,'allow'
FROM authz.permission_registry p
WHERE p.permission_key IN (
  'platform.capabilities.read','platform.capabilities.create','platform.capabilities.update','platform.capabilities.activate','platform.capabilities.retire',
  'platform.feature_flags.read','platform.feature_flags.create','platform.feature_flags.update','platform.feature_flags.retire','platform.feature_flags.set_default',
  'platform.feature_flags.set_override','platform.feature_flags.remove_override'
)
ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow';

GRANT USAGE ON SCHEMA platform,billing,authz,audit,events,security TO airen_control_plane_owner;
GRANT SELECT ON platform.tenants,platform.locations TO airen_control_plane_owner;
GRANT SELECT ON billing.entitlement_catalog,billing.tenant_entitlements TO airen_control_plane_owner;
GRANT SELECT ON authz.permission_registry,authz.platform_role_assignments,authz.role_permission_grants TO airen_control_plane_owner;
GRANT SELECT,INSERT,UPDATE ON platform.feature_flags,platform.capability_catalog,platform.feature_flag_overrides,platform.capability_idempotency TO airen_control_plane_owner;
GRANT SELECT,INSERT ON platform.capability_events TO airen_control_plane_owner;
GRANT INSERT ON audit.audit_events,events.outbox_events TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.r3g_assert_platform_permission(p_permission text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key=p_permission AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_CAPABILITY_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
ALTER FUNCTION security.r3g_assert_platform_permission(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.r3g_assert_platform_permission(text) FROM PUBLIC;

COMMIT;
