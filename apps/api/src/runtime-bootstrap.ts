import { AppError } from "../../../packages/shared-contracts/src/index.ts";
import { loadFoundationRuntimeEnvironment, runtimeEnvironmentDiagnostics, type FoundationRuntimeEnvironment } from "../../../packages/platform-core/src/index.ts";
import { HmacSignedSessionVerifier, type SecretProvider } from "../../../packages/integrations/src/index.ts";
import { createFoundationObservabilityRuntime, type FoundationObservabilityRuntime, type LogSink, type MetricSink } from "../../../packages/observability/src/index.ts";

export type FoundationRuntimeBootstrap = Readonly<{
  config: FoundationRuntimeEnvironment;
  diagnostics: Readonly<Record<string, unknown>>;
  observability: FoundationObservabilityRuntime;
  withDatabaseConnectionString<T>(consumer: (connectionString: string) => T): T;
  createReferenceSignedSessionVerifier(options?: { now?: () => number; clockSkewSeconds?: number }): HmacSignedSessionVerifier;
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
    createReferenceSignedSessionVerifier(options?: { now?: () => number; clockSkewSeconds?: number }): HmacSignedSessionVerifier {
      return authSessionKey.use((verificationKey) => new HmacSignedSessionVerifier({
        providerKey: config.authProviderKey,
        audience: config.authAudience,
        verificationKey,
        now: options?.now,
        clockSkewSeconds: options?.clockSkewSeconds
      }));
    }
  });
}
