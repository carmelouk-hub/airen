import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildKairosRuntimeDatabaseUrl,
  deriveKairosRuntimeDatabasePassword,
  loadKairosRuntimeDatabaseConfig,
} from "../../deploy/kairos-runtime-database-principal.ts";

const manifestPath = "deploy/render-kairos-k4-staging.yaml";
const dockerfilePath = "deploy/Dockerfile.kairos";

test("K4-C3 staging runtime database credentials are deterministic and isolated from RBL names", () => {
  const config = loadKairosRuntimeDatabaseConfig({
    KAIROS_RUNTIME_DB_HOST: "db.internal.example",
    KAIROS_RUNTIME_DB_PORT: "5432",
    KAIROS_RUNTIME_DB_NAME: "airen_kairos_k4_staging",
    KAIROS_RUNTIME_DB_USER: "airen_kairos_runtime",
    KAIROS_RUNTIME_DB_SEED: "0123456789abcdef0123456789abcdef0123456789abcdef",
  });
  assert.ok(config);
  const password = deriveKairosRuntimeDatabasePassword(config);
  assert.equal(password, deriveKairosRuntimeDatabasePassword(config));
  assert.ok(password.length >= 32);
  const url = new URL(buildKairosRuntimeDatabaseUrl(config));
  assert.equal(url.hostname, "db.internal.example");
  assert.equal(url.username, "airen_kairos_runtime");
  assert.equal(url.pathname, "/airen_kairos_k4_staging");
});

test("K4-C3 dedicated staging blueprint is isolated and fail-closed on browser authority configuration", async () => {
  const manifest = await readFile(manifestPath, "utf8");
  assert.match(manifest, /branch: kairos\/k4-interactive-map-base44-20260830/);
  assert.match(manifest, /dockerfilePath: \.\/deploy\/Dockerfile\.kairos/);
  assert.match(manifest, /preDeployCommand: node --experimental-strip-types deploy\/migrate-kairos-staging\.ts/);
  assert.match(manifest, /AUTH_ADAPTER\n\s+value: ed25519-signed-session/);
  assert.match(manifest, /AUTH_SESSION_PUBLIC_KEYS_JSON\n\s+sync: false/);
  assert.match(manifest, /KAIROS_CORS_ALLOWED_ORIGINS\n\s+sync: false/);
  assert.doesNotMatch(manifest, /KAIROS_CORS_ALLOWED_ORIGINS[\s\S]{0,80}value:\s*["']?\*["']?/);
  assert.doesNotMatch(manifest, /rbl\/ristoairen-real-baseline-01-20260827/);
  assert.match(manifest, /K4-C3 remains OPEN/);
});

test("K4-C3 Kairos container starts only the dedicated Kairos runtime entry", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");
  assert.match(dockerfile, /deploy\/kairos-runtime-entry\.ts/);
  assert.doesNotMatch(dockerfile, /deploy\/runtime-entry\.ts/);
  assert.match(dockerfile, /health\/ready/);
});
