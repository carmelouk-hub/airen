export type AtmosPhase = "DAWN" | "DAY" | "GOLDEN" | "NIGHT";
export type ExperienceContextInput = { tenantId: string; locationId: string; timezone: string; timestampIso: string; season?: string; eventContext?: string; channel?: string; };
export type ExperienceContext = { phase: AtmosPhase; seasonOverlay?: string; eventOverlay?: string; channel?: string; expiresAtIso?: string; };
export interface ExperienceContextResolver { resolve(input: ExperienceContextInput): ExperienceContext; }
// Deterministic context only; no business-state mutation.
