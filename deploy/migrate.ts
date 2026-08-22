import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { AppError } from "../packages/shared-contracts/src/index.ts";
import { parseSecretRef } from "../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider, type SecretProvider } from "../packages/integrations/src/index.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

function required(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required migration environment field: ${key}`, { field: key });
  return value;
}

function secretProvider(input: EnvironmentInput, providerKey: string, allowedKey: string): SecretProvider {
  if (providerKey === "env") return new EnvironmentSecretProvider(input, [allowedKey]);
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", "No migration SecretProvider adapter is registered for the configured provider", { provider: providerKey });
}

function checksum(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function transactionBody(sql: string, migrationId: string): string {
  const trimmed = sql.trim();
  const begin = /(^|\n)\s*BEGIN;\s*/i.exec(trimmed);
  const commit = /\s*COMMIT;\s*$/i.exec(trimmed);
  if (!begin || !commit || begin.index >= commit.index) throw new AppError("VALIDATION_FAILED", "Foundation migration must be transaction wrapped", { migrationId });
  const prefix = trimmed.slice(0, begin.index).trim();
  if (prefix && prefix.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith("--"))) {
    throw new AppError("VALIDATION_FAILED", "Only comments may precede the migration transaction", { migrationId });
  }
  const bodyStart = begin.index + begin[0].length;
  return trimmed.slice(bodyStart, commit.index).trim();
}

async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, application_name: "airenos-migration" });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('airenos-foundation-migrations'))");
    const bootstrapSql = await readFile(resolve("db/bootstrap/0000_runtime_roles.sql"), "utf8");
    await client.query(bootstrapSql);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.airen_schema_migrations (
        migration_id text PRIMARY KEY,
        sha256 char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON public.airen_schema_migrations FROM PUBLIC;
    `);

    const migrationFiles = (await readdir(resolve("db/migrations")))
      .filter((name) => /^\d{4}_[A-Za-z0-9_.-]+\.sql$/.test(name))
      .sort();

    for (const migrationId of migrationFiles) {
      const sql = await readFile(resolve("db/migrations", migrationId), "utf8");
      const sha256 = checksum(sql);
      const existing = await client.query<{ sha256: string }>("SELECT sha256 FROM public.airen_schema_migrations WHERE migration_id=$1", [migrationId]);
      if (existing.rowCount) {
        if (existing.rows[0].sha256.trim() !== sha256) throw new AppError("CONFLICT", "Applied migration checksum does not match repository source", { migrationId });
        process.stdout.write(`${JSON.stringify({ event: "migration.skip", migrationId })}\n`);
        continue;
      }

      const body = transactionBody(sql, migrationId);
      await client.query("BEGIN");
      try {
        await client.query(body);
        await client.query("INSERT INTO public.airen_schema_migrations (migration_id, sha256) VALUES ($1,$2)", [migrationId, sha256]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      process.stdout.write(`${JSON.stringify({ event: "migration.applied", migrationId })}\n`);
    }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('airenos-foundation-migrations'))"); } catch {}
    client.release();
    await pool.end();
  }
}

export async function migrateFoundationDatabase(environment: EnvironmentInput = process.env): Promise<void> {
  const providerKey = required(environment, "MIGRATION_SECRET_MANAGER_ADAPTER");
  const ref = parseSecretRef(required(environment, "MIGRATION_DATABASE_URL_SECRET_REF"), "MIGRATION_DATABASE_URL_SECRET_REF");
  if (ref.provider !== providerKey) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Migration database SecretRef provider must match MIGRATION_SECRET_MANAGER_ADAPTER", { field: "MIGRATION_DATABASE_URL_SECRET_REF" });
  const provider = secretProvider(environment, providerKey, ref.key);
  const material = await provider.resolve(ref);
  await material.use((connectionString) => runMigrations(connectionString));
}

if (process.argv[1]?.endsWith("deploy/migrate.ts")) {
  migrateFoundationDatabase().catch((error: unknown) => {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    const migrationId = error instanceof AppError && typeof error.details?.migrationId === "string" ? error.details.migrationId : undefined;
    process.stderr.write(`${JSON.stringify({ event: "migration.failed", errorCode: code, ...(migrationId ? { migrationId } : {}) })}\n`);
    process.exitCode = 1;
  });
}
