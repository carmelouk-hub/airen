import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import type { SessionCredentialVerifier } from "../../../packages/identity/src/index.ts";
import { loadFoundationRuntimeEnvironment, runtimeEnvironmentDiagnostics, type FoundationRuntimeEnvironment } from "../../../packages/platform-core/src/index.ts";
import { HmacSignedSessionVerifier, type SecretProvider } from "../../../packages/integrations/src/index.ts";
import { Ed25519SignedSessionVerifier } from "../../../packages/integrations/src/ed25519-signed-session.ts";
import { createFoundationObservabilityRuntime, type FoundationObservabilityRuntime, type LogSink, type MetricSink } from "../../../packages/observability/src/index.ts";

export type FoundationRuntimeBootstrap = Readonly<{
  config: FoundationRuntimeEnvironment;
  diagnostics: Readonly<Record<string, unknown>>;
  observability: FoundationObservabilityRuntime;
  withDatabaseConnectionString<T>(consumer: (connectionString: string) => T): T;
  createReferenceSignedSessionVerifier(options?: { now?: () => number; clockSkewSeconds?: number }): SessionCredentialVerifier;
}>;

export async function bootstrapFoundationRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  secrets: SecretProvider,
  options?: Readonly<{ logSink?: LogSink; metricSink?: MetricSink; now?: () => Date }>
): Promise<FoundationRuntimeBootstrap> {
  const config = loadFoundationRuntimeEnvironment(environment);
  if (secrets.providerKey !== config.secretManagerAdapter) {
    throw new AppError("SECRET_RESOLUTION_FAILED", "Configured secret provider does not match active runtime environment");
  }

  const [databaseUrl, authSessionKey] = await Promise.all([
    secrets.resolve(config.databaseUrlRef),
    secrets.resolve(config.authSessionKeyRef)
  ]);

  const observability = createFoundationObservabilityRuntime({
    service: "airenos-api",
    environment: config.nodeEnv,
    logSink: options?.logSink,
    metricSink: options?.metricSink,
    now: options?.now
  });

  return Object.freeze({
    config,
    diagnostics: runtimeEnvironmentDiagnostics(config),
    observability,
    withDatabaseConnectionString<T>(consumer: (connectionString: string) => T): T {
      return databaseUrl.use(consumer);
    },
    createReferenceSignedSessionVerifier(options?: { now?: () => number; clockSkewSeconds?: number }): SessionCredentialVerifier {
      if (config.authAdapter === "signed-session") {
        return authSessionKey.use((verificationKey) => new HmacSignedSessionVerifier({
          providerKey: config.authProviderKey,
          audience: config.authAudience,
          verificationKey,
          now: options?.now,
          clockSkewSeconds: options?.clockSkewSeconds
        }));
      }
      if (config.authAdapter === "ed25519-signed-session") {
        const publicKeysJson = environment.AUTH_SESSION_PUBLIC_KEYS_JSON?.trim();
        if (!publicKeysJson) {
          throw new AppError("RUNTIME_CONFIGURATION_INVALID", "AUTH_SESSION_PUBLIC_KEYS_JSON is required for ed25519-signed-session", { field: "AUTH_SESSION_PUBLIC_KEYS_JSON" });
        }
        try {
          return new Ed25519SignedSessionVerifier({
            providerKey: config.authProviderKey,
            audience: config.authAudience,
            publicKeysJson,
            now: options?.now,
            clockSkewSeconds: options?.clockSkewSeconds
          });
        } catch {
          throw new AppError("RUNTIME_CONFIGURATION_INVALID", "AUTH_SESSION_PUBLIC_KEYS_JSON is invalid", { field: "AUTH_SESSION_PUBLIC_KEYS_JSON" });
        }
      }
      throw new AppError("RUNTIME_CONFIGURATION_INVALID", "Unsupported AUTH_ADAPTER", { field: "AUTH_ADAPTER" });
    }
  });
}
