\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airen_app') THEN
    CREATE ROLE airen_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airen_auth') THEN
    CREATE ROLE airen_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA platform, identity, authz, billing, audit, events, security TO airen_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA security TO airen_app;
GRANT SELECT ON platform.tenants TO airen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.locations, platform.tenant_domains TO airen_app;
GRANT SELECT ON identity.identities, identity.provider_subject_links TO airen_app;
GRANT SELECT ON authz.platform_role_assignments, authz.permission_registry, authz.role_permission_grants TO airen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON authz.tenant_memberships, authz.location_memberships, authz.membership_permission_grants TO airen_app;
GRANT SELECT ON billing.entitlement_catalog, billing.tenant_entitlements TO airen_app;
GRANT SELECT, INSERT ON audit.audit_events, events.outbox_events TO airen_app;

-- airen_auth intentionally receives no direct table privileges.
GRANT USAGE ON SCHEMA security TO airen_auth;
