import { AppError, type SecretRef } from "../../shared-contracts/src/index.ts";

export type FoundationRuntimeEnvironment = Readonly<{
  nodeEnv: "development" | "test" | "production";
  appBaseDomain: string;
  authAdapter: string;
  authProviderKey: string;
  authAudience: string;
  secretManagerAdapter: string;
  databaseUrlRef: SecretRef;
  authSessionKeyRef: SecretRef;
  objectStorageAdapter?: string;
  realtimeAdapter?: string;
}>;

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

const identifierPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const secretKeyPattern = /^[A-Za-z0-9._/-]{1,160}$/;
const versionPattern = /^[A-Za-z0-9._-]{1,80}$/;
const directSecretNames = ["DATABASE_URL", "AUTH_SESSION_KEY"] as const;

function fail(message: string, field?: string): never {
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", message, field ? { field } : undefined);
}

function required(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim();
  if (!value) fail(`Missing required runtime environment field: ${key}`, key);
  return value;
}

function parseNodeEnv(raw: string): FoundationRuntimeEnvironment["nodeEnv"] {
  if (raw === "development" || raw === "test" || raw === "production") return raw;
  return fail("NODE_ENV must be development, test, or production", "NODE_ENV");
}

function parseIdentifier(raw: string, field: string): string {
  if (!identifierPattern.test(raw)) fail(`${field} must be a lowercase provider/adapter identifier`, field);
  return raw;
}

function parseBaseDomain(raw: string): string {
  const value = raw.toLowerCase().replace(/\.$/, "");
  if (value.includes("://") || value.includes("/") || !value.includes(".")) fail("APP_BASE_DOMAIN must be a bare DNS domain", "APP_BASE_DOMAIN");
  if (!/^[a-z0-9.-]+$/.test(value) || value.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"))) fail("APP_BASE_DOMAIN is not a valid DNS domain", "APP_BASE_DOMAIN");
  return value;
}

export function parseSecretRef(raw: string, field: string): SecretRef {
  let url: URL;
  try { url = new URL(raw); } catch { return fail(`${field} must be a secret:// reference`, field); }
  if (url.protocol.replace(/:$/, "") !== "secret") fail(`${field} must use the secret:// scheme`, field);
  const provider = url.hostname;
  const key = url.pathname.replace(/^\//, "");
  const version = url.searchParams.get("version") ?? undefined;
  if (!identifierPattern.test(provider)) fail(`${field} contains an invalid secret provider`, field);
  if (!secretKeyPattern.test(key)) fail(`${field} contains an invalid secret key`, field);
  if (version && !versionPattern.test(version)) fail(`${field} contains an invalid secret version`, field);
  if ([...url.searchParams.keys()].some((name) => name !== "version")) fail(`${field} contains unsupported secret reference parameters`, field);
  return Object.freeze({ provider, key, ...(version ? { version } : {}) });
}

export function loadFoundationRuntimeEnvironment(input: EnvironmentInput): FoundationRuntimeEnvironment {
  for (const name of directSecretNames) {
    if (input[name]?.trim()) fail(`${name} must not be supplied directly; use the corresponding *_SECRET_REF`, name);
  }

  const nodeEnv = parseNodeEnv(required(input, "NODE_ENV"));
  const appBaseDomain = parseBaseDomain(required(input, "APP_BASE_DOMAIN"));
  const authAdapter = parseIdentifier(required(input, "AUTH_ADAPTER"), "AUTH_ADAPTER");
  const authProviderKey = parseIdentifier(required(input, "AUTH_PROVIDER_KEY"), "AUTH_PROVIDER_KEY");
  const authAudience = required(input, "AUTH_AUDIENCE");
  if (authAudience.length > 160) fail("AUTH_AUDIENCE is too long", "AUTH_AUDIENCE");
  const secretManagerAdapter = parseIdentifier(required(input, "SECRET_MANAGER_ADAPTER"), "SECRET_MANAGER_ADAPTER");
  const databaseUrlRef = parseSecretRef(required(input, "DATABASE_URL_SECRET_REF"), "DATABASE_URL_SECRET_REF");
  const authSessionKeyRef = parseSecretRef(required(input, "AUTH_SESSION_KEY_SECRET_REF"), "AUTH_SESSION_KEY_SECRET_REF");

  for (const [field, ref] of [["DATABASE_URL_SECRET_REF", databaseUrlRef], ["AUTH_SESSION_KEY_SECRET_REF", authSessionKeyRef]] as const) {
    if (ref.provider !== secretManagerAdapter) fail(`${field} provider must match SECRET_MANAGER_ADAPTER`, field);
  }

  const optionalAdapter = (key: string): string | undefined => {
    const raw = input[key]?.trim();
    return raw ? parseIdentifier(raw, key) : undefined;
  };

  return Object.freeze({
    nodeEnv,
    appBaseDomain,
    authAdapter,
    authProviderKey,
    authAudience,
    secretManagerAdapter,
    databaseUrlRef,
    authSessionKeyRef,
    objectStorageAdapter: optionalAdapter("OBJECT_STORAGE_ADAPTER"),
    realtimeAdapter: optionalAdapter("REALTIME_ADAPTER")
  });
}

export function runtimeEnvironmentDiagnostics(config: FoundationRuntimeEnvironment): Readonly<Record<string, unknown>> {
  return Object.freeze({
    nodeEnv: config.nodeEnv,
    appBaseDomain: config.appBaseDomain,
    authAdapter: config.authAdapter,
    authProviderKey: config.authProviderKey,
    authAudience: config.authAudience,
    secretManagerAdapter: config.secretManagerAdapter,
    databaseUrlRef: { provider: config.databaseUrlRef.provider, key: "[REDACTED_REF_KEY]", versioned: Boolean(config.databaseUrlRef.version) },
    authSessionKeyRef: { provider: config.authSessionKeyRef.provider, key: "[REDACTED_REF_KEY]", versioned: Boolean(config.authSessionKeyRef.version) },
    objectStorageAdapter: config.objectStorageAdapter,
    realtimeAdapter: config.realtimeAdapter
  });
}
