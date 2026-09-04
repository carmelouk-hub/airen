import { createPrivateKey, createPublicKey } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { AppError } from "../packages/shared-contracts/src/index.ts";
import { parseSecretRef } from "../packages/platform-core/src/index.ts";
import { EnvironmentSecretProvider } from "../packages/integrations/src/index.ts";
import { classifyError } from "../packages/observability/src/index.ts";
import { startAirenOSSessionAuthorityStagingServer } from "../apps/api/src/session-authority-staging-server.ts";
import { bootstrapAirenOSSessionSigningKey } from "../scripts/bootstrap-airenos-session-signing-key.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

type SigningMaterial = Readonly<{
  privateKeyPem: string;
  publicKeyringText: string;
}>;

function required(environment: EnvironmentInput, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required Session Authority runtime field: ${key}`, { field: key });
  return value;
}

function exactBoolean(environment: EnvironmentInput, key: string, fallback: boolean): boolean {
  const raw = environment[key]?.trim();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", `${key} must be true or false`, { field: key });
}

function outsideWorktree(path: string): boolean {
  const worktree = resolve(process.cwd());
  const target = resolve(path);
  const rel = relative(worktree, target);
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

async function existingRegular0600(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session signing material must be regular files, not links or special files");
    if ((info.mode & 0o777) !== 0o600) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session signing material must have mode 0600");
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") return false;
    throw error;
  }
}

function publicKeyringRecord(raw: string, keyId: string): JsonWebKey {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session public keyring is invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session public keyring must be a JSON object");
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session public keyring contains an invalid record");
    const record = value as Record<string, unknown>;
    if (typeof record.enabled !== "boolean" || !record.key || typeof record.key !== "object" || Array.isArray(record.key)) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session public keyring contains an invalid public key record");
    }
    const key = record.key as JsonWebKey;
    if (key.kty !== "OKP" || key.crv !== "Ed25519" || typeof key.x !== "string" || !key.x || key.d) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session public keyring must contain Ed25519 public-only JWKs");
    }
    if (kid === keyId) {
      if (record.enabled !== true) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Configured Session Authority key id is disabled");
      return key;
    }
  }
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Configured Session Authority key id is missing from the public keyring");
}

async function prepareSigningMaterial(environment: EnvironmentInput): Promise<SigningMaterial> {
  const keyId = required(environment, "AIRENOS_SESSION_KEY_ID");
  const privateKeyPath = required(environment, "AIRENOS_SESSION_PRIVATE_KEY_PATH");
  const publicKeyringPath = required(environment, "AIRENOS_SESSION_PUBLIC_KEYRING_PATH");
  if (!isAbsolute(privateKeyPath) || !isAbsolute(publicKeyringPath) || !outsideWorktree(privateKeyPath) || !outsideWorktree(publicKeyringPath)) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Live Session Authority signing material must use absolute paths outside the repository/worktree");
  }
  if (resolve(privateKeyPath) === resolve(publicKeyringPath)) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Private key and public keyring paths must be different");
  }

  let privateExists = await existingRegular0600(privateKeyPath);
  let publicExists = await existingRegular0600(publicKeyringPath);
  if (privateExists !== publicExists) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session signing material is incomplete; refusing partial key state");
  }

  if (!privateExists) {
    if (!exactBoolean(environment, "AIRENOS_SESSION_BOOTSTRAP_IF_MISSING", false)) {
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session signing material is absent and bootstrap is not enabled");
    }
    await bootstrapAirenOSSessionSigningKey({
      kid: keyId,
      privateKeyPath,
      publicKeyringPath,
      forbiddenRoot: process.cwd(),
    });
    privateExists = await existingRegular0600(privateKeyPath);
    publicExists = await existingRegular0600(publicKeyringPath);
    if (!privateExists || !publicExists) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session signing material bootstrap did not produce a complete key pair");
    process.stdout.write(`${JSON.stringify({ event: "airenos.session_authority.signing_material_bootstrapped", keyId, privateKeyMaterialEmitted: false })}\n`);
  }

  const [privateKeyPem, publicKeyringText] = await Promise.all([
    readFile(privateKeyPath, "utf8"),
    readFile(publicKeyringPath, "utf8"),
  ]);
  const publicJwk = publicKeyringRecord(publicKeyringText, keyId);

  let privateKey;
  try { privateKey = createPrivateKey(privateKeyPem); }
  catch { throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session signing private key is invalid"); }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session signing private key must be Ed25519");
  const derived = createPublicKey(privateKey).export({ format: "jwk" });
  if (derived.kty !== "OKP" || derived.crv !== "Ed25519" || derived.x !== publicJwk.x) {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session signing private key does not match configured public keyring");
  }

  return Object.freeze({ privateKeyPem, publicKeyringText });
}

async function resolveDatabaseUrl(environment: EnvironmentInput): Promise<string> {
  const adapter = required(environment, "SECRET_MANAGER_ADAPTER");
  if (adapter !== "env") throw new AppError("RUNTIME_CONFIGURATION_INVALID", "F2.3 Render staging currently supports only the env SecretProvider adapter", { field: "SECRET_MANAGER_ADAPTER" });
  const ref = parseSecretRef(required(environment, "SESSION_AUTHORITY_DATABASE_URL_SECRET_REF"), "SESSION_AUTHORITY_DATABASE_URL_SECRET_REF");
  if (ref.provider !== adapter) throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Session Authority database SecretRef provider must match SECRET_MANAGER_ADAPTER");
  const provider = new EnvironmentSecretProvider(environment, [ref.key]);
  const secret = await provider.resolve(ref);
  let databaseUrl = "";
  await secret.use((value) => { databaseUrl = value; });
  if (!databaseUrl) throw new AppError("SECRET_RESOLUTION_FAILED", "Session Authority database URL secret resolved empty");
  return databaseUrl;
}

async function main(): Promise<void> {
  const [databaseUrl, signing] = await Promise.all([
    resolveDatabaseUrl(process.env),
    prepareSigningMaterial(process.env),
  ]);
  const service = await startAirenOSSessionAuthorityStagingServer(process.env, {
    databaseUrl,
    privateKeyPem: signing.privateKeyPem,
    publicKeyringText: signing.publicKeyringText,
  });
  const shutdown = (signal: string) => {
    void service.stop(signal).then(() => { process.exitCode = 0; });
  };
  process.once("SIGTERM", () => shutdown("sigterm"));
  process.once("SIGINT", () => shutdown("sigint"));
}

main().catch((error: unknown) => {
  const classification = classifyError(error);
  process.stderr.write(`${JSON.stringify({ event: "airenos.session_authority.service_start_failed", errorCode: classification.code })}\n`);
  process.exitCode = 1;
});
