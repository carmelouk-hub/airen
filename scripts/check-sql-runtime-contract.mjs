import { readFile } from "node:fs/promises";
const core = await readFile("db/migrations/0001_foundation_runtime_core.sql", "utf8");
const context = await readFile("db/migrations/0002_request_context_contract.sql", "utf8");
for (const required of ["CREATE TABLE platform.tenants","CREATE TABLE platform.locations","CREATE TABLE platform.tenant_domains","CREATE UNIQUE INDEX uq_tenant_domains_hostname_ci","CREATE TABLE identity.identities","CREATE TABLE authz.tenant_memberships","CREATE TABLE authz.location_memberships","fk_location_memberships_membership_scope","fk_location_memberships_location_scope","CREATE TABLE audit.audit_events","CREATE TABLE events.outbox_events"]) if (!core.includes(required)) throw new Error(`Missing SQL runtime contract fragment: ${required}`);
if (/UNIQUE\s*\(\s*lower\s*\(/i.test(core)) throw new Error("Expression UNIQUE constraints must be implemented as indexes, not table UNIQUE syntax");
if (/default[_ -]?tenant/i.test(core)) throw new Error("Runtime core must not encode default-tenant fallback");
for (const setting of ["airen.identity_id","airen.tenant_id","airen.location_id","airen.correlation_id"]) if (!context.includes(setting)) throw new Error(`Missing request context setting: ${setting}`);
console.log("SQL runtime contract static check PASS");
