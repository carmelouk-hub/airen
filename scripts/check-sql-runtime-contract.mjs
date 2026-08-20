import { readFile } from "node:fs/promises";
const core = await readFile("db/migrations/0001_foundation_runtime_core.sql", "utf8");
const context = await readFile("db/migrations/0002_request_context_contract.sql", "utf8");
const rls = await readFile("db/migrations/0003_foundation_rls.sql", "utf8");
for (const required of ["CREATE TABLE platform.tenants","CREATE TABLE platform.locations","CREATE TABLE platform.tenant_domains","CREATE UNIQUE INDEX uq_tenant_domains_hostname_ci","CREATE TABLE identity.identities","CREATE TABLE authz.tenant_memberships","CREATE TABLE authz.location_memberships","fk_location_memberships_membership_scope","fk_location_memberships_location_scope","CREATE TABLE audit.audit_events","CREATE TABLE events.outbox_events"]) if (!core.includes(required)) throw new Error(`Missing SQL runtime contract fragment: ${required}`);
if (/UNIQUE\s*\(\s*lower\s*\(/i.test(core)) throw new Error("Expression UNIQUE constraints must be implemented as indexes, not table UNIQUE syntax");
if (/default[_ -]?tenant/i.test(core)) throw new Error("Runtime core must not encode default-tenant fallback");
for (const setting of ["airen.identity_id","airen.tenant_id","airen.location_id","airen.correlation_id"]) if (!context.includes(setting)) throw new Error(`Missing request context setting: ${setting}`);
for (const policy of ["tenants_select_current","locations_tenant_all","tenant_domains_tenant_all","tenant_memberships_tenant_all","location_memberships_scope_all","audit_select_scope","audit_insert_scope","outbox_select_scope","outbox_insert_scope"]) if (!rls.includes(policy)) throw new Error(`Missing RLS policy: ${policy}`);
for (const table of ["platform.tenants","platform.locations","platform.tenant_domains","identity.identities","authz.tenant_memberships","authz.location_memberships","audit.audit_events","events.outbox_events"]) {
  if (!rls.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)) throw new Error(`RLS not enabled: ${table}`);
  if (!rls.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)) throw new Error(`RLS not forced: ${table}`);
}
console.log("SQL runtime + RLS static contract PASS");
