import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { parseDeploymentRuntimeOptions } from "../../apps/api/src/deployment-config.ts";

test("Gate146 entrypoint starts only the separate Foundation Attachment server and installs governed shutdown", async () => {
  const source = await readFile("deploy/foundation-attachment-runtime-entry.ts", "utf8");
  assert.match(source, /startFoundationAttachmentHttpServer\(process\.env\)/);
  assert.match(source, /SIGTERM/);
  assert.match(source, /SIGINT/);
  assert.match(source, /service\.stop\(signal\)/);
  assert.match(source, /ra01\.foundation\.service_start_failed/);
  assert.doesNotMatch(source, /startAirenOSSessionAuthorityStagingServer/);
  assert.doesNotMatch(source, /session-authority-runtime-entry/);
});

test("Gate146 deployment contract defines the future container start command without provider configuration", async () => {
  const dockerfile = await readFile("deploy/Dockerfile.foundation-attachment", "utf8");
  assert.match(dockerfile, /CMD \["node","--experimental-strip-types","deploy\/foundation-attachment-runtime-entry\.ts"\]/);
  assert.match(dockerfile, /\/health\/ready/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /PORT=3000/);
  assert.match(dockerfile, /SHUTDOWN_TIMEOUT_MS=10000/);
  assert.doesNotMatch(dockerfile, /AIRENOS_FOUNDATION_REGISTRY_SERVICE_CREDENTIAL=/);
  assert.doesNotMatch(dockerfile, /DATABASE_URL=/);
  assert.doesNotMatch(dockerfile, /session-authority-runtime-entry/);
});

test("Gate146 reuses bounded deployment runtime parsing for HOST, PORT, release revision and shutdown", () => {
  const parsed = parseDeploymentRuntimeOptions({
    HOST: "0.0.0.0",
    PORT: "10000",
    SHUTDOWN_TIMEOUT_MS: "15000",
    RELEASE_REVISION: "gate146abcdef",
  });
  assert.equal(parsed.host, "0.0.0.0");
  assert.equal(parsed.port, 10000);
  assert.equal(parsed.shutdownTimeoutMs, 15000);
  assert.equal(parsed.releaseRevision, "gate146abcdef");

  assert.throws(
    () => parseDeploymentRuntimeOptions({ HOST: "example.com", RELEASE_REVISION: "gate146abcdef" }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID",
  );
  assert.throws(
    () => parseDeploymentRuntimeOptions({ PORT: "70000", RELEASE_REVISION: "gate146abcdef" }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID",
  );
});
