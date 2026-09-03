import { AppError } from "../packages/shared-contracts/src/index.ts";
import { classifyError } from "../packages/observability/src/index.ts";
import { startFoundationHttpServer } from "../apps/api/src/server.ts";
import { loadRa01RuntimeDatabaseConfig, materializeRa01RuntimeDatabaseUrl } from "./ra01-runtime-database-principal.ts";

async function main(): Promise<void> {
  const runtimeConfig = loadRa01RuntimeDatabaseConfig(process.env);
  const runtimeDatabaseUrl = materializeRa01RuntimeDatabaseUrl(process.env);
  if (!runtimeConfig || !runtimeDatabaseUrl) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RA-01 staging requires a dedicated least-privilege runtime database principal", { field: "RA01_RUNTIME_DB_USER" });
  }

  process.env.RA01_RUNTIME_DATABASE_URL = runtimeDatabaseUrl;
  process.stdout.write(`${JSON.stringify({ event: "ra01.foundation.runtime_database.materialized", principal: runtimeConfig.user })}\n`);

  const service = await startFoundationHttpServer(process.env);
  const shutdown = (signal: string) => {
    void service.stop(signal).then(() => { process.exitCode = 0; });
  };
  process.once("SIGTERM", () => shutdown("sigterm"));
  process.once("SIGINT", () => shutdown("sigint"));
}

main().catch((error: unknown) => {
  const classification = classifyError(error);
  process.stderr.write(`${JSON.stringify({ event: "ra01.foundation.service.start_failed", errorCode: classification.code })}\n`);
  process.exitCode = 1;
});
