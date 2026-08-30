import { classifyError } from "../packages/observability/src/index.ts";
import { startKairosHttpServer } from "../apps/api/src/kairos-http-server.ts";
import { loadKairosRuntimeDatabaseConfig, materializeKairosRuntimeDatabaseUrl } from "./kairos-runtime-database-principal.ts";

async function main(): Promise<void> {
  const runtimeConfig = loadKairosRuntimeDatabaseConfig(process.env);
  const runtimeDatabaseUrl = materializeKairosRuntimeDatabaseUrl(process.env);
  if (!runtimeConfig || !runtimeDatabaseUrl) {
    throw new Error("Kairos staging runtime database principal is not configured");
  }
  process.env.KAIROS_RUNTIME_DATABASE_URL = runtimeDatabaseUrl;
  process.stdout.write(`${JSON.stringify({ event: "kairos.deployment.runtime_database.materialized", principal: runtimeConfig.user })}\n`);

  const service = await startKairosHttpServer(process.env);
  const shutdown = () => { void service.stop().then(() => { process.exitCode = 0; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  const classification = classifyError(error);
  process.stderr.write(`${JSON.stringify({ event: "kairos.service.start_failed", errorCode: classification.code })}\n`);
  process.exitCode = 1;
});
