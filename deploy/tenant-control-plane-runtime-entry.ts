import { readFile, rm, stat } from "node:fs/promises";
import { startTenantControlPlaneStagingServer } from "../apps/api/src/tenant-control-plane-staging-server.ts";
import { AppError } from "../packages/shared-contracts/src/index.ts";

const RUNTIME_URL_FILE = "/tmp/airenos-tenant-runtime-url";

async function runtimeEnvironment(): Promise<NodeJS.ProcessEnv> {
  if (process.env.CONTROL_PLANE_DATABASE_URL?.trim()) return { ...process.env };
  let info;
  try { info = await stat(RUNTIME_URL_FILE); }
  catch { throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Tenant runtime database credential handoff is missing"); }
  if (!info.isFile() || (info.mode & 0o777) !== 0o600) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Tenant runtime database credential handoff must be a 0600 regular file");
  }
  const databaseUrl = (await readFile(RUNTIME_URL_FILE, "utf8")).trim();
  if (!databaseUrl) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Tenant runtime database credential handoff is empty");
  await rm(RUNTIME_URL_FILE, { force: true });
  const environment = { ...process.env, CONTROL_PLANE_DATABASE_URL: databaseUrl };
  delete environment.CONTROL_PLANE_ADMIN_DATABASE_URL;
  return environment;
}

async function main(): Promise<void> {
  const environment = await runtimeEnvironment();
  delete process.env.CONTROL_PLANE_ADMIN_DATABASE_URL;
  const service = await startTenantControlPlaneStagingServer(environment);
  process.stdout.write(`${JSON.stringify({ event: "airenos.tenant_control_plane.started", readOnly: true, authoritySource: "session_authority_principal", adminCredentialRetained: false })}\n`);
  const shutdown = () => { void service.stop().then(() => { process.exitCode = 0; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch(() => {
  process.stderr.write(`${JSON.stringify({ event: "airenos.tenant_control_plane.start_failed" })}\n`);
  process.exitCode = 1;
});
