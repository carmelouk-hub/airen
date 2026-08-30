import type { KairosSourceSnapshot } from "./source-adapters.ts";

export type SecretFindingKind =
  | "PRIVATE_KEY"
  | "BEARER_TOKEN"
  | "PROVIDER_SECRET_KEY"
  | "CREDENTIAL_URL"
  | "PASSWORD_FIELD"
  | "CLIENT_SECRET_FIELD"
  | "PAN_FIELD"
  | "CVV_FIELD"
  | "SECRET_FILE_PATH";

export type SecretScanResult = Readonly<{
  status: "PASS" | "REJECTED";
  containsSecretValues: boolean;
  findingKinds: readonly SecretFindingKind[];
}>;

export class KairosSecretExclusionError extends Error {
  readonly findingKinds: readonly SecretFindingKind[];
  constructor(findingKinds: readonly SecretFindingKind[]) {
    super("Kairos secret-exclusion gate rejected source material");
    this.name = "KairosSecretExclusionError";
    this.findingKinds = Object.freeze([...findingKinds]);
  }
}

const CONTENT_RULES: readonly Readonly<{ kind: SecretFindingKind; pattern: RegExp }>[] = [
  { kind: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
  { kind: "BEARER_TOKEN", pattern: /\bauthorization\s*[:=]\s*bearer\s+[A-Za-z0-9._~+\/-]{8,}/i },
  { kind: "PROVIDER_SECRET_KEY", pattern: /\b(?:sk_(?:live|test)|gh[pousr]_|AKIA)[A-Za-z0-9_-]{8,}/ },
  { kind: "CREDENTIAL_URL", pattern: /\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s:@/]+:[^\s@/]{4,}@/i },
  { kind: "PASSWORD_FIELD", pattern: /\bpassword\s*[:=]\s*["']?(?!\$\{|<|REDACTED\b|secret:\/\/)[^\s,"'}]{6,}/i },
  { kind: "CLIENT_SECRET_FIELD", pattern: /\bclient_secret\s*[:=]\s*["']?(?!\$\{|<|REDACTED\b|secret:\/\/)[A-Za-z0-9._~+\/-]{8,}/i },
  { kind: "PAN_FIELD", pattern: /\bpan\s*[:=]\s*["']?\d{13,19}\b/i },
  { kind: "CVV_FIELD", pattern: /\bcvv\s*[:=]\s*["']?\d{3,4}\b/i },
];

function isSecretFilePath(snapshot: KairosSourceSnapshot): boolean {
  const rawPath = typeof snapshot.metadata.path === "string" ? snapshot.metadata.path : snapshot.title;
  const normalized = rawPath.replace(/\\/g, "/").toLowerCase();
  const basename = normalized.split("/").pop() ?? normalized;
  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "credentials.json" ||
    basename === "service-account.json" ||
    basename.endsWith(".pem") ||
    basename.endsWith(".p12") ||
    basename.endsWith(".pfx")
  );
}

export function scanKairosSourceForSecrets(snapshot: KairosSourceSnapshot, text: string): SecretScanResult {
  const findings = new Set<SecretFindingKind>();
  if (isSecretFilePath(snapshot)) findings.add("SECRET_FILE_PATH");
  for (const rule of CONTENT_RULES) if (rule.pattern.test(text)) findings.add(rule.kind);
  const findingKinds = Object.freeze([...findings].sort()) as readonly SecretFindingKind[];
  return Object.freeze({
    status: findingKinds.length ? "REJECTED" : "PASS",
    containsSecretValues: findingKinds.length > 0,
    findingKinds,
  });
}

export function assertKairosSecretFree(snapshot: KairosSourceSnapshot, text: string): SecretScanResult & Readonly<{ status: "PASS"; containsSecretValues: false }> {
  const result = scanKairosSourceForSecrets(snapshot, text);
  if (result.status !== "PASS" || result.containsSecretValues) throw new KairosSecretExclusionError(result.findingKinds);
  return result as SecretScanResult & Readonly<{ status: "PASS"; containsSecretValues: false }>;
}
