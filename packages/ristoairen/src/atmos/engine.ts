import type {
  AtmosDaypart,
  AtmosEventWindowV1,
  AtmosPresentationConfigV1,
  AtmosSeason,
  AtmosStateV1,
} from "./contracts.ts";

export const DEFAULT_ATMOS_PRESENTATION_CONFIG: AtmosPresentationConfigV1 = Object.freeze({
  enabled: true,
  timezone: "UTC",
  intensity: 1,
  transitionMs: 600,
  thresholds: Object.freeze({
    dawnStart: "06:00",
    dayStart: "11:00",
    goldenStart: "17:30",
    nightStart: "20:30",
  }),
  seasonMode: "AUTO",
});

function parseHHMM(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function localParts(date: Date, timezone: string): { minuteOfDay: number; month: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      month: "2-digit",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
    return { minuteOfDay: hour * 60 + minute, month };
  } catch {
    return { minuteOfDay: date.getUTCHours() * 60 + date.getUTCMinutes(), month: date.getUTCMonth() + 1 };
  }
}

function automaticSeason(month: number): AtmosSeason {
  if (month >= 3 && month <= 5) return "SPRING";
  if (month >= 6 && month <= 8) return "SUMMER";
  if (month >= 9 && month <= 11) return "AUTUMN";
  return "WINTER";
}

export function findActiveAtmosEvent(events: readonly AtmosEventWindowV1[], at: Date): AtmosEventWindowV1 | undefined {
  const instant = at.getTime();
  return events.find((event) => {
    const start = Date.parse(event.startsAt);
    if (!Number.isFinite(start)) return false;
    const end = event.endsAt ? Date.parse(event.endsAt) : start + 24 * 60 * 60 * 1000;
    return Number.isFinite(end) && instant >= start && instant <= end;
  });
}

export function resolveAtmosDaypart(
  config: AtmosPresentationConfigV1,
  at: Date,
  events: readonly AtmosEventWindowV1[] = [],
): AtmosDaypart {
  if (config.previewDaypart) {
    const expires = config.previewExpiresAt ? Date.parse(config.previewExpiresAt) : Number.POSITIVE_INFINITY;
    if (at.getTime() < expires) return config.previewDaypart;
  }
  if (!config.enabled) return "DAY";
  if (findActiveAtmosEvent(events, at)) return "EVENT";

  const { minuteOfDay } = localParts(at, config.timezone);
  const dawn = parseHHMM(config.thresholds.dawnStart) ?? 360;
  const day = parseHHMM(config.thresholds.dayStart) ?? 660;
  const golden = parseHHMM(config.thresholds.goldenStart) ?? 1050;
  const night = parseHHMM(config.thresholds.nightStart) ?? 1230;
  if (minuteOfDay >= night) return "NIGHT";
  if (minuteOfDay >= golden) return "GOLDEN";
  if (minuteOfDay >= day) return "DAY";
  if (minuteOfDay >= dawn) return "DAWN";
  return "NIGHT";
}

export function resolveAtmosSeason(config: AtmosPresentationConfigV1, at: Date): AtmosSeason {
  if (config.seasonMode === "FIXED" && config.forcedSeason) return config.forcedSeason;
  return automaticSeason(localParts(at, config.timezone).month);
}

export function resolveAtmosState(
  config: AtmosPresentationConfigV1,
  at: Date = new Date(),
  events: readonly AtmosEventWindowV1[] = [],
): AtmosStateV1 {
  const activeEvent = findActiveAtmosEvent(events, at);
  const daypart = resolveAtmosDaypart(config, at, events);
  return Object.freeze({
    daypart,
    season: resolveAtmosSeason(config, at),
    enabled: config.enabled,
    intensity: config.intensity,
    transitionMs: config.transitionMs,
    isPreview: Boolean(config.previewDaypart && (!config.previewExpiresAt || at.getTime() < Date.parse(config.previewExpiresAt))),
    activeEvent: daypart === "EVENT" ? activeEvent : undefined,
    presentationToken: daypart === "EVENT" ? activeEvent?.presentationToken : undefined,
  });
}

export function previewAtmosState(
  config: AtmosPresentationConfigV1,
  isoDateTime: string,
  events: readonly AtmosEventWindowV1[] = [],
): AtmosStateV1 | null {
  const at = new Date(isoDateTime);
  if (Number.isNaN(at.getTime())) return null;
  return resolveAtmosState(config, at, events);
}
