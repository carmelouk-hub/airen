import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { parseDeploymentRuntimeOptions } from "../../apps/api/src/deployment-config.ts";

test("deployment runtime options are deterministic and container-safe", () => {
  const options = parseDeploymentRuntimeOptions({ RELEASE_REVISION: "abcdef1234567" });
  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 3000);
  assert.equal(options.shutdownTimeoutMs, 10000);
  assert.equal(options.releaseRevision, "abcdef1234567");
});

test("deployment runtime rejects invalid ports, hosts and release identifiers", () => {
  assert.throws(() => parseDeploymentRuntimeOptions({ RELEASE_REVISION: "abcdef1234567", PORT: "0" }), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");
  assert.throws(() => parseDeploymentRuntimeOptions({ RELEASE_REVISION: "abcdef1234567", HOST: "public.example.com" }), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");
  assert.throws(() => parseDeploymentRuntimeOptions({ RELEASE_REVISION: "bad revision" }), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");
  assert.throws(() => parseDeploymentRuntimeOptions({}), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");
});

test("shutdown timeout is bounded", () => {
  assert.equal(parseDeploymentRuntimeOptions({ RELEASE_REVISION: "abcdef1234567", SHUTDOWN_TIMEOUT_MS: "5000" }).shutdownTimeoutMs, 5000);
  assert.throws(() => parseDeploymentRuntimeOptions({ RELEASE_REVISION: "abcdef1234567", SHUTDOWN_TIMEOUT_MS: "999999" }), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");
});
