import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { parseDeploymentRuntimeOptions } from "../../apps/api/src/deployment-config.ts";
import {
  buildRblRuntimeDatabaseUrl,
  deriveRblRuntimeDatabasePassword,
  loadRblRuntimeDatabaseConfig,
  materializeRblRuntimeDatabaseUrl
} from "../../deploy/runtime-database-principal.ts";

test("deployment runtime options are deterministic and container-safe", () => {
  const options = parseDeploymentRuntimeOptions({ RELEASE_REVISION: "abcdef1234567" });
  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 3000);
  assert.equal(options.shutdownTimeoutMs, 10000);
  assert.equal(options.releaseRevision, "abcdef1234567");
});

test("deployment runtime accepts the Render commit as release revision fallback", () => {
  const options = parseDeploymentRuntimeOptions({ RENDER_GIT_COMMIT: "9c21e90de9b15cb05626a90a3af33eacafd3deea" });
  assert.equal(options.releaseRevision, "9c21e90de9b15cb05626a90a3af33eacafd3deea");
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

test("RBL-01C2 runtime database credentials are deterministic and least-privilege scoped", () => {
  const environment = {
    RBL01C2_RUNTIME_DB_HOST: "ristoairen-postgres-rbl01c2",
    RBL01C2_RUNTIME_DB_PORT: "5432",
    RBL01C2_RUNTIME_DB_NAME: "ristoairen",
    RBL01C2_RUNTIME_DB_USER: "airen_runtime",
    RBL01C2_RUNTIME_DB_SEED: "a".repeat(64)
  };
  const config = loadRblRuntimeDatabaseConfig(environment);
  assert.ok(config);
  const password = deriveRblRuntimeDatabasePassword(config);
  assert.equal(password.length, 43);
  assert.notEqual(password, environment.RBL01C2_RUNTIME_DB_SEED);
  assert.equal(deriveRblRuntimeDatabasePassword(config), password);

  const runtimeUrl = buildRblRuntimeDatabaseUrl(config);
  assert.equal(materializeRblRuntimeDatabaseUrl(environment), runtimeUrl);
  const parsed = new URL(runtimeUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.equal(parsed.hostname, "ristoairen-postgres-rbl01c2");
  assert.equal(parsed.port, "5432");
  assert.equal(parsed.username, "airen_runtime");
  assert.equal(parsed.password, password);
  assert.equal(parsed.pathname, "/ristoairen");
});

test("RBL-01C2 runtime database configuration is optional but fails closed when partial", () => {
  assert.equal(materializeRblRuntimeDatabaseUrl({}), undefined);
  assert.throws(
    () => materializeRblRuntimeDatabaseUrl({ RBL01C2_RUNTIME_DB_USER: "airen_runtime" }),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID"
  );
});

test("RBL-03 BookingHold deployment remains explicit default-off with no public route", async () => {
  const [render, runtimeEntry, server] = await Promise.all([
    readFile(new URL("../../render.yaml", import.meta.url), "utf8"),
    readFile(new URL("../../deploy/runtime-entry.ts", import.meta.url), "utf8"),
    readFile(new URL("../../apps/api/src/server.ts", import.meta.url), "utf8")
  ]);

  assert.match(render, /RISTOAIREN_BOOKING_HOLD_RUNTIME_ENABLED\n\s+value: "false"/);
  assert.match(render, /RISTOAIREN_BOOKING_HOLD_EXPIRY_WORKER_ENABLED\n\s+value: "false"/);
  assert.match(render, /RISTOAIREN_BOOKING_MUTATION_ENABLED\n\s+value: "false"/);
  assert.match(runtimeEntry, /createRistoBookingHoldRuntime/);
  assert.match(runtimeEntry, /bookingHoldRuntime\.startExpiryWorker\(\)/);
  assert.match(runtimeEntry, /service\.stop\("booking_hold_runtime_start_failed"\)/);
  assert.doesNotMatch(server, /\/v1\/ristoairen\/booking-holds/);
});
