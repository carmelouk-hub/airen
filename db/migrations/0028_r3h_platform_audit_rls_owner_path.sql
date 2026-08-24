-- R3-H / 0028 Platform Audit Query RLS owner-path correction
-- Keeps airen_control_plane NOBYPASSRLS and without direct table SELECT.
-- Grants only the SECURITY DEFINER owner a permission-gated RLS visibility path.
BEGIN;

CREATE POLICY r3h_audit_owner_select
ON audit.audit_events
FOR SELECT
TO airen_control_plane_owner
USING (
  EXISTS (
    SELECT 1
    FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind = 'platform'
     AND rpg.role_key = pra.role_key
     AND rpg.permission_key = 'platform.audit.read'
     AND rpg.effect = 'allow'
    WHERE pra.identity_id = NULLIF(current_setting('airen.identity_id', true), '')::uuid
      AND pra.status = 'active'
  )
);

CREATE POLICY r3h_location_owner_select
ON platform.locations
FOR SELECT
TO airen_control_plane_owner
USING (
  EXISTS (
    SELECT 1
    FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind = 'platform'
     AND rpg.role_key = pra.role_key
     AND rpg.permission_key = 'platform.audit.read'
     AND rpg.effect = 'allow'
    WHERE pra.identity_id = NULLIF(current_setting('airen.identity_id', true), '')::uuid
      AND pra.status = 'active'
  )
);

COMMIT;
