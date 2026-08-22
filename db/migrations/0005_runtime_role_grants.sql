-- B44-FX-014 / Runtime group-role grants
-- Login principals are provisioned separately and may SET ROLE only after explicit membership grant.
BEGIN;

GRANT USAGE ON SCHEMA platform, identity, authz, billing, audit, events, security TO airen_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA security TO airen_app;
GRANT SELECT ON platform.tenants TO airen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.locations, platform.tenant_domains TO airen_app;
GRANT SELECT ON identity.identities, identity.provider_subject_links TO airen_app;
GRANT SELECT ON authz.platform_role_assignments, authz.permission_registry, authz.role_permission_grants TO airen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.tenant_memberships, authz.location_memberships, authz.membership_permission_grants TO airen_app;
GRANT SELECT ON billing.entitlement_catalog, billing.tenant_entitlements TO airen_app;
GRANT SELECT, INSERT ON audit.audit_events, events.outbox_events TO airen_app;

-- Authentication resolution stays behind the SECURITY DEFINER function; no direct identity-table grants.
GRANT USAGE ON SCHEMA security TO airen_auth;
GRANT EXECUTE ON FUNCTION security.resolve_authentication_identity(text, text) TO airen_auth;

COMMIT;
