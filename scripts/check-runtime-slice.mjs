import { readFile } from "node:fs/promises";
const core = await readFile("db/migrations/0001_foundation_runtime_core.sql", "utf8");
const source = await readFile("packages/tenant/src/index.ts", "utf8");
for (const invariant of [
  "fk_tenant_domains_location_scope",
  "fk_location_memberships_membership_scope",
  "fk_location_memberships_location_scope",
  "fk_audit_location_scope",
  "fk_outbox_location_scope",
]) if (!core.includes(invariant)) throw new Error(`Missing runtime invariant: ${invariant}`);
if (!source.includes("trusted-platform-subdomain") || !source.includes("Hostname is not registered for any tenant")) throw new Error("Fail-closed tenant routing contract missing");
console.log("Runtime slice contract PASS");
