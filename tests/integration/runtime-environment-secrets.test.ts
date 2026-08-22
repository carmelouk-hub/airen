import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { loadFoundationRuntimeEnvironment, runtimeEnvironmentDiagnostics } from "../../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider } from "../../packages/integrations/src/index.ts";
import { bootstrapFoundationRuntime } from "../../apps/api/src/runtime-bootstrap.ts";

const DB_KEY = "FOUNDATION_TEST_DATABASE_URL";
const AUTH_KEY = "FOUNDATION_TEST_AUTH_SESSION_KEY";

function baseEnvironment(): Record<string, string> {
  return {
    NODE_ENV: "test",
    APP_BASE_DOMAIN: "ristoairen.test",
    AUTH_ADAPTER: "signed-session",
    AUTH_PROVIDER_KEY: "synthetic-auth",
    AUTH_AUDIENCE: "airenos-foundation",
    SECRET_MANAGER_ADAPTER: "env",
    DATABASE_URL_SECRET_REF: `secret://env/${DB_KEY}`,
    AUTH_SESSION_KEY_SECRET_REF: `secret://env/${AUTH_KEY}`,
    OBJECT_STORAGE_ADAPTER: "s3-compatible",
    REALTIME_ADAPTER: "provider-neutral"
  };
}

function issueToken(key: string, claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test("typed runtime environment accepts only secret references and exposes redacted diagnostics", () => {
  const config = loadFoundationRuntimeEnvironment(baseEnvironment());
  assert.equal(config.databaseUrlRef.provider, "env");
  assert.equal(config.databaseUrlRef.key, DB_KEY);
  assert.equal(config.appBaseDomain, "ristoairen.test");
  const diagnostics = JSON.stringify(runtimeEnvironmentDiagnostics(config));
  assert.equal(diagnostics.includes(DB_KEY), false);
  assert.equal(diagnostics.includes(AUTH_KEY), false);
  assert.match(diagnostics, /REDACTED_REF_KEY/);
});

test("startup fails closed when required references are missing or malformed", () => {
  const missing = baseEnvironment();
  delete missing.AUTH_SESSION_KEY_SECRET_REF;
  assert.throws(() => loadFoundationRuntimeEnvironment(missing), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");

  const malformed = { ...baseEnvironment(), DATABASE_URL_SECRET_REF: "https://not-a-secret-ref.invalid/value" };
  assert.throws(() => loadFoundationRuntimeEnvironment(malformed), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");
});

test("raw database or auth secret material is rejected as runtime configuration", () => {
  const dynamicValue = randomBytes(24).toString("hex");
  assert.throws(() => loadFoundationRuntimeEnvironment({ ...baseEnvironment(), DATABASE_URL: dynamicValue }), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");
  assert.throws(() => loadFoundationRuntimeEnvironment({ ...baseEnvironment(), AUTH_SESSION_KEY: dynamicValue }), (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID");
});

test("secret provider is allowlisted, provider-bound and fails closed", async () => {
  const provider = new EnvironmentSecretProvider({ [DB_KEY]: randomBytes(24).toString("hex") }, [DB_KEY]);
  await assert.rejects(() => provider.resolve({ provider: "env", key: AUTH_KEY }), (error: unknown) => error instanceof AppError && error.code === "SECRET_RESOLUTION_FAILED");
  await assert.rejects(() => provider.resolve({ provider: "vault", key: DB_KEY }), (error: unknown) => error instanceof AppError && error.code === "SECRET_RESOLUTION_FAILED");
  await assert.rejects(() => provider.resolve({ provider: "env", key: DB_KEY, version: "v1" }), (error: unknown) => error instanceof AppError && error.code === "SECRET_RESOLUTION_FAILED");
});

test("resolved secret material is redacted from string and JSON representations", async () => {
  const secretValue = randomBytes(32).toString("hex");
  const provider = new EnvironmentSecretProvider({ [DB_KEY]: secretValue }, [DB_KEY]);
  const material = await provider.resolve({ provider: "env", key: DB_KEY });
  assert.equal(String(material), "[REDACTED_SECRET]");
  assert.equal(JSON.stringify(material), '"[REDACTED_SECRET]"');
  assert.equal(JSON.stringify({ material }).includes(secretValue), false);
  assert.equal(material.use((value) => value === secretValue), true);
});

test("Foundation bootstrap resolves secrets through provider without exposing them in diagnostics", async () => {
  const databaseValue = `postgresql://synthetic/${randomBytes(12).toString("hex")}`;
  const authValue = randomBytes(32).toString("hex");
  const provider = new EnvironmentSecretProvider({ [DB_KEY]: databaseValue, [AUTH_KEY]: authValue }, [DB_KEY, AUTH_KEY]);
  const runtime = await bootstrapFoundationRuntime(baseEnvironment(), provider);
  assert.equal(runtime.withDatabaseConnectionString((value) => value === databaseValue), true);
  const diagnostics = JSON.stringify(runtime.diagnostics);
  assert.equal(diagnostics.includes(databaseValue), false);
  assert.equal(diagnostics.includes(authValue), false);
});

test("resolved auth secret builds a verifier that accepts valid signed session and rejects wrong key", async () => {
  const databaseValue = `postgresql://synthetic/${randomBytes(12).toString("hex")}`;
  const authValue = randomBytes(32).toString("hex");
  const provider = new EnvironmentSecretProvider({ [DB_KEY]: databaseValue, [AUTH_KEY]: authValue }, [DB_KEY, AUTH_KEY]);
  const nowMs = Date.UTC(2026, 7, 21, 17, 0, 0);
  const runtime = await bootstrapFoundationRuntime(baseEnvironment(), provider);
  const verifier = runtime.createReferenceSignedSessionVerifier({ now: () => nowMs, clockSkewSeconds: 0 });
  const now = Math.floor(nowMs / 1000);
  const claims = { iss: "synthetic-auth", aud: "airenos-foundation", sub: "identity-subject", sid: "runtime-secret-session", iat: now - 5, exp: now + 300 };
  const token = issueToken(authValue, claims);
  const verified = await verifier.verify({ authorization: `Bearer ${token}` });
  assert.equal(verified?.providerSubject, "identity-subject");

  const wrongToken = issueToken(randomBytes(32).toString("hex"), claims);
  assert.equal(await verifier.verify({ authorization: `Bearer ${wrongToken}` }), null);
});
