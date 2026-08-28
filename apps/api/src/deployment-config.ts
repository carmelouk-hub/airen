import { AppError } from "../../../packages/shared-contracts/src/index.ts";

export type DeploymentRuntimeOptions = Readonly<{
  host: string;
  port: number;
  releaseRevision: string;
  shutdownTimeoutMs: number;
}>;

type EnvironmentInput = Readonly<Record<string, string | undefined>>;
const revisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/;

function fail(message: string, field: string): never {
  process.stderr.write(`${JSON.stringify({ event: "deployment.runtime_config_invalid", field })}\n`);
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", message, { field });
}

function parseInteger(raw: string | undefined, fallback: number, field: string, min: number, max: number): number {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/.test(raw.trim())) return fail(`${field} must be an integer`, field);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) return fail(`${field} is outside the permitted range`, field);
  return value;
}

export function parseDeploymentRuntimeOptions(input: EnvironmentInput): DeploymentRuntimeOptions {
  const host = input.HOST?.trim() || "0.0.0.0";
  if (host !== "0.0.0.0" && host !== "127.0.0.1" && host !== "::") return fail("HOST must bind to a supported local/container interface", "HOST");

  const port = parseInteger(input.PORT, 3000, "PORT", 1, 65535);
  const shutdownTimeoutMs = parseInteger(input.SHUTDOWN_TIMEOUT_MS, 10000, "SHUTDOWN_TIMEOUT_MS", 1000, 30000);
  const releaseRevision = input.RELEASE_REVISION?.trim();
  if (!releaseRevision || !revisionPattern.test(releaseRevision)) return fail("RELEASE_REVISION must be a stable release identifier", "RELEASE_REVISION");

  return Object.freeze({ host, port, releaseRevision, shutdownTimeoutMs });
}
