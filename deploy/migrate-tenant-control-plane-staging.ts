import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { AppError } from "../packages/shared-contracts/src/index.ts";

const RUNTIME_LOGIN = "airenos_tenant_runtime_f57";
const RUNTIME_URL_FILE = "/tmp/airenos-tenant-runtime-url";
const MIGRATIONS = Object.freeze([
  "0001_foundation_runtime_core.sql",
  "0002_request_context_contract.sql",
  "0003_foundation_rls.sql",
  "0004_authentication_bootstrap.sql",
  "0005_runtime_role_grants.sql",
  "0006_r3a_tenant_provisioning.sql",
  "0007_r3a_tenant_lifecycle.sql",
  "0008_r3b_location_lifecycle.sql",
  "0009_r3c_tenant_domain_lifecycle.sql",
  "0010_r3d_platform_role_admin.sql",
  "0011_r3d_platform_role_admin_correction.sql",
  "0012_r3d_platform_role_identity_read_correction.sql",
  "0013_r3d_platform_role_column_qualification_correction.sql",
  "0036_aos_nova_tenant_read_claim_bridge.sql",
]);

function emitPhase(phase: string, detail?: string): void {
  process.stdout.write(`${JSON.stringify({ event: "airenos.tenant_control_plane.migration_phase", phase, ...(detail ? { detail } : {}) })}\n`);
}

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required Tenant Control Plane migration field: ${key}`, { field: key });
  return value;
}

function migrationBody(source: string): string {
  const trimmed = source.trim();
  const withoutBegin = trimmed.replace(/^BEGIN;\s*/i, "");
  return withoutBegin.replace(/\s*COMMIT;\s*$/i, "");
}

function checksum(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function runtimeUrl(adminUrl: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = RUNTIME_LOGIN;
  url.password = password;
  return url.toString();
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS public.airenos_tenant_schema_migrations (
    filename text PRIMARY KEY,
    checksum_sha256 char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
}

async function applyMigration(client: Client, filename: string): Promise<void> {
  emitPhase("migration", filename);
  const path = resolve("db/migrations", filename);
  const source = await readFile(path, "utf8");
  const digest = checksum(source);
  const existing = await client.query<{ checksum_sha256: string }>(
    "SELECT checksum_sha256 FROM public.airenos_tenant_schema_migrations WHERE filename=$1",
    [filename],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].checksum_sha256 !== digest) throw new AppError("CONFLICT", "Tenant migration checksum mismatch", { filename });
    return;
  }
  await client.query("BEGIN");
  try {
    await client.query(migrationBody(source));
    await client.query("INSERT INTO public.airenos_tenant_schema_migrations(filename,checksum_sha256) VALUES($1,$2)", [filename, digest]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function provisionRuntimePrincipal(client: Client, adminUrl: string): Promise<void> {
  emitPhase("runtime_principal");
  const password = randomBytes(36).toString("base64url");
  const exists = await client.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS exists", [RUNTIME_LOGIN]);
  if (exists.rows[0]?.exists) {
    await client.query(`ALTER ROLE ${RUNTIME_LOGIN} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  } else {
    await client.query(`CREATE ROLE ${RUNTIME_LOGIN} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  }
  await client.query(`REVOKE airen_control_plane_owner, airen_app, airen_auth FROM ${RUNTIME_LOGIN}`);
  await client.query(`GRANT airen_control_plane TO ${RUNTIME_LOGIN} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
  const proof = await client.query<{ superuser: boolean; createdb: boolean; createrole: boolean; inherit: boolean; bypassrls: boolean; control_plane: boolean; owner: boolean }>(`
    SELECT r.rolsuper AS superuser, r.rolcreatedb AS createdb, r.rolcreaterole AS createrole, r.rolinherit AS inherit, r.rolbypassrls AS bypassrls,
      pg_has_role(r.oid, 'airen_control_plane', 'MEMBER') AS control_plane,
      pg_has_role(r.oid, 'airen_control_plane_owner', 'MEMBER') AS owner
    FROM pg_roles r WHERE r.rolname=$1`, [RUNTIME_LOGIN]);
  const row = proof.rows[0];
  if (!row || row.superuser || row.createdb || row.createrole || row.inherit || row.bypassrls || !row.control_plane || row.owner) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Tenant runtime database principal failed least-privilege proof");
  }
  await writeFile(RUNTIME_URL_FILE, runtimeUrl(adminUrl, password), { encoding: "utf8", mode: 0o600 });
  await chmod(RUNTIME_URL_FILE, 0o600);
}

export async function migrateTenantControlPlaneStaging(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const adminUrl = required(environment, "CONTROL_PLANE_ADMIN_DATABASE_URL");
  const bootstrap = await readFile(resolve("db/bootstrap/0000_runtime_roles.sql"), "utf8");
  emitPhase("connect");
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  emitPhase("connected");
  try {
    emitPhase("bootstrap_roles");
    await client.query(bootstrap);
    emitPhase("migration_ledger");
    await ensureLedger(client);
    for (const filename of MIGRATIONS) await applyMigration(client, filename);
    await provisionRuntimePrincipal(client, adminUrl);
    process.stdout.write(`${JSON.stringify({ event: "airenos.tenant_control_plane.migration_complete", migrationCount: MIGRATIONS.length, runtimeLogin: RUNTIME_LOGIN, secretMaterialEmitted: false })}\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("deploy/migrate-tenant-control-plane-staging.ts")) {
  migrateTenantControlPlaneStaging().catch((error: unknown) => {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    process.stderr.write(`${JSON.stringify({ event: "airenos.tenant_control_plane.migration_failed", errorCode: code })}\n`);
    process.exitCode = 1;
  });
}
