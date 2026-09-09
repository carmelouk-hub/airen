import type { ResourceScope, SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";

export const ATMOS_DAYPARTS = ["DAWN", "DAY", "GOLDEN", "NIGHT", "EVENT"] as const;
export type AtmosDaypart = (typeof ATMOS_DAYPARTS)[number];

export const ATMOS_SEASONS = ["SPRING", "SUMMER", "AUTUMN", "WINTER"] as const;
export type AtmosSeason = (typeof ATMOS_SEASONS)[number];

export type AtmosSeasonMode = "AUTO" | "FIXED";

export type AtmosDaypartThresholdsV1 = Readonly<{
  dawnStart: string;
  dayStart: string;
  goldenStart: string;
  nightStart: string;
}>;

export type AtmosPresentationConfigV1 = Readonly<{
  enabled: boolean;
  timezone: string;
  intensity: number;
  transitionMs: number;
  thresholds: AtmosDaypartThresholdsV1;
  seasonMode: AtmosSeasonMode;
  forcedSeason?: AtmosSeason;
  previewDaypart?: AtmosDaypart;
  previewExpiresAt?: string;
}>;

export type AtmosPresentationTokenV1 = Readonly<{
  primaryActionKey?: string;
  secondaryActionKey?: string;
}>;

export type AtmosEventWindowV1 = Readonly<{
  startsAt: string;
  endsAt?: string;
  presentationToken?: AtmosPresentationTokenV1;
}>;

export type AtmosResolvedBundleV1 = Readonly<{
  scope: ResourceScope;
  config: AtmosPresentationConfigV1;
  events: readonly AtmosEventWindowV1[];
}>;

export type AtmosStateV1 = Readonly<{
  daypart: AtmosDaypart;
  season: AtmosSeason;
  enabled: boolean;
  intensity: number;
  transitionMs: number;
  isPreview: boolean;
  activeEvent?: AtmosEventWindowV1;
  presentationToken?: AtmosPresentationTokenV1;
}>;

export type AtmosConfigMutationInputV1 = Readonly<{
  locationId?: UUID;
  config: AtmosPresentationConfigV1;
  expectedRowVersion: number;
}>;

export type AtmosConfigMutationResultV1 = Readonly<{
  configId: UUID;
  rowVersion: number;
  replayed: boolean;
}>;

export interface AtmosConfigurationRepository {
  resolveEffective(scope: ResourceScope): Promise<AtmosResolvedBundleV1>;
  saveConfiguration(
    context: SecurityContext,
    input: AtmosConfigMutationInputV1,
    idempotencyKey: string,
  ): Promise<AtmosConfigMutationResultV1>;
}

export interface AtmosProductAccessGuard {
  assertRistoAirenAccess(context: SecurityContext): void | Promise<void>;
}
