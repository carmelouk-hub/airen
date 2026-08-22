import { readFile } from "node:fs/promises";
const schema = JSON.parse(await readFile("machine-context/foundation-schema-register.json", "utf8"));
const migrations = JSON.parse(await readFile("rebuild/migration/contracts/foundation-migration-contracts.json", "utf8"));
const designSql = await readFile("rebuild/migration/contracts/0001_foundation_contract.design.sql", "utf8");
const runtimeSql = await readFile("db/migrations/0001_foundation_runtime_core.sql", "utf8");
const schemaRows = Array.isArray(schema) ? schema : schema.tables ?? schema.rows ?? schema.contracts ?? [];
const migrationRows = Array.isArray(migrations) ? migrations : migrations.contracts ?? migrations.rows ?? [];
const serialized = JSON.stringify(schemaRows);
for (const table of ["platform.tenants","platform.locations","platform.tenant_domains","identity.identities","authz.tenant_memberships","authz.location_memberships","audit.audit_events","events.outbox_events","migration.id_map"]) {
  if (!serialized.includes(table)) throw new Error(`Missing Foundation schema register contract: ${table}`);
  if (!designSql.toLowerCase().includes(table.toLowerCase())) throw new Error(`Missing B44-FX-006 design SQL lineage: ${table}`);
}
for (const table of ["platform.tenants","platform.locations","platform.tenant_domains","identity.identities","authz.tenant_memberships","authz.location_memberships","audit.audit_events","events.outbox_events"]) {
  if (!runtimeSql.toLowerCase().includes(table.toLowerCase())) throw new Error(`Missing Runtime Slice 1 SQL contract: ${table}`);
}
if (migrationRows.length < 30) throw new Error(`Expected at least 30 migration contracts, found ${migrationRows.length}`);
console.log("Foundation contract check PASS: design lineage preserved and Runtime Slice 1 covered");
