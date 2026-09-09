import { AppError } from "../../../shared-contracts/src/index.ts";

export const STELLA_DONOR_FORBIDDEN_FIELDS = [
  "id",
  "tenant_id",
  "location_id",
  "created_by_id",
  "user_id",
  "email",
  "phone",
  "business_name",
  "venue_name",
  "assistant_persona_id",
  "stella_domain_id",
  "stella_config_id",
  "knowledge_item_id",
  "capability_id",
  "snapshot_id",
  "audit_log_id",
  "target_tenant_id",
  "provider_model",
  "provider_key",
  "prompt_secret",
] as const;

export type PortableStellaPatternV1 = Readonly<{
  tenantScopedContext: true;
  evidenceLayerRequired: true;
  proposalLifecycleRequired: true;
  targetServiceReauthorizationRequired: true;
  failClosedFoundationRequired: true;
  directCoreWriteAllowed: false;
  donorRecordsMigrated: false;
}>;

export function recoverPortableStellaPattern(input: Readonly<Record<string, unknown>>): PortableStellaPatternV1 {
  for (const field of STELLA_DONOR_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) throw new AppError("VALIDATION_FAILED", `REC007_FORBIDDEN_DONOR_DATA:${field}`);
  }
  return Object.freeze({
    tenantScopedContext: true,
    evidenceLayerRequired: true,
    proposalLifecycleRequired: true,
    targetServiceReauthorizationRequired: true,
    failClosedFoundationRequired: true,
    directCoreWriteAllowed: false,
    donorRecordsMigrated: false,
  });
}

export const REC007_STELLA_RECOVERY_EVIDENCE = Object.freeze({
  donor: "ex-corte",
  donorMode: "RECOVERY_DONOR_ONLY",
  recoveredPatterns: Object.freeze([
    "tenant-scoped-ai-context",
    "agent-tool-boundary-hardening",
    "fail-closed-stella-foundation",
    "cognitive-evidence-and-intelligence-ui",
    "human-governed-draft-and-approval-pattern",
  ]),
  canonicalRefactors: Object.freeze([
    "decision-proposal-evidence-layer",
    "forecast-and-anomaly-projections",
    "no-ai-core-write-authority",
    "human-domain-permission-approval",
    "target-service-reauthorization",
    "stale-target-version-invalidates-proposal",
    "airenos-security-and-entitlement-context",
  ]),
  acceptanceTests: Object.freeze(["GJ2-026", "GJ2-027", "GJ2-039"]),
  runtimeState: "RUNTIME_PENDING",
});
