import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { AppError } from "../packages/shared-contracts/src/index.ts";
import { parseSecretRef } from "../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { migrateFoundationDatabase } from "./migrate.ts";
import { provisionRblRuntimeDatabasePrincipal } from "./runtime-database-principal.ts";
import { seedRbl01dBase44BookingTopology } from "./seed-rbl01d-base44.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;
type GovernedMigration = Readonly<{ migrationId: string; path: string; phase: string }>;

const GOVERNED_BOOKING_MIGRATIONS: readonly GovernedMigration[] = [
  {
    migrationId: "20260826_001_risto_bookings.sql",
    path: resolve("packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.sql"),
    phase: "booking",
  },
  {
    migrationId: "20260829_001_risto_booking_holds.sql",
    path: resolve("packages/persistence-postgres/src/migrations/20260829_001_risto_booking_holds.sql"),
    phase: "booking-hold",
  },
  {
    migrationId: "20260829_002_risto_airenpay.sql",
    path: resolve("packages/persistence-postgres/src/migrations/20260829_002_risto_airenpay.sql"),
    phase: "airenpay",
  },
  {
    migrationId: "20260901_001_airen_booking_product_neutral_idempotency.sql",
    path: resolve("packages/persistence-postgres/src/migrations/20260901_001_airen_booking_product_neutral_idempotency.sql"),
    phase: "booking-product-access",
  },
];

function required(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required migration environment field: ${key}`, { field: key });
  return value;
}

function checksum(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function transactionBody(sql: string, migrationId: string): string {
  const trimmed = sql.trim();
  const begin = /(^|\n)\s*BEGIN;\s*/i.exec(trimmed);
  const commit = /\s*COMMIT;\s*$/i.exec(trimmed);
  if (!begin || !commit || begin.index >= commit.index) {
    throw new AppError("VALIDATION_FAILED", "Governed RISTOAIREN migration must be transaction wrapped", { migrationId });
  }
  const prefix = trimmed.slice(0, begin.index).trim();
  if (prefix && prefix.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith("--"))) {
    throw new AppError("VALIDATION_FAILED", "Only comments may precede a governed RISTOAIREN migration transaction", { migrationId });
  }
  return trimmed.slice(begin.index + begin[0].length, commit.index).trim();
}

async function resolveMigrationConnectionString(environment: EnvironmentInput): Promise<string> {
  const providerKey = required(environment, "MIGRATION_SECRET_MANAGER_ADAPTER");
  if (providerKey !== "env") {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "No RISTOAIREN migration SecretProvider adapter is registered for the configured provider", { provider: providerKey });
  }
  const ref = parseSecretRef(required(environment, "MIGRATION_DATABASE_URL_SECRET_REF"), "MIGRATION_DATABASE_URL_SECRET_REF");
  if (ref.provider !== providerKey) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RISTOAIREN migration database SecretRef provider must match MIGRATION_SECRET_MANAGER_ADAPTER", { field: "MIGRATION_DATABASE_URL_SECRET_REF" });
  }
  const provider = new EnvironmentSecretProvider(environment, [ref.key]);
  const material = await provider.resolve(ref);
  let connectionString = "";
  await material.use((value) => { connectionString = value; });
  return connectionString;
}

async function applyGovernedMigration(client: import("pg").PoolClient, migration: GovernedMigration): Promise<void> {
  const sql = await readFile(migration.path, "utf8");
  const sha256 = checksum(sql);
  const body = transactionBody(sql, migration.migrationId);
  const existing = await client.query<{ sha256: string }>("SELECT sha256 FROM public.airen_schema_migrations WHERE migration_id=$1", [migration.migrationId]);
  if (existing.rowCount) {
    if (existing.rows[0].sha256.trim() !== sha256) {
      throw new AppError("CONFLICT", "Applied governed RISTOAIREN migration checksum does not match repository source", { migrationId: migration.migrationId });
    }
    process.stdout.write(`${JSON.stringify({ event: "ristoairen.migration.skip", phase: migration.phase, migrationId: migration.migrationId })}\n`);
    return;
  }
  await client.query("BEGIN");
  try {
    await client.query(body);
    await client.query("INSERT INTO public.airen_schema_migrations (migration_id, sha256) VALUES ($1,$2)", [migration.migrationId, sha256]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.migration.applied", phase: migration.phase, migrationId: migration.migrationId })}\n`);
}

async function migrateRistoairenModules(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, application_name: "ristoairen-governed-migration" });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('ristoairen-governed-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.airen_schema_migrations (
        migration_id text PRIMARY KEY,
        sha256 char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON public.airen_schema_migrations FROM PUBLIC;
    `);
    for (const migration of GOVERNED_BOOKING_MIGRATIONS) {
      process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: migration.phase, state: "start", migrationId: migration.migrationId })}\n`);
      await applyGovernedMigration(client, migration);
      process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: migration.phase, state: "complete", migrationId: migration.migrationId })}\n`);
    }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('ristoairen-governed-migrations'))"); } catch {}
    client.release();
    await pool.end();
  }
}

export async function migrateRistoairenBookingDatabase(environment: EnvironmentInput = process.env): Promise<void> {
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: "foundation", state: "start" })}\n`);
  await migrateFoundationDatabase(environment);
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: "foundation", state: "complete" })}\n`);
  const connectionString = await resolveMigrationConnectionString(environment);
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: "runtime-principal", state: "start" })}\n`);
  await provisionRblRuntimeDatabasePrincipal(connectionString, environment);
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: "runtime-principal", state: "complete" })}\n`);
  await migrateRistoairenModules(connectionString);
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: "base44-seed", state: "start" })}\n`);
  await seedRbl01dBase44BookingTopology(connectionString, environment);
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: "base44-seed", state: "complete" })}\n`);
}

if (process.argv[1]?.endsWith("deploy/migrate-ristoairen-booking.ts")) {
  migrateRistoairenBookingDatabase().catch((error: unknown) => {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    const migrationId = error instanceof AppError && typeof error.details?.migrationId === "string" ? error.details.migrationId : undefined;
    const providerErrorCode = typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
    const providerRoutine = typeof error === "object" && error !== null && "routine" in error && typeof (error as { routine?: unknown }).routine === "string"
      ? (error as { routine: string }).routine
      : undefined;
    process.stderr.write(`${JSON.stringify({
      event: "ristoairen.booking.migration.failed",
      errorCode: code,
      ...(migrationId ? { migrationId } : {}),
      ...(providerErrorCode ? { providerErrorCode } : {}),
      ...(providerRoutine ? { providerRoutine } : {}),
    })}\n`);
    process.exitCode = 1;
  });
}
