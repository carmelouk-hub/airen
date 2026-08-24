import { readFile } from "node:fs/promises";

const correction = await readFile("db/migrations/0011_r3d_platform_role_admin_correction.sql","utf8");

for (const required of [
  "GRANT USAGE ON SCHEMA identity TO airen_control_plane_owner",
  "CREATE OR REPLACE FUNCTION security.platform_mutate_role_assignment",
  "AIRENOS_INVALID_PLATFORM_ROLE_STATE:revoke",
  "v_current_status IS NULL OR v_current_status NOT IN ('active','suspended')",
  "ALTER FUNCTION security.platform_mutate_role_assignment(text,text,uuid,text,text) OWNER TO airen_control_plane_owner",
  "GRANT EXECUTE ON FUNCTION security.platform_mutate_role_assignment(text,text,uuid,text,text) TO airen_control_plane"
]) {
  if (!correction.includes(required)) throw new Error(`Missing R3-D correction contract fragment: ${required}`);
}

if (/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,180}ON\s+(?:identity\.identities|authz\.platform_role_assignments|authz\.platform_protected_roles|authz\.platform_role_assignment_transitions|authz\.platform_role_lifecycle_idempotency)[\s\S]{0,180}TO\s+(?:airen_control_plane|airen_app)\b/i.test(correction)) {
  throw new Error("R3-D correction must not grant direct authority-table access to runtime invocation roles");
}

if (/DELETE\s+FROM\s+authz\.platform_role_assignments/i.test(correction)) {
  throw new Error("R3-D lifecycle correction must not hard-delete platform role assignments");
}

console.log("R3-D authority correction static contract PASS");
