-- B44-FX-009 / 0003 Foundation RLS
BEGIN;

ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_select_current ON platform.tenants FOR SELECT USING (id = security.current_tenant_id());

ALTER TABLE platform.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.locations FORCE ROW LEVEL SECURITY;
CREATE POLICY locations_tenant_all ON platform.locations FOR ALL
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());

ALTER TABLE platform.tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_domains FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_domains_tenant_all ON platform.tenant_domains FOR ALL
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());

ALTER TABLE identity.identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.identities FORCE ROW LEVEL SECURITY;
CREATE POLICY identities_self_select ON identity.identities FOR SELECT USING (id = security.current_identity_id());

ALTER TABLE identity.provider_subject_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.provider_subject_links FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_subject_links_self_select ON identity.provider_subject_links FOR SELECT USING (identity_id = security.current_identity_id());

ALTER TABLE authz.platform_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.platform_role_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_roles_self_select ON authz.platform_role_assignments FOR SELECT USING (identity_id = security.current_identity_id());

ALTER TABLE authz.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_memberships_tenant_all ON authz.tenant_memberships FOR ALL
  USING (tenant_id = security.current_tenant_id())
  WITH CHECK (tenant_id = security.current_tenant_id());

ALTER TABLE authz.location_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.location_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY location_memberships_scope_all ON authz.location_memberships FOR ALL
  USING (
    tenant_id = security.current_tenant_id()
    AND (security.current_location_id() IS NULL OR location_id = security.current_location_id())
  )
  WITH CHECK (
    tenant_id = security.current_tenant_id()
    AND (security.current_location_id() IS NULL OR location_id = security.current_location_id())
  );

ALTER TABLE authz.membership_permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE authz.membership_permission_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_permission_grants_tenant_all ON authz.membership_permission_grants FOR ALL
  USING (EXISTS (
    SELECT 1 FROM authz.tenant_memberships tm
    WHERE tm.id = tenant_membership_id AND tm.tenant_id = security.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM authz.tenant_memberships tm
    WHERE tm.id = tenant_membership_id AND tm.tenant_id = security.current_tenant_id()
  ));

ALTER TABLE billing.tenant_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.tenant_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_entitlements_tenant_select ON billing.tenant_entitlements FOR SELECT
  USING (tenant_id = security.current_tenant_id());

ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_select_scope ON audit.audit_events FOR SELECT USING (
  tenant_id = security.current_tenant_id()
  AND (security.current_location_id() IS NULL OR location_id IS NULL OR location_id = security.current_location_id())
);
CREATE POLICY audit_insert_scope ON audit.audit_events FOR INSERT WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND (location_id IS NULL OR location_id = security.current_location_id())
  AND actor_identity_id = security.current_identity_id()
  AND correlation_id = security.current_correlation_id()
);

ALTER TABLE events.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events.outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_select_scope ON events.outbox_events FOR SELECT USING (
  tenant_id = security.current_tenant_id()
  AND (security.current_location_id() IS NULL OR location_id IS NULL OR location_id = security.current_location_id())
);
CREATE POLICY outbox_insert_scope ON events.outbox_events FOR INSERT WITH CHECK (
  tenant_id = security.current_tenant_id()
  AND (location_id IS NULL OR location_id = security.current_location_id())
  AND correlation_id = security.current_correlation_id()
);

COMMIT;
