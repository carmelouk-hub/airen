-- R3-H / 0029 Reconcile superseded owner-path policies
-- Foundation already defines airen_control_plane_owner as BYPASSRLS.
-- 0028 policies were diagnostic and are therefore removed; the narrow SECURITY DEFINER
-- function remains independently permission-gated and airen_control_plane retains no direct SELECT.
BEGIN;

DROP POLICY IF EXISTS r3h_audit_owner_select ON audit.audit_events;
DROP POLICY IF EXISTS r3h_location_owner_select ON platform.locations;

COMMIT;
