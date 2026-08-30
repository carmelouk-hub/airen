import { createHmac } from "node:crypto";
import { Pool } from "pg";
import { AppError } from "../packages/shared-contracts/src/index.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export type KairosRuntimeDatabaseConfig = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  seed: string;
}>;

const FIELD = Object.freeze({
  host: "KAIROS_RUNTIME_DB_HOST",
  port: "KAIROS_RUNTIME_DB_PORT",
  database: "KAIROS_RUNTIME_DB_NAME",
  user: "KAIROS_RUNTIME_DB_USER",
  seed: "KAIROS_RUNTIME_DB_SEED",
});

function fail(message: string, field: string): never {
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", message, { field });
}

function present(environment: EnvironmentInput, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value || undefined;
}

export function loadKairosRuntimeDatabaseConfig(environment: EnvironmentInput): KairosRuntimeDatabaseConfig | undefined {
  const raw = {
    host: present(environment, FIELD.host),
    port: present(environment, FIELD.port),
    database: present(environment, FIELD.database),
    user: present(environment, FIELD.user),
    seed: present(environment, FIELD.seed),
  };
  if (!Object.values(raw).some(Boolean)) return undefined;
  for (const [name, value] of Object.entries(raw)) {
    if (!value) fail(`Incomplete Kairos runtime database configuration: missing ${FIELD[name as keyof typeof FIELD]}`, FIELD[name as keyof typeof FIELD]);
  }
  if (!/^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/.test(raw.host!)) fail("KAIROS_RUNTIME_DB_HOST is not a valid private DNS host", FIELD.host);
  if (!/^\d+$/.test(raw.port!)) fail("KAIROS_RUNTIME_DB_PORT must be an integer", FIELD.port);
  const port = Number(raw.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) fail("KAIROS_RUNTIME_DB_PORT is outside the permitted range", FIELD.port);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(raw.database!)) fail("KAIROS_RUNTIME_DB_NAME must be a PostgreSQL identifier", FIELD.database);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(raw.user!)) fail("KAIROS_RUNTIME_DB_USER must be a PostgreSQL identifier", FIELD.user);
  if (raw.seed!.length < 32 || raw.seed!.length > 512) fail("KAIROS_RUNTIME_DB_SEED must contain at least 32 and at most 512 characters", FIELD.seed);
  return Object.freeze({ host: raw.host!, port, database: raw.database!, user: raw.user!, seed: raw.seed! });
}

export function deriveKairosRuntimeDatabasePassword(config: KairosRuntimeDatabaseConfig): string {
  const scope = `airenos/kairos/k4/postgres-runtime/v1\0${config.user}\0${config.host}\0${config.port}\0${config.database}`;
  return createHmac("sha256", config.seed).update(scope).digest("base64url");
}

export function buildKairosRuntimeDatabaseUrl(config: KairosRuntimeDatabaseConfig): string {
  const url = new URL("postgresql://localhost");
  url.hostname = config.host;
  url.port = String(config.port);
  url.username = config.user;
  url.password = deriveKairosRuntimeDatabasePassword(config);
  url.pathname = `/${config.database}`;
  return url.toString();
}

export function materializeKairosRuntimeDatabaseUrl(environment: EnvironmentInput): string | undefined {
  const config = loadKairosRuntimeDatabaseConfig(environment);
  return config ? buildKairosRuntimeDatabaseUrl(config) : undefined;
}

export async function provisionKairosRuntimeDatabasePrincipal(adminConnectionString: string, environment: EnvironmentInput): Promise<boolean> {
  const config = loadKairosRuntimeDatabaseConfig(environment);
  if (!config) {
    process.stdout.write(`${JSON.stringify({ event: "kairos.migration.runtime_principal.skip", reason: "not_configured" })}\n`);
    return false;
  }
  const password = deriveKairosRuntimeDatabasePassword(config);
  const pool = new Pool({ connectionString: adminConnectionString, max: 1, application_name: "airenos-kairos-runtime-principal-provisioning" });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('airenos-kairos-runtime-principal-provisioning'))");
    const existing = await client.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS exists", [config.user]);
    const verb = existing.rows[0]?.exists ? "ALTER" : "CREATE";
    await client.query(`${verb} ROLE ${config.user} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    await client.query(`REVOKE airen_control_plane_owner FROM ${config.user}`);
    await client.query(`GRANT airen_app TO ${config.user} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
    await client.query(`GRANT airen_auth TO ${config.user} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
    await client.query(`GRANT airen_control_plane TO ${config.user} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);

    const verification = await client.query<{
      rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolinherit: boolean; rolreplication: boolean; rolbypassrls: boolean;
      app_member: boolean; auth_member: boolean; control_plane_member: boolean; owner_member: boolean;
    }>(`SELECT r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolinherit,r.rolreplication,r.rolbypassrls,
        pg_has_role(r.oid,(SELECT oid FROM pg_roles WHERE rolname='airen_app'),'MEMBER') AS app_member,
        pg_has_role(r.oid,(SELECT oid FROM pg_roles WHERE rolname='airen_auth'),'MEMBER') AS auth_member,
        pg_has_role(r.oid,(SELECT oid FROM pg_roles WHERE rolname='airen_control_plane'),'MEMBER') AS control_plane_member,
        pg_has_role(r.oid,(SELECT oid FROM pg_roles WHERE rolname='airen_control_plane_owner'),'MEMBER') AS owner_member
      FROM pg_roles r WHERE r.rolname=$1`, [config.user]);
    const role = verification.rows[0];
    if (!role || !role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolinherit || role.rolreplication || role.rolbypassrls || !role.app_member || !role.auth_member || !role.control_plane_member || role.owner_member) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Kairos runtime database principal does not match least-privilege contract", { field: FIELD.user, principal: config.user });
    }
    process.stdout.write(`${JSON.stringify({ event: "kairos.migration.runtime_principal.verified", principal: config.user })}\n`);
    return true;
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('airenos-kairos-runtime-principal-provisioning'))"); } catch {}
    client.release();
    await pool.end();
  }
}
