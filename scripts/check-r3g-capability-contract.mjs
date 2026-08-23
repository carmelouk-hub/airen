import { readFile } from "node:fs/promises";

const migrations = [
  "0023_r3g_capability_feature_schema_authority.sql",
  "0024_r3g_capability_lifecycle_capability.sql",
  "0025_r3g_feature_flag_lifecycle_capabilities.sql",
  "0026_r3g_capability_query_resolver_capabilities.sql"
];
const parts = await Promise.all(migrations.map((name)=>readFile(`db/migrations/${name}`,"utf8")));
const sql = parts.join("\n");
const app = await readFile("packages/capabilities/src/index.ts","utf8");
const runtimeTest = await readFile("tests/postgres/r3g-capability-feature-resolution.test.ts","utf8");

for (const required of [
  "CREATE TABLE platform.capability_catalog",
  "CREATE TABLE platform.feature_flags",
  "CREATE TABLE platform.feature_flag_overrides",
  "CREATE TABLE platform.capability_events",
  "CREATE TABLE platform.capability_idempotency",
  "security.r3g_assert_platform_permission",
  "security.platform_mutate_capability",
  "security.platform_mutate_feature_flag",
  "security.platform_mutate_feature_flag_override",
  "security.platform_get_capability",
  "security.platform_list_capabilities",
  "security.platform_get_feature_flag",
  "security.platform_list_feature_flags",
  "security.platform_list_feature_flag_overrides",
  "security.resolve_current_capability_availability",
  "OWNER TO airen_control_plane_owner"
]) if (!sql.includes(required)) throw new Error(`Missing R3-G SQL contract fragment: ${required}`);

for (const permission of [
  "platform.capabilities.read","platform.capabilities.create","platform.capabilities.update","platform.capabilities.activate","platform.capabilities.retire",
  "platform.feature_flags.read","platform.feature_flags.create","platform.feature_flags.update","platform.feature_flags.retire","platform.feature_flags.set_default",
  "platform.feature_flags.set_override","platform.feature_flags.remove_override"
]) if (!sql.includes(permission)) throw new Error(`Missing R3-G Platform permission: ${permission}`);

for (const table of ["platform.feature_flags","platform.capability_catalog","platform.feature_flag_overrides","platform.capability_events","platform.capability_idempotency"]) {
  if (!sql.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)) throw new Error(`R3-G RLS not enabled: ${table}`);
  if (!sql.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)) throw new Error(`R3-G RLS not forced: ${table}`);
}

if (/DELETE\s+FROM\s+platform\.(?:capability_catalog|feature_flags|feature_flag_overrides|capability_events|capability_idempotency)/i.test(sql)) throw new Error("R3-G must preserve Capability/Feature lifecycle history; hard DELETE is forbidden");
if (/GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]{0,260}ON\s+platform\.(?:capability_catalog|feature_flags|feature_flag_overrides|capability_events|capability_idempotency)[\s\S]{0,260}TO\s+(?:airen_control_plane|airen_app)\b/i.test(sql)) throw new Error("R3-G runtime invocation roles must not receive direct lifecycle DML grants");
for (const role of ["airen_app","airen_control_plane"]) {
  if (!sql.includes(`REVOKE INSERT,UPDATE,DELETE ON platform.feature_flags,platform.capability_catalog,platform.feature_flag_overrides,platform.capability_events,platform.capability_idempotency FROM ${role}`)) throw new Error(`R3-G must explicitly revoke direct DML from ${role}`);
}
if (!/GRANT EXECUTE ON FUNCTION security\.resolve_current_capability_availability\(\) TO airen_app/.test(sql)) throw new Error("R3-G runtime resolver must expose only the zero-argument narrow airen_app capability");
if (/resolve_current_capability_availability\s*\(\s*[^)]/i.test(sql)) throw new Error("R3-G runtime resolver must not accept client Tenant/Location authority");
if (!sql.includes("security.resolve_current_tenant_entitlements()")) throw new Error("R3-G availability must consume the certified R3-F effective Entitlement resolver");
if (!sql.includes("NOT EXISTS(SELECT 1 FROM unnest(c.required_entitlements)")) throw new Error("R3-G must AND-check all required Entitlements");
if (!sql.includes("ORDER BY CASE WHEN o.subject_kind='location' THEN 0 ELSE 1 END")) throw new Error("R3-G override precedence must be deterministic: location > tenant > default");
if (!sql.includes("COALESCE(ov.enabled,ff.enabled_default)")) throw new Error("R3-G Feature Flag evaluation must fall back from valid override to default");
if (!sql.includes("o.status='active'")) throw new Error("R3-G resolver must ignore removed override history");
if (!sql.includes("status='removed'")) throw new Error("R3-G override removal must be logical/history-preserving");
if (/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+billing\.(?:plans|subscriptions|subscription_events|tenant_entitlements)/i.test(sql)) throw new Error("R3-G must not mutate R3-E/R3-F commercial or Entitlement state");
if (/RAISE\s+EXCEPTION\s+'[^']*'\s*\|\|/i.test(sql)) throw new Error("R3-G PL/pgSQL RAISE must not concatenate directly after the exception literal");
if (/corte\s+delle\s+stelle|cortedellestelle/i.test(sql + "\n" + app)) throw new Error("R3-G must not hardcode Corte delle Stelle or another real tenant");
if (/packages\/ristoairen|\.\.\/\.\.\/ristoairen/i.test(app)) throw new Error("packages/capabilities must remain platform-owned and independent from RISTOAIREN implementation code");
if (!/available\s*:\s*row\.available/.test(app) || !/authorized\s*,/.test(app) || !/allowed\s*:\s*row\.available\s*&&\s*authorized/.test(app)) throw new Error("R3-G application contract must keep available/authorized/allowed separate");
if (!app.includes("hasPermission")) throw new Error("R3-G actor authorization must consume the existing Permission authority rather than inventing a new role grant source");
for (let n=1;n<=26;n++) {
  const id=`R3G-T${String(n).padStart(2,"0")}`;
  if (!runtimeTest.includes(id)) throw new Error(`Missing mandatory runtime test marker ${id}`);
}
console.log("R3-G Capability/Feature authority and effective-resolution static contract PASS");
