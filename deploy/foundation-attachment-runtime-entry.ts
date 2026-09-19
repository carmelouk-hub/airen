import { classifyError } from "../packages/observability/src/index.ts";
import { startFoundationAttachmentHttpServer } from "../apps/api/src/foundation-attachment-staging-server.ts";

async function main(): Promise<void> {
  const service = await startFoundationAttachmentHttpServer(process.env);

  process.stdout.write(`${JSON.stringify({
    event: "ra01.foundation.service.started",
    host: service.deployment.host,
    port: service.deployment.port,
    releaseRevision: service.deployment.releaseRevision,
  })}\n`);

  const shutdown = (signal: string) => {
    void service.stop(signal).then(() => {
      process.exitCode = 0;
    }).catch((error: unknown) => {
      const classification = classifyError(error);
      process.stderr.write(`${JSON.stringify({
        event: "ra01.foundation.service_stop_failed",
        errorCode: classification.code,
        signal,
      })}\n`);
      process.exitCode = 1;
    });
  };

  process.once("SIGTERM", () => shutdown("sigterm"));
  process.once("SIGINT", () => shutdown("sigint"));
}

main().catch((error: unknown) => {
  const classification = classifyError(error);
  process.stderr.write(`${JSON.stringify({
    event: "ra01.foundation.service_start_failed",
    errorCode: classification.code,
  })}\n`);
  process.exitCode = 1;
});
