import { AppError, type SecurityContext } from "../../shared-contracts/src/index.ts";
import { AIREN_PAY_ENTITLEMENT } from "./contracts.ts";

export type AirenPayRuntimeConfigV1 = Readonly<{
  enabled?: boolean;
  providerMode?: string;
}>;

export type AirenPayRuntimeReadinessV1 = Readonly<{
  capability: typeof AIREN_PAY_ENTITLEMENT;
  enabled: boolean;
  entitled: boolean;
  providerMode: "TEST";
  ready: boolean;
}>;

function resolveProviderMode(config: AirenPayRuntimeConfigV1 | undefined): "TEST" {
  const providerMode = config?.providerMode ?? "TEST";
  if (providerMode !== "TEST") {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "AIRenPay runtime is TEST-only in Gate 034");
  }
  return "TEST";
}

export function resolveAirenPayRuntimeReadiness(
  context: SecurityContext,
  config?: AirenPayRuntimeConfigV1
): AirenPayRuntimeReadinessV1 {
  const providerMode = resolveProviderMode(config);
  const enabled = config?.enabled === true;
  const entitled = context.entitlements.includes(AIREN_PAY_ENTITLEMENT);
  return Object.freeze({
    capability: AIREN_PAY_ENTITLEMENT,
    enabled,
    entitled,
    providerMode,
    ready: enabled && entitled
  });
}

export function assertAirenPayRuntimeAccess(
  context: SecurityContext,
  config?: AirenPayRuntimeConfigV1
): AirenPayRuntimeReadinessV1 {
  const readiness = resolveAirenPayRuntimeReadiness(context, config);
  if (!readiness.enabled) {
    throw new AppError("PERMISSION_DENIED", "AIRenPay runtime is disabled by default");
  }
  if (!readiness.entitled) {
    throw new AppError("ENTITLEMENT_REQUIRED", `AIRenPay requires entitlement ${AIREN_PAY_ENTITLEMENT}`);
  }
  return readiness;
}
