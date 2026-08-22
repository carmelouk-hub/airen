import { readFile } from "node:fs/promises";

const correction = await readFile("db/migrations/0013_r3d_platform_role_column_qualification_correction.sql","utf8");

for (const required of [
  "CREATE OR REPLACE FUNCTION security.platform_mutate_role_assignment",
  "UPDATE authz.platform_role_assignments AS pra SET status='suspended'",
  "UPDATE authz.platform_role_assignments AS pra SET status='active'",
  "UPDATE authz.platform_role_assignments AS pra SET status='revoked'",
  "WHERE pra.identity_id=p_target_identity_id AND pra.role_key=p_role_key",
  "RETURNING pra.status,pra.created_at,pra.updated_at",
  "ALTER FUNCTION security.platform_mutate_role_assignment(text,text,uuid,text,text) OWNER TO airen_control_plane_owner"
]) {
  if (!correction.includes(required)) throw new Error(`Missing R3-D qualification correction fragment: ${required}`);
}

const updateClauses = [...correction.matchAll(/UPDATE\s+authz\.platform_role_assignments\s+AS\s+pra\s+SET[\s\S]*?RETURNING\s+([^;]+?)\s+INTO/gi)];
if (updateClauses.length < 4) throw new Error("R3-D correction must qualify all governed role-assignment UPDATE branches");
if (updateClauses.some((match) => /(^|[^.])\brole_key\b/.test(match[1]))) throw new Error("R3-D role-assignment RETURNING clauses must use qualified columns");
if (/UPDATE\s+authz\.platform_role_assignments\s+(?!AS\s+pra)/i.test(correction)) throw new Error("R3-D role-assignment UPDATE must use explicit table alias");
if (/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,180}TO\s+(?:airen_control_plane|airen_app)\b/i.test(correction)) throw new Error("R3-D qualification correction must not alter runtime-role table authority");

console.log("R3-D role-assignment column qualification correction PASS");
