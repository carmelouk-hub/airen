import { readFile } from "node:fs/promises";

const sql=await readFile("db/migrations/0027_r3h_platform_audit_query.sql","utf8");
const rlsCorrection=await readFile("db/migrations/0028_r3h_platform_audit_rls_owner_path.sql","utf8");
const app=await readFile("packages/audit-events/src/index.ts","utf8");
const adapter=await readFile("packages/persistence-postgres/src/audit-query-control-plane.ts","utf8");
const runtimeTest=await readFile("tests/postgres/r3h-platform-audit-query.test.ts","utf8");


for(const required of [
  "CREATE POLICY r3h_audit_owner_select",
  "ON audit.audit_events",
  "TO airen_control_plane_owner",
  "CREATE POLICY r3h_location_owner_select",
  "ON platform.locations",
  "platform.audit.read",
  "current_setting('airen.identity_id', true)"
]) if(!rlsCorrection.includes(required)) throw new Error(`Missing R3-H permission-gated RLS owner-path fragment: ${required}`);
if(/\bBYPASSRLS\b/i.test(rlsCorrection)) throw new Error("R3-H correction must not introduce BYPASSRLS");
if(/GRANT\s+SELECT\s+ON\s+audit\.audit_events\s+TO\s+airen_control_plane\b/i.test(rlsCorrection)) throw new Error("R3-H correction must not grant direct Audit SELECT to airen_control_plane");
if(/CREATE\s+TABLE/i.test(rlsCorrection)) throw new Error("R3-H RLS correction must not create tables");
if(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|TABLE\s+)?audit\.audit_events\b/i.test(rlsCorrection)) throw new Error("R3-H RLS correction must remain read-only");

for(const required of [
  "platform.audit.read",
  "security.r3h_assert_platform_audit_read",
  "security.r3h_sanitize_audit_metadata",
  "security.platform_query_audit_events",
  "SECURITY DEFINER",
  "ORDER BY ae.created_at DESC,ae.id DESC",
  "LIMIT p_limit + 1",
  "interval '31 days'",
  "metadata_size_limit",
  "OWNER TO airen_control_plane_owner",
  "TO airen_control_plane"
]) if(!sql.includes(required)) throw new Error(`Missing R3-H SQL contract fragment: ${required}`);

if(/CREATE\s+TABLE\s+(?:audit\.)?audit_events/i.test(sql)) throw new Error("R3-H must query the existing audit.audit_events authority, not create a second Audit table");
if(/\bOFFSET\b/i.test(sql)) throw new Error("R3-H pagination must be keyset-only; OFFSET is forbidden");
if(!sql.includes("(ae.created_at,ae.id) < (p_cursor_created_at,p_cursor_id)")) throw new Error("R3-H keyset cursor must use the deterministic created_at/id pair");
if(/GRANT\s+SELECT\s+ON\s+audit\.audit_events\s+TO\s+airen_control_plane\b/i.test(sql)) throw new Error("airen_control_plane must not receive direct SELECT on Audit history");
if(!sql.includes("REVOKE SELECT ON audit.audit_events FROM airen_control_plane")) throw new Error("R3-H must explicitly preserve direct SELECT denial for airen_control_plane");
if(/\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:TABLE\s+)?audit\.audit_events\b/i.test(sql)) throw new Error("R3-H must not expose Audit history mutation");
if(/INSERT\s+INTO\s+audit\.audit_events/i.test(sql)) throw new Error("R3-H query execution must not append Audit rows");
if(/INSERT\s+INTO\s+events\.outbox_events/i.test(sql)) throw new Error("R3-H query execution must not append Outbox rows");
if(/identity\.(?:identities|provider_subject_links)/i.test(sql)) throw new Error("R3-H Platform Audit query must not join identity/PII sources");
if(/metadata\s*(?:->|@>|#>|#>>)|jsonb_path/i.test(sql)) throw new Error("R3-H must not add metadata filtering/query semantics");
for(const blocked of ["password","passwd","pwd","otp","jwt","cookie","authorization","api_key","apikey","access_token","refresh_token","session_token","id_token","webhook_secret","client_secret","secret","cvv","cvc","pan","card_number","_token","_secret","_password"]){
  if(!sql.includes(blocked)) throw new Error(`Missing R3-H metadata redaction contract: ${blocked}`);
}
if(!sql.includes("p_location_id IS NOT NULL AND p_tenant_id IS NULL")) throw new Error("R3-H location filter must require tenantId");
if(!sql.includes("l.id=p_location_id AND l.tenant_id=p_tenant_id")) throw new Error("R3-H DB must validate Location ownership against Tenant");
if(!sql.includes("ae.created_at >= p_created_from")||!sql.includes("ae.created_at < p_created_until")) throw new Error("R3-H time window must be [from,until)");
if(!sql.includes("p_limit NOT BETWEEN 1 AND 100")) throw new Error("R3-H DB limit must be 1..100");
if(!sql.includes("('platform','platform_admin','platform.audit.read','allow')")) throw new Error("R3-H default Platform permission seed must be platform_admin only");
if(/security_auditor/i.test(sql+app+adapter)) throw new Error("R3-H must not create or special-case a future security_auditor role");
if(/corte\s+delle\s+stelle|cortedellestelle/i.test(sql+app+adapter)) throw new Error("R3-H must not hardcode Corte delle Stelle");
if(/packages\/ristoairen|\.\.\/\.\.\/ristoairen/i.test(app+adapter)) throw new Error("R3-H Audit authority must remain platform-owned");


for(const required of [
  "CREATE POLICY r3h_audit_owner_select",
  "ON audit.audit_events",
  "TO airen_control_plane_owner",
  "CREATE POLICY r3h_location_owner_select",
  "ON platform.locations",
  "platform.audit.read",
  "current_setting('airen.identity_id', true)"
]) if(!rlsCorrection.includes(required)) throw new Error(`Missing R3-H permission-gated RLS owner-path fragment: ${required}`);
if(/\bBYPASSRLS\b/i.test(rlsCorrection)) throw new Error("R3-H correction must not introduce BYPASSRLS");
if(/GRANT\s+SELECT\s+ON\s+audit\.audit_events\s+TO\s+airen_control_plane\b/i.test(rlsCorrection)) throw new Error("R3-H correction must not grant direct Audit SELECT to airen_control_plane");
if(/CREATE\s+TABLE/i.test(rlsCorrection)) throw new Error("R3-H RLS correction must not create tables");
if(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|TABLE\s+)?audit\.audit_events\b/i.test(rlsCorrection)) throw new Error("R3-H RLS correction must remain read-only");

for(const required of [
  "platform.audit.read","31 * 24 * 60 * 60 * 1000","limit<1 || limit>100",
  "locationId requires tenantId","base64url","fingerprint","createdAt","cursorId"
]) if(!app.includes(required)) throw new Error(`Missing R3-H application contract fragment: ${required}`);
if(!adapter.includes("SET LOCAL ROLE")||!adapter.includes("security.platform_query_audit_events")) throw new Error("R3-H PostgreSQL adapter must invoke the narrow control-plane capability under SET LOCAL ROLE");
if(/SELECT\s+.+FROM\s+audit\.audit_events/is.test(adapter)) throw new Error("R3-H adapter must not query audit.audit_events directly");

for(let n=1;n<=26;n++){
  const id=`R3H-T${String(n).padStart(2,"0")}`;
  if(!runtimeTest.includes(id)) throw new Error(`Missing mandatory runtime test marker ${id}`);
}
console.log("R3-H Platform Audit Query authority, pagination and sanitization static contract PASS");
