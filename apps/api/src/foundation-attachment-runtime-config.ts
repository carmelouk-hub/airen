import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import { parseSecretRef } from "../../../packages/platform-core/src/index.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export type FoundationAttachmentRuntimeEnvironment = Readonly<{
  nodeEnv: "development" | "test" | "production";
  appBaseDomain: string;
  authAdapter: "airenos-session-ed25519";
  authAudience: string;
  sessionIssuer: string;
  sessionPublicKeysJson: string;
  secretManagerAdapter: "env";
  databaseUrlRef: ReturnType<typeof parseSecretRef>;
}>;

function fail(message: string, field: string): never {
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", message, { field });
}

function required(input: EnvironmentInput, key: string): string {
  const value = input[key]?.trim();
  if (!value) fail(`Missing required Foundation Attachment runtime field: ${key}`, key);
  return value;
}

function parseNodeEnv(raw: string): FoundationAttachmentRuntimeEnvironment["nodeEnv"] {
  if (raw === "development" || raw === "test" || raw === "production") return raw;
  return fail("NODE_ENV must be development, test, or production", "NODE_ENV");
}

function parseBaseDomain(raw: string): string {
  const value = raw.toLowerCase().replace(/\.$/, "");
  if (value.includes("://") || value.includes("/") || !value.includes(".")) {
    return fail("APP_BASE_DOMAIN must be a bare DNS domain", "APP_BASE_DOMAIN");
  }
  if (!/^[a-z0-9.-]+$/.test(value) || value.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"))) {
    return fail("APP_BASE_DOMAIN is not a valid DNS domain", "APP_BASE_DOMAIN");
  }
  return value;
}

function cleanHttpsIssuer(raw: string): string {
  let url: URL;
  try { url = new URL(raw); }
  catch { return fail("AIRENOS_SESSION_ISSUER must be an absolute HTTPS URL", "AIRENOS_SESSION_ISSUER"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    return fail("AIRENOS_SESSION_ISSUER must be a clean HTTPS URL", "AIRENOS_SESSION_ISSUER");
  }
  return url.toString().replace(/\/$/, "");
}

function validatePublicKeyring(raw: string): string {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) {
      return fail("AUTH_SESSION_PUBLIC_KEYS_JSON must be a non-empty JSON object", "AUTH_SESSION_PUBLIC_KEYS_JSON");
    }
  } catch {
    return fail("AUTH_SESSION_PUBLIC_KEYS_JSON must be valid JSON", "AUTH_SESSION_PUBLIC_KEYS_JSON");
  }
  return raw;
}

export function loadFoundationAttachmentRuntimeEnvironment(input: EnvironmentInput): FoundationAttachmentRuntimeEnvironment {
  if (input.DATABASE_URL?.trim()) {
    fail("DATABASE_URL must not be supplied directly; use DATABASE_URL_SECRET_REF", "DATABASE_URL");
  }

  const nodeEnv = parseNodeEnv(required(input, "NODE_ENV"));
  const appBaseDomain = parseBaseDomain(required(input, "APP_BASE_DOMAIN"));

  const authAdapter = required(input, "AUTH_ADAPTER");
  if (authAdapter !== "airenos-session-ed25519") {
    fail("AUTH_ADAPTER must be airenos-session-ed25519 for Foundation Attachment", "AUTH_ADAPTER");
  }

  const authAudience = required(input, "AUTH_AUDIENCE");
  if (authAudience.length > 160) fail("AUTH_AUDIENCE is too long", "AUTH_AUDIENCE");

  const sessionIssuer = cleanHttpsIssuer(required(input, "AIRENOS_SESSION_ISSUER"));
  const sessionPublicKeysJson = validatePublicKeyring(required(input, "AUTH_SESSION_PUBLIC_KEYS_JSON"));

  const secretManagerAdapter = required(input, "SECRET_MANAGER_ADAPTER");
  if (secretManagerAdapter !== "env") {
    fail("Foundation Attachment staging currently requires SECRET_MANAGER_ADAPTER=env", "SECRET_MANAGER_ADAPTER");
  }

  const databaseUrlRef = parseSecretRef(required(input, "DATABASE_URL_SECRET_REF"), "DATABASE_URL_SECRET_REF");
  if (databaseUrlRef.provider !== secretManagerAdapter) {
    fail("DATABASE_URL_SECRET_REF provider must match SECRET_MANAGER_ADAPTER", "DATABASE_URL_SECRET_REF");
  }

  return Object.freeze({
    nodeEnv,
    appBaseDomain,
    authAdapter,
    authAudience,
    sessionIssuer,
    sessionPublicKeysJson,
    secretManagerAdapter,
    databaseUrlRef,
  });
}
