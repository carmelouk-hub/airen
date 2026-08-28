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

const BOOKING_MIGRATION_ID = "20260826_001_risto_bookings.sql";
const BOOKING_MIGRATION_PATH = resolve("packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.sql");

function required(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required migration environment field: ${key}`, { field: key });
  return value;
}

function checksum(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function transactionBody(sql: string): string {
  const trimmed = sql.trim();
  const begin = /(^|\n)\s*BEGIN;\s*/i.exec(trimmed);
  const commit = /\s*COMMIT;\s*$/i.exec(trimmed);
  if (!begin || !commit || begin.index >= commit.index) {
    throw new AppError("VALIDATION_FAILED", "RISTOAIREN Booking migration must be transaction wrapped", { migrationId: BOOKING_MIGRATION_ID });
  }
  const prefix = trimmed.slice(0, begin.index).trim();
  if (prefix && prefix.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith("--"))) {
    throw new AppError("VALIDATION_FAILED", "Only comments may precede the Booking migration transaction", { migrationId: BOOKING_MIGRATION_ID });
  }
  return trimmed.slice(begin.index + begin[0].length, commit.index).trim();
}

async function resolveMigrationConnectionString(environment: EnvironmentInput): Promise<string> {
  const providerKey = required(environment, "MIGRATION_SECRET_MANAGER_ADAPTER");
  if (providerKey !== "env") {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "No RISTOAIREN Booking migration SecretProvider adapter is registered for the configured provider", { provider: providerKey });
  }
  const ref = parseSecretRef(required(environment, "MIGRATION_DATABASE_URL_SECRET_REF"), "MIGRATION_DATABASE_URL_SECRET_REF");
  if (ref.provider !== providerKey) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Booking migration database SecretRef provider must match MIGRATION_SECRET_MANAGER_ADAPTER", { field: "MIGRATION_DATABASE_URL_SECRET_REF" });
  }
  const provider = new EnvironmentSecretProvider(environment, [ref.key]);
  const material = await provider.resolve(ref);
  let connectionString = "";
  await material.use((value) => { connectionString = value; });
  return connectionString;
}

async function migrateBookingDatabase(connectionString: string): Promise<void> {
  const sql = await readFile(BOOKING_MIGRATION_PATH, "utf8");
  const sha256 = checksum(sql);
  const body = transactionBody(sql);
  const pool = new Pool({ connectionString, max: 1, application_name: "ristoairen-booking-migration" });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('ristoairen-booking-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.airen_schema_migrations (
        migration_id text PRIMARY KEY,
        sha256 char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON public.airen_schema_migrations FROM PUBLIC;
    `);
    const existing = await client.query<{ sha256: string }>("SELECT sha256 FROM public.airen_schema_migrations WHERE migration_id=$1", [BOOKING_MIGRATION_ID]);
    if (existing.rowCount) {
      if (existing.rows[0].sha256.trim() !== sha256) {
        throw new AppError("CONFLICT", "Applied Booking migration checksum does not match repository source", { migrationId: BOOKING_MIGRATION_ID });
      }
      process.stdout.write(`${JSON.stringify({ event: "booking.migration.skip", migrationId: BOOKING_MIGRATION_ID })}\n`);
      return;
    }
    await client.query("BEGIN");
    try {
      await client.query(body);
      await client.query("INSERT INTO public.airen_schema_migrations (migration_id, sha256) VALUES ($1,$2)", [BOOKING_MIGRATION_ID, sha256]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    process.stdout.write(`${JSON.stringify({ event: "booking.migration.applied", migrationId: BOOKING_MIGRATION_ID })}\n`);
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext('ristoairen-booking-migrations'))"); } catch {}
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
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: "booking", state: "start" })}\n`);
  await migrateBookingDatabase(connectionString);
  process.stdout.write(`${JSON.stringify({ event: "ristoairen.booking.migration.phase", phase: "booking", state: "complete" })}\n`);
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
