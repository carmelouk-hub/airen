import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildRa01RuntimeDatabaseUrl,
  deriveRa01RuntimeDatabasePassword,
  loadRa01RuntimeDatabaseConfig
} from "../../deploy/ra01-runtime-database-principal.ts";

const read = (path: string) => readFile(path, "utf8");

test("RA-01 Render staging blueprint is isolated, fail-closed and non-production", async () => {
  const blueprint = await read("render.ra01.yaml");
  assert.match(blueprint, /name: airenos-ra01-foundation-staging/);
  assert.match(blueprint, /branch: foundation\/ra01-ristoairen-product-attachment-20260903/);
  assert.match(blueprint, /dockerfilePath: \.\/deploy\/Dockerfile\.ra01/);
  assert.match(blueprint, /healthCheckPath: \/health\/ready/);
  assert.match(blueprint, /autoDeployTrigger: checksPass/);
  assert.match(blueprint, /preDeployCommand: node --experimental-strip-types deploy\/migrate-ra01-foundation\.ts/);
  assert.match(blueprint, /key: AUTH_ADAPTER\s+value: airenos-session-ed25519/);
  assert.match(blueprint, /key: AUTH_PROVIDER_KEY\s+value: airenos-session-authority/);
  assert.match(blueprint, /key: AIRENOS_SESSION_ISSUER\s+value: https:\/\/session\.airenos\.com/);
  assert.match(blueprint, /key: AUTH_SESSION_PUBLIC_KEYS_JSON\s+sync: false/);
  assert.match(blueprint, /key: APP_BASE_DOMAIN\s+value: ra01-staging\.invalid/);
  assert.match(blueprint, /key: DATABASE_URL_SECRET_REF\s+value: secret:\/\/env\/RA01_RUNTIME_DATABASE_URL/);
  assert.match(blueprint, /key: AIREN_RUNTIME_ROLE_PROVISIONING_MODE\s+value: bootstrap/);
  assert.match(blueprint, /key: AIREN_BOOKING_ADAPTER_ENABLED\s+value: "false"/);
  assert.match(blueprint, /key: AIREN_BOOKING_PROJECTION_ENABLED\s+value: "false"/);
  assert.match(blueprint, /key: AIREN_BOOKING_MUTATION_ENABLED\s+value: "false"/);
  assert.match(blueprint, /ipAllowList: \[\]/);
  assert.doesNotMatch(blueprint, /base44-rbl01c2|ristoairen-booking-rbl01c2|STRIPE_|AIRenPay|airenpay/i);
  assert.doesNotMatch(blueprint, /NODE_ENV\s*\n\s*value: production/);
  assert.doesNotMatch(blueprint, /AIRENOS_SESSION_PRIVATE_KEY|SESSION_SIGNING_PRIVATE|PRIVATE_SIGNING_KEY/);
});

test("RA-01 staging entrypoint uses the canonical AIRenOS F0/F1 authentication composition only", async () => {
  const migration = await read("deploy/migrate-ra01-foundation.ts");
  const runtime = await read("deploy/ra01-runtime-entry.ts");
  const stagingServer = await read("apps/api/src/ra01-staging-server.ts");
  const dockerfile = await read("deploy/Dockerfile.ra01");
  const lifecycleMigration = await read("db/migrations/0035_airenos_session_lifecycle.sql");

  assert.match(migration, /migrateFoundationDatabase/);
  assert.match(migration, /provisionRa01RuntimeDatabasePrincipal/);
  assert.doesNotMatch(migration, /migrate-ristoairen-booking|seed-rbl01d|airenpay/i);

  assert.match(runtime, /RA01_RUNTIME_DATABASE_URL/);
  assert.match(runtime, /startRa01FoundationHttpServer/);
  assert.doesNotMatch(runtime, /startFoundationHttpServer|createRistoBookingHoldRuntime|expiryWorker|RBL01C2/);

  assert.match(stagingServer, /AirenOSSessionAuthenticationAdapter/);
  assert.match(stagingServer, /Ed25519AirenOSSessionVerifier/);
  assert.match(stagingServer, /RevocationAwareAirenOSSessionVerifier/);
  assert.match(stagingServer, /PostgresAirenOSSessionLifecycleStore/);
  assert.match(stagingServer, /airenos-session-ed25519/);
  assert.doesNotMatch(stagingServer, /ProviderNeutralAuthenticationAdapter|createRistoBookingRuntime|dispatchAdminApiRequest/);

  assert.match(lifecycleMigration, /CREATE TABLE identity\.airenos_sessions/);
  assert.match(lifecycleMigration, /GRANT EXECUTE ON FUNCTION security\.resolve_active_airenos_session/);
  assert.doesNotMatch(lifecycleMigration, /access_token|refresh_token|private_key/i);

  assert.match(dockerfile, /deploy\/ra01-runtime-entry\.ts/);
  assert.doesNotMatch(dockerfile, /deploy\/runtime-entry\.ts/);
});

test("RA-01 runtime database principal is deterministic and least-privilege scoped", async () => {
  const config = loadRa01RuntimeDatabaseConfig({
    RA01_RUNTIME_DB_HOST: "internal-db.example",
    RA01_RUNTIME_DB_PORT: "5432",
    RA01_RUNTIME_DB_NAME: "airenos_ra01_staging",
    RA01_RUNTIME_DB_USER: "airen_ra01_runtime",
    RA01_RUNTIME_DB_SEED: "0123456789abcdef0123456789abcdef"
  });
  assert.ok(config);
  const password = deriveRa01RuntimeDatabasePassword(config);
  assert.equal(password.length, 43);
  const url = new URL(buildRa01RuntimeDatabaseUrl(config));
  assert.equal(url.hostname, "internal-db.example");
  assert.equal(url.port, "5432");
  assert.equal(url.username, "airen_ra01_runtime");
  assert.equal(url.pathname, "/airenos_ra01_staging");

  const principal = await read("deploy/ra01-runtime-database-principal.ts");
  assert.match(principal, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
  assert.match(principal, /REVOKE airen_control_plane_owner/);
  assert.match(principal, /GRANT airen_app/);
  assert.match(principal, /GRANT airen_auth/);
  assert.match(principal, /GRANT airen_control_plane/);
});
