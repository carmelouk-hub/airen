import { readFile } from "node:fs/promises";

const correction = await readFile("db/migrations/0012_r3d_platform_role_identity_read_correction.sql","utf8");

for (const required of [
  "CREATE OR REPLACE FUNCTION security.platform_mutate_role_assignment",
  "SELECT i.status INTO v_target_identity_status FROM identity.identities i WHERE i.id=p_target_identity_id;",
  "ALTER FUNCTION security.platform_mutate_role_assignment(text,text,uuid,text,text) OWNER TO airen_control_plane_owner",
  "GRANT EXECUTE ON FUNCTION security.platform_mutate_role_assignment(text,text,uuid,text,text) TO airen_control_plane"
]) {
  if (!correction.includes(required)) throw new Error(`Missing R3-D Identity-read correction fragment: ${required}`);
}

if (/identity\.identities[\s\S]{0,120}\bFOR\s+(?:SHARE|UPDATE)\b/i.test(correction)) {
  throw new Error("R3-D Identity status validation must remain a non-locking SELECT-only read");
}

if (/GRANT\s+(?:UPDATE|INSERT|DELETE)[\s\S]{0,120}ON\s+identity\.identities[\s\S]{0,120}TO\s+airen_control_plane_owner\b/i.test(correction)) {
  throw new Error("R3-D must not expand the capability owner to Identity mutation authority");
}

if (/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,180}ON\s+(?:identity\.identities|authz\.platform_role_assignments|authz\.platform_protected_roles|authz\.platform_role_assignment_transitions|authz\.platform_role_lifecycle_idempotency)[\s\S]{0,180}TO\s+(?:airen_control_plane|airen_app)\b/i.test(correction)) {
  throw new Error("R3-D correction must not grant direct authority-table access to runtime invocation roles");
}

console.log("R3-D SELECT-only Identity validation correction PASS");
