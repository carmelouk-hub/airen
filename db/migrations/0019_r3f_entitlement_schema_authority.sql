-- R3-F / 0019 Entitlement schema evolution, authority and shared permission capability
BEGIN;

ALTER TABLE billing.entitlement_catalog
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN retired_at timestamptz;

ALTER TABLE billing.entitlement_catalog
  ADD CONSTRAINT ck_entitlement_catalog_retired_at CHECK (
    (status='active' AND retired_at IS NULL) OR (status='retired' AND retired_at IS NOT NULL)
  );

ALTER TABLE billing.tenant_entitlements
  ADD COLUMN source_ref text,
  ADD COLUMN valid_from timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN expired_at timestamptz;

ALTER TABLE billing.tenant_entitlements
  ADD CONSTRAINT ck_tenant_entitlements_source_ref_length CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 255),
  ADD CONSTRAINT ck_tenant_entitlements_terminal_markers CHECK (NOT (revoked_at IS NOT NULL AND expired_at IS NOT NULL));

CREATE TABLE billing.entitlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  entitlement_key text NOT NULL REFERENCES billing.entitlement_catalog(entitlement_key),
  event_type text NOT NULL CHECK (event_type IN ('granted','regranted','revoked','expired','limit_changed','config_changed','validity_changed')),
  from_state text CHECK (from_state IS NULL OR from_state IN ('scheduled','effective','revoked','expired','inactive')),
  to_state text NOT NULL CHECK (to_state IN ('scheduled','effective','revoked','expired','inactive')),
  effective_at timestamptz NOT NULL,
  actor_identity_id uuid REFERENCES identity.identities(id),
  reason_code text NOT NULL,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_entitlement_event_reason CHECK (reason_code ~ '^[a-z0-9][a-z0-9._:-]{2,63}$')
);
CREATE INDEX idx_entitlement_events_tenant_created ON billing.entitlement_events(tenant_id,created_at DESC);
CREATE INDEX idx_entitlement_events_key_created ON billing.entitlement_events(entitlement_key,created_at DESC);

CREATE TABLE billing.entitlement_lifecycle_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  action_key text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('catalog','tenant_entitlement')),
  tenant_id uuid,
  entitlement_key text NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_entitlement_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_entitlement_idempotency_tenant_scope CHECK ((resource_kind='catalog' AND tenant_id IS NULL) OR (resource_kind='tenant_entitlement' AND tenant_id IS NOT NULL)),
  CONSTRAINT ck_entitlement_idempotency_completed CHECK (status <> 'completed' OR (result IS NOT NULL AND completed_at IS NOT NULL))
);

ALTER TABLE billing.entitlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.entitlement_events FORCE ROW LEVEL SECURITY;
ALTER TABLE billing.entitlement_lifecycle_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.entitlement_lifecycle_idempotency FORCE ROW LEVEL SECURITY;

REVOKE ALL ON billing.entitlement_events,billing.entitlement_lifecycle_idempotency FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE ON billing.entitlement_catalog,billing.tenant_entitlements,billing.entitlement_events,billing.entitlement_lifecycle_idempotency FROM airen_app;
REVOKE INSERT,UPDATE,DELETE ON billing.entitlement_catalog,billing.tenant_entitlements,billing.entitlement_events,billing.entitlement_lifecycle_idempotency FROM airen_control_plane;

INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES
  ('platform.entitlements.read','Read Entitlement catalog and Tenant Entitlement projections','high'),
  ('platform.entitlements.catalog.create','Create Entitlement catalog entries','critical'),
  ('platform.entitlements.catalog.update','Update active Entitlement catalog description','critical'),
  ('platform.entitlements.catalog.retire','Retire Entitlement catalog entries','critical'),
  ('platform.entitlements.grant','Grant or regrant Tenant Entitlements','critical'),
  ('platform.entitlements.revoke','Revoke Tenant Entitlements','critical'),
  ('platform.entitlements.expire','Finalize Tenant Entitlement expiration','critical'),
  ('platform.entitlements.change_limit','Change Tenant Entitlement limits','critical'),
  ('platform.entitlements.change_config','Change Tenant Entitlement config','critical'),
  ('platform.entitlements.change_validity','Change Tenant Entitlement validity','critical')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
SELECT 'platform','platform_admin',p.permission_key,'allow'
FROM authz.permission_registry p
WHERE p.permission_key IN (
  'platform.entitlements.read','platform.entitlements.catalog.create','platform.entitlements.catalog.update','platform.entitlements.catalog.retire',
  'platform.entitlements.grant','platform.entitlements.revoke','platform.entitlements.expire','platform.entitlements.change_limit',
  'platform.entitlements.change_config','platform.entitlements.change_validity'
)
ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow';

GRANT USAGE ON SCHEMA billing,platform,authz,audit,events,security TO airen_control_plane_owner;
GRANT SELECT ON platform.tenants TO airen_control_plane_owner;
GRANT SELECT ON authz.platform_role_assignments,authz.role_permission_grants TO airen_control_plane_owner;
GRANT SELECT,INSERT,UPDATE ON billing.entitlement_catalog,billing.tenant_entitlements,billing.entitlement_lifecycle_idempotency TO airen_control_plane_owner;
GRANT SELECT,INSERT ON billing.entitlement_events TO airen_control_plane_owner;
GRANT INSERT ON audit.audit_events,events.outbox_events TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.r3f_assert_platform_permission(p_permission text)
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
    SELECT 1
    FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key=p_permission AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_ENTITLEMENT_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
ALTER FUNCTION security.r3f_assert_platform_permission(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.r3f_assert_platform_permission(text) FROM PUBLIC;

COMMIT;
