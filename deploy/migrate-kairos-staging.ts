import { parseSecretRef } from "../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { AppError } from "../packages/shared-contracts/src/index.ts";
import { migrateFoundationDatabase } from "./migrate.ts";
import { provisionKairosRuntimeDatabasePrincipal } from "./kairos-runtime-database-principal.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

function required(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required Kairos staging migration field: ${key}`, { field: key });
  return value;
}

async function migrationConnectionString(environment: EnvironmentInput): Promise<string> {
  const providerKey = required(environment, "MIGRATION_SECRET_MANAGER_ADAPTER");
  if (providerKey !== "env") throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Kairos staging migration currently requires env SecretProvider", { provider: providerKey });
  const ref = parseSecretRef(required(environment, "MIGRATION_DATABASE_URL_SECRET_REF"), "MIGRATION_DATABASE_URL_SECRET_REF");
  if (ref.provider !== providerKey) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Kairos staging migration SecretRef provider mismatch", { field: "MIGRATION_DATABASE_URL_SECRET_REF" });
  const provider = new EnvironmentSecretProvider(environment, [ref.key]);
  const material = await provider.resolve(ref);
  let value = "";
  await material.use((resolved) => { value = resolved; });
  return value;
}

export async function migrateKairosStagingDatabase(environment: EnvironmentInput = process.env): Promise<void> {
  process.stdout.write(`${JSON.stringify({ event: "kairos.staging.migration.phase", phase: "foundation", state: "start" })}\n`);
  await migrateFoundationDatabase(environment);
  process.stdout.write(`${JSON.stringify({ event: "kairos.staging.migration.phase", phase: "foundation", state: "complete" })}\n`);
  const connectionString = await migrationConnectionString(environment);
  process.stdout.write(`${JSON.stringify({ event: "kairos.staging.migration.phase", phase: "runtime-principal", state: "start" })}\n`);
  await provisionKairosRuntimeDatabasePrincipal(connectionString, environment);
  process.stdout.write(`${JSON.stringify({ event: "kairos.staging.migration.phase", phase: "runtime-principal", state: "complete" })}\n`);
}

if (process.argv[1]?.endsWith("deploy/migrate-kairos-staging.ts")) {
  migrateKairosStagingDatabase().catch((error: unknown) => {
    const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    process.stderr.write(`${JSON.stringify({ event: "kairos.staging.migration.failed", errorCode: code })}\n`);
    process.exitCode = 1;
  });
}
