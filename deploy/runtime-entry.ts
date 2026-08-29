import { classifyError } from "../packages/observability/src/index.ts";
import { startFoundationHttpServer } from "../apps/api/src/server.ts";
import { createRistoBookingHoldRuntime } from "../apps/api/src/ristoairen-booking-hold-runtime.ts";
import { loadRblRuntimeDatabaseConfig, materializeRblRuntimeDatabaseUrl } from "./runtime-database-principal.ts";

async function main(): Promise<void> {
  const runtimeConfig = loadRblRuntimeDatabaseConfig(process.env);
  const runtimeDatabaseUrl = materializeRblRuntimeDatabaseUrl(process.env);
  if (runtimeConfig && runtimeDatabaseUrl) {
    process.env.RBL01C2_RUNTIME_DATABASE_URL = runtimeDatabaseUrl;
    process.stdout.write(`${JSON.stringify({ event: "deployment.runtime_database.materialized", principal: runtimeConfig.user })}\n`);
  }

  const service = await startFoundationHttpServer(process.env);
  let bookingHoldRuntime;
  try {
    bookingHoldRuntime = createRistoBookingHoldRuntime({
      environment: process.env,
      pool: service.pool,
      requiredEntitlement: process.env.RISTOAIREN_BOOKING_REQUIRED_ENTITLEMENT?.trim() ?? ""
    });
    bookingHoldRuntime.startExpiryWorker();
    process.stdout.write(`${JSON.stringify({
      event: "ristoairen.booking_hold.runtime",
      enabled: bookingHoldRuntime.enabled,
      expiryWorkerEnabled: bookingHoldRuntime.switches.expiryWorkerEnabled
    })}\n`);
  } catch (error) {
    await service.stop("booking_hold_runtime_start_failed");
    throw error;
  }

  const shutdown = (signal: string) => {
    bookingHoldRuntime.stop();
    void service.stop(signal).then(() => { process.exitCode = 0; });
  };
  process.once("SIGTERM", () => shutdown("sigterm"));
  process.once("SIGINT", () => shutdown("sigint"));
}

main().catch((error: unknown) => {
  const classification = classifyError(error);
  process.stderr.write(`${JSON.stringify({ event: "service.start_failed", errorCode: classification.code })}\n`);
  process.exitCode = 1;
});
