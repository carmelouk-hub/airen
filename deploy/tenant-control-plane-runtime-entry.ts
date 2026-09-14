import { startTenantControlPlaneStagingServer } from "../apps/api/src/tenant-control-plane-staging-server.ts";

async function main(): Promise<void> {
  const service = await startTenantControlPlaneStagingServer(process.env);
  process.stdout.write(`${JSON.stringify({ event: "airenos.tenant_control_plane.started", readOnly: true, authoritySource: "session_authority_principal" })}\n`);
  const shutdown = () => { void service.stop().then(() => { process.exitCode = 0; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch(() => {
  process.stderr.write(`${JSON.stringify({ event: "airenos.tenant_control_plane.start_failed" })}\n`);
  process.exitCode = 1;
});
