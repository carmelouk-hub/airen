import { readFile } from "node:fs/promises";

const schema = JSON.parse(await readFile("machine-context/foundation-schema-register.json", "utf8"));
const migration = JSON.parse(await readFile("rebuild/migration/contracts/foundation-migration-contracts.json", "utf8"));
const sql = await readFile("db/migrations/0001_foundation_contract.sql", "utf8");

const requiredTables = [
  "platform.tenants",
  "platform.locations",
  "platform.tenant_domains",
  "identity.identities",
  "authz.tenant_memberships",
  "authz.location_memberships",
  "audit.audit_events",
  "events.outbox_events",
  "migration.id_map",
];

const schemaRows = Array.isArray(schema) ? schema : schema.tables ?? schema.rows ?? schema.contracts ?? [];
const migrationRows = Array.isArray(migration) ? migration : migration.contracts ?? migration.rows ?? [];
const serialized = JSON.stringify(schemaRows);
for (const table of requiredTables) {
  if (!serialized.includes(table)) throw new Error(`Missing Foundation schema contract: ${table}`);
  if (!sql.toLowerCase().includes(table.toLowerCase())) throw new Error(`Missing SQL contract for: ${table}`);
}

if (migrationRows.length < 30) throw new Error(`Expected at least 30 migration contracts, found ${migrationRows.length}`);
if (/default[_ -]?tenant fallback/i.test(sql)) throw new Error("SQL must not implement default-tenant fallback");
if (/stripe_webhook_secret/i.test(sql)) throw new Error("Provider webhook secret must not live in Foundation operational schema");
console.log("Foundation contract check PASS");
