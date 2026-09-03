import { AppError } from "../packages/shared-contracts/src/index.ts";
import { parseSecretRef } from "../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { migrateFoundationDatabase } from "./migrate.ts";
import { provisionRa01RuntimeDatabasePrincipal } from "./ra01-runtime-database-principal.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

function required(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required RA-01 migration environment field: ${key}`, { field: key });
  return value;
}

async function resolveMigrationConnectionString(environment: EnvironmentInput): Promise<string> {
  const providerKey = required(environment, "MIGRATION_SECRET_MANAGER_ADAPTER");
  if (providerKey !== "env") {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "No RA-01 migration SecretProvider adapter is registered for the configured provider", { provider: providerKey });
  }
  const ref = parseSecretRef(required(environment, "MIGRATION_DATABASE_URL_SECRET_REF"), "MIGRATION_DATABASE_URL_SECRET_REF");
  if (ref.provider !== providerKey) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RA-01 migration database SecretRef provider must match MIGRATION_SECRET_MANAGER_ADAPTER", { field: "MIGRATION_DATABASE_URL_SECRET_REF" });
  }
  const provider = new EnvironmentSecretProvider(environment, [ref.key]);
  const material = await provider.resolve(ref);
  let connectionString = "";
  await material.use((value) => { connectionString = value; });
  return connectionString;
}

export async function migrateRa01FoundationDatabase(environment: EnvironmentInput = process.env): Promise<void> {
  process.stdout.write(`${JSON.stringify({ event: "ra01.foundation.migration.phase", phase: "foundation", state: "start" })}\n`);
  await migrateFoundationDatabase(environment);
  process.stdout.write(`${JSON.stringify({ event: "ra01.foundation.migration.phase", phase: "foundation", state: "complete" })}\n`);

  const connectionString = await resolveMigrationConnectionString(environment);
  process.stdout.write(`${JSON.stringify({ event: "ra01.foundation.migration.phase", phase: "runtime-principal", state: "start" })}\n`);
  const provisioned = await provisionRa01RuntimeDatabasePrincipal(connectionString, environment);
  if (!provisioned) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RA-01 runtime database principal configuration is required for staging", { field: "RA01_RUNTIME_DB_USER" });
  }
  process.stdout.write(`${JSON.stringify({ event: "ra01.foundation.migration.phase", phase: "runtime-principal", state: "complete" })}\n`);
}

if (process.argv[1]?.endsWith("deploy/migrate-ra01-foundation.ts")) {
  migrateRa01FoundationDatabase().catch((error: unknown) => {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    const providerErrorCode = typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
    process.stderr.write(`${JSON.stringify({
      event: "ra01.foundation.migration.failed",
      errorCode: code,
      ...(providerErrorCode ? { providerErrorCode } : {})
    })}\n`);
    process.exitCode = 1;
  });
}
