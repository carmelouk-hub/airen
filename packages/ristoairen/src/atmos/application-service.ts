import { AppError, type ResourceScope, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import type {
  AtmosConfigMutationInputV1,
  AtmosConfigMutationResultV1,
  AtmosConfigurationRepository,
  AtmosProductAccessGuard,
  AtmosResolvedBundleV1,
  AtmosStateV1,
} from "./contracts.ts";
import { previewAtmosState, resolveAtmosState } from "./engine.ts";
import { requireAtmosWrite, validateAtmosMutation } from "./policy.ts";

export class AtmosApplicationService {
  constructor(
    private readonly repository: AtmosConfigurationRepository,
    private readonly productAccess: AtmosProductAccessGuard,
  ) {}

  async resolvePublicPresentation(scope: ResourceScope, at: Date = new Date()): Promise<{ bundle: AtmosResolvedBundleV1; state: AtmosStateV1 }> {
    const bundle = await this.repository.resolveEffective(scope);
    return Object.freeze({ bundle, state: resolveAtmosState(bundle.config, at, bundle.events) });
  }

  async preview(scope: ResourceScope, isoDateTime: string): Promise<AtmosStateV1 | null> {
    const bundle = await this.repository.resolveEffective(scope);
    return previewAtmosState(bundle.config, isoDateTime, bundle.events);
  }

  async saveConfiguration(
    context: SecurityContext,
    input: AtmosConfigMutationInputV1,
    idempotencyKey: string,
  ): Promise<AtmosConfigMutationResultV1> {
    await this.productAccess.assertRistoAirenAccess(context);
    requireAtmosWrite(context, input);
    if (!idempotencyKey?.trim()) throw new AppError("VALIDATION_FAILED", "ATMOS_IDEMPOTENCY_KEY_REQUIRED");
    return this.repository.saveConfiguration(context, validateAtmosMutation(input), idempotencyKey.trim());
  }
}
