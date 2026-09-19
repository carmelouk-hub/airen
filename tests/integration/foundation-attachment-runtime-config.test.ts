import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { loadFoundationAttachmentRuntimeEnvironment } from "../../apps/api/src/foundation-attachment-runtime-config.ts";

function environment(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    APP_BASE_DOMAIN: "airen.info",
    AUTH_ADAPTER: "airenos-session-ed25519",
    AUTH_AUDIENCE: "airenos-foundation",
    AIRENOS_SESSION_ISSUER: "https://session.airen.info",
    AUTH_SESSION_PUBLIC_KEYS_JSON: JSON.stringify({
      "test-key": { key: { kty: "OKP", crv: "Ed25519", x: "synthetic-public-key" }, enabled: true },
    }),
    SECRET_MANAGER_ADAPTER: "env",
    DATABASE_URL_SECRET_REF: "secret://env/FOUNDATION_ATTACHMENT_DATABASE_URL",
    ...overrides,
  };
}

test("Gate159 accepts the Ed25519-native minimal Attachment runtime contract", () => {
  const config = loadFoundationAttachmentRuntimeEnvironment(environment());
  assert.equal(config.nodeEnv, "production");
  assert.equal(config.appBaseDomain, "airen.info");
  assert.equal(config.authAdapter, "airenos-session-ed25519");
  assert.equal(config.authAudience, "airenos-foundation");
  assert.equal(config.sessionIssuer, "https://session.airen.info");
  assert.equal(config.secretManagerAdapter, "env");
  assert.equal(config.databaseUrlRef.provider, "env");
  assert.equal(config.databaseUrlRef.key, "FOUNDATION_ATTACHMENT_DATABASE_URL");
  assert.equal("authProviderKey" in config, false);
  assert.equal("authSessionKeyRef" in config, false);
});

test("Gate159 does not require legacy AUTH_PROVIDER_KEY or AUTH_SESSION_KEY_SECRET_REF", () => {
  const config = loadFoundationAttachmentRuntimeEnvironment(environment({
    AUTH_PROVIDER_KEY: undefined,
    AUTH_SESSION_KEY_SECRET_REF: undefined,
  }));
  assert.equal(config.authAdapter, "airenos-session-ed25519");
});

test("Gate159 fails closed on non-canonical auth or secret transport", () => {
  for (const overrides of [
    { AUTH_ADAPTER: "signed-session" },
    { AIRENOS_SESSION_ISSUER: "http://session.airen.info" },
    { SECRET_MANAGER_ADAPTER: "vault" },
    { DATABASE_URL_SECRET_REF: "secret://vault/FOUNDATION_ATTACHMENT_DATABASE_URL" },
    { AUTH_SESSION_PUBLIC_KEYS_JSON: "{}" },
  ]) {
    assert.throws(
      () => loadFoundationAttachmentRuntimeEnvironment(environment(overrides)),
      (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID",
    );
  }
});

test("Gate159 rejects raw DATABASE_URL material and malformed routing domain", () => {
  assert.throws(
    () => loadFoundationAttachmentRuntimeEnvironment(environment({ DATABASE_URL: "postgresql://should-not-be-direct" })),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID",
  );
  assert.throws(
    () => loadFoundationAttachmentRuntimeEnvironment(environment({ APP_BASE_DOMAIN: "https://airen.info" })),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID",
  );
});
