import type { RecoveryCandidate } from "../baseline/contracts.ts";

export const RECOVERY_CANDIDATES = [
  {
    source: "ex-corte",
    module: "booking",
    domains: ["C001", "C002"],
    action: "REFACTOR",
    acceptanceTests: ["GJ2-003", "GJ2-004", "GJ2-032", "GJ2-034"],
  },
  {
    source: "ex-corte",
    module: "kds-bar-production",
    domains: ["C012"],
    action: "REFACTOR",
    acceptanceTests: ["GJ2-017", "GJ2-033", "GJ2-039"],
  },
  {
    source: "ex-corte",
    module: "cassa-pos",
    domains: ["C013"],
    action: "REFACTOR",
    acceptanceTests: ["GJ2-018", "GJ2-019", "GJ2-035"],
  },
  {
    source: "ex-corte",
    module: "crm-customer",
    domains: ["C002", "C003", "C007"],
    action: "REFACTOR",
    acceptanceTests: ["GJ2-006", "GJ2-007", "GJ2-011", "GJ2-032"],
  },
  {
    source: "ex-corte",
    module: "events-promoters",
    domains: ["C004", "C005"],
    action: "REFACTOR",
    acceptanceTests: ["GJ2-008", "GJ2-009", "GJ2-035"],
  },
  {
    source: "ex-corte",
    module: "seo-public-content",
    domains: ["C019"],
    action: "REFACTOR",
    acceptanceTests: ["GJ2-002", "GJ2-036"],
  },
  {
    source: "ex-corte",
    module: "stella",
    domains: ["C020"],
    action: "REFACTOR",
    acceptanceTests: ["GJ2-026", "GJ2-027", "GJ2-039"],
  },
  {
    source: "ex-corte",
    module: "atmos",
    domains: ["C019", "C023"],
    action: "REFACTOR",
    acceptanceTests: ["GJ2-002", "GJ2-030"],
  },
] as const satisfies readonly RecoveryCandidate[];

export const RECOVERY_PRIORITY = [
  "booking",
  "kds-bar-production",
  "cassa-pos",
  "crm-customer",
  "events-promoters",
  "seo-public-content",
  "stella",
  "atmos",
] as const;
