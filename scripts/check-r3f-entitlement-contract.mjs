import { readFile } from "node:fs/promises";
const parts=await Promise.all([
  "0019_r3f_entitlement_schema_authority.sql",
  "0020_r3f_entitlement_catalog_capability.sql",
  "0021_r3f_tenant_entitlement_lifecycle_capability.sql",
  "0022_r3f_entitlement_query_resolver_capabilities.sql"
].map((name)=>readFile(`db/migrations/${name}`,"utf8")));
const sql=parts.join("\n");
for(const required of [
  "ALTER TABLE billing.entitlement_catalog","ADD COLUMN status","ALTER TABLE billing.tenant_entitlements","ADD COLUMN source_ref","ADD COLUMN valid_from",
  "CREATE TABLE billing.entitlement_events","CREATE TABLE billing.entitlement_lifecycle_idempotency","platform.entitlements.read",
  "platform.entitlements.catalog.create","platform.entitlements.catalog.update","platform.entitlements.catalog.retire","platform.entitlements.grant",
  "platform.entitlements.revoke","platform.entitlements.expire","platform.entitlements.change_limit","platform.entitlements.change_config","platform.entitlements.change_validity",
  "security.r3f_assert_platform_permission","security.platform_mutate_entitlement_catalog","security.platform_mutate_tenant_entitlement",
  "security.platform_get_entitlement_catalog","security.platform_list_entitlement_catalog","security.platform_get_tenant_entitlement",
  "security.platform_list_tenant_entitlements","security.resolve_current_tenant_entitlements","OWNER TO airen_control_plane_owner"
]) if(!sql.includes(required)) throw new Error(`Missing R3-F Entitlement SQL contract fragment: ${required}`);
for(const table of ["billing.entitlement_events","billing.entitlement_lifecycle_idempotency"]){
  if(!sql.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)) throw new Error(`R3-F RLS not enabled: ${table}`);
  if(!sql.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)) throw new Error(`R3-F RLS not forced: ${table}`);
}
if(/DELETE\s+FROM\s+billing\.(?:entitlement_catalog|tenant_entitlements|entitlement_events)/i.test(sql)) throw new Error("R3-F must not hard-delete Entitlement catalog, grants or event history");
if(/ALTER\s+TABLE\s+billing\.tenant_entitlements[\s\S]{0,1200}source_kind[\s\S]{0,200}CHECK\s*\([^)]*source_kind/i.test(sql)) throw new Error("R3-F must not impose a retroactive closed source_kind enum on certified legacy rows");
if(/GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]{0,220}ON\s+billing\.(?:entitlement_catalog|tenant_entitlements|entitlement_events|entitlement_lifecycle_idempotency)[\s\S]{0,220}TO\s+(?:airen_control_plane|airen_app)\b/i.test(sql)) throw new Error("R3-F runtime invocation roles must not receive direct Entitlement DML grants");
if(!/REVOKE INSERT,UPDATE,DELETE ON billing\.entitlement_catalog,billing\.tenant_entitlements,billing\.entitlement_events,billing\.entitlement_lifecycle_idempotency FROM airen_control_plane/.test(sql)) throw new Error("R3-F must explicitly deny direct airen_control_plane Entitlement mutation");
if(!/REVOKE INSERT,UPDATE,DELETE ON billing\.entitlement_catalog,billing\.tenant_entitlements,billing\.entitlement_events,billing\.entitlement_lifecycle_idempotency FROM airen_app/.test(sql)) throw new Error("R3-F must explicitly deny direct airen_app Entitlement mutation");
if(!/GRANT EXECUTE ON FUNCTION security\.resolve_current_tenant_entitlements\(\) TO airen_app/.test(sql)) throw new Error("R3-F effective Tenant Entitlement resolution must use an explicit narrow airen_app capability");
if(/resolve_current_tenant_entitlements\s*\(\s*[^)]/i.test(sql)) throw new Error("R3-F Tenant resolver must not accept client tenant_id authority");
if(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+billing\.(?:plans|subscriptions|subscription_events|lifecycle_idempotency)/i.test(sql)) throw new Error("R3-F must not mutate R3-E Plan/Subscription state");
if(/CREATE\s+TABLE\s+(?:billing|platform)\.[a-z0-9_]*(?:feature|capabilit)/i.test(sql)) throw new Error("R3-F must not introduce Feature/Capability mapping tables; that belongs to R3-G");
if(/RAISE\s+EXCEPTION\s+'[^']*'\s*\|\|/i.test(sql)) throw new Error("R3-F PL/pgSQL RAISE must not concatenate directly after the exception literal; use USING MESSAGE");
console.log("R3-F Entitlement authority/effective-resolution static contract PASS");
