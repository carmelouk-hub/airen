import type { UUID } from "../../shared-contracts/src/index.ts";

export type KnowledgeSourceType =
  | "GOOGLE_DRIVE"
  | "GITHUB"
  | "RUNTIME_EVIDENCE"
  | "OCR_DERIVED"
  | "AIRENOS_INTERNAL";

export type KnowledgeVisibilityClass =
  | "PLATFORM_INTERNAL"
  | "TENANT_AUTHORIZED"
  | "PUBLIC_PRODUCT";

export type KnowledgeAuthorityState =
  | "CURRENT_CANONICAL"
  | "GOVERNANCE_BINDING"
  | "CERTIFIED"
  | "CLOSED_PASS"
  | "CURRENT"
  | "DESIGN_FROZEN"
  | "EVIDENCE"
  | "HISTORICAL"
  | "FAILED_CLOSED"
  | "SUPERSEDED"
  | "DRAFT"
  | "UNVERIFIED";

export type KnowledgeRelationType =
  | "MIRRORS"
  | "IMPLEMENTS"
  | "TESTS"
  | "EVIDENCES"
  | "CERTIFIES"
  | "MACHINE_SPEC_FOR"
  | "CLOSURE_RECORD_FOR"
  | "SUPERSEDES"
  | "DERIVED_FROM"
  | "HAS_SOURCE_ARTIFACT";

export type KnowledgeAclSubjectKind =
  | "IDENTITY"
  | "PLATFORM_ROLE"
  | "PLATFORM_PERMISSION"
  | "TENANT_ROLE"
  | "TENANT_ENTITLEMENT";

export type KnowledgeAclEffect = "ALLOW" | "DENY";

export type KnowledgeSource = Readonly<{
  id: UUID;
  sourceKey: string;
  sourceType: KnowledgeSourceType;
  canonicalPointer: string;
  title: string;
  visibilityClass: KnowledgeVisibilityClass;
  tenantId?: UUID;
  status: "CURRENT" | "HISTORICAL" | "DISABLED";
}>;

export type KnowledgeSourceRevision = Readonly<{
  id: UUID;
  sourceId: UUID;
  revisionKey: string;
  contentHash: string;
  observedAt: string;
  parserKind: string;
  nativeTextAvailable: boolean;
  secretScanStatus: "PASS";
  containsSecretValues: false;
  current: boolean;
}>;

export type KnowledgeDocument = Readonly<{
  id: UUID;
  sourceRevisionId: UUID;
  title: string;
  documentKind: string;
  authorityState: KnowledgeAuthorityState;
  authorityWeight: number;
  visibilityClass: KnowledgeVisibilityClass;
  tenantId?: UUID;
  sourceAnchor: string;
  requiredPlatformPermission?: string;
}>;

export type KnowledgeSection = Readonly<{
  id: UUID;
  documentId: UUID;
  parentSectionId?: UUID;
  ordinal: number;
  heading?: string;
  bodyText: string;
  sourceAnchor: string;
}>;

export type KnowledgeNode = Readonly<{
  id: UUID;
  documentId: UUID;
  sectionId?: UUID;
  nodeType: string;
  title?: string;
  bodyText: string;
  sourceAnchor: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type KnowledgeCoordinate = Readonly<{
  coordinate: string;
  documentId?: UUID;
  nodeId?: UUID;
  status: "ACTIVE" | "SUPERSEDED" | "RESERVED";
}>;

export type KnowledgeRelation = Readonly<{
  id: UUID;
  fromNodeId: UUID;
  toNodeId: UUID;
  relationType: KnowledgeRelationType;
  sourceRevisionId?: UUID;
  confidence: number;
}>;

export type KnowledgeAclRule = Readonly<{
  id: UUID;
  documentId?: UUID;
  nodeId?: UUID;
  subjectKind: KnowledgeAclSubjectKind;
  subjectKey: string;
  effect: KnowledgeAclEffect;
}>;

export type KnowledgeProvenanceEvent = Readonly<{
  id: UUID;
  eventType:
    | "DISCOVERED"
    | "INGESTED"
    | "PARSED_NATIVE"
    | "OCR_FALLBACK"
    | "INDEXED"
    | "SUPERSEDED"
    | "REJECTED_SECRET"
    | "AUTHORITY_CHANGED";
  sourceId?: UUID;
  sourceRevisionId?: UUID;
  documentId?: UUID;
  nodeId?: UUID;
  occurredAt: string;
  correlationId: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type KnowledgeEmbedding = Readonly<{
  id: UUID;
  nodeId: UUID;
  modelKey: string;
  dimensions: number;
  contentHash: string;
  state: "PENDING" | "READY" | "REJECTED";
  vectorStoreKey?: string;
}>;

export type KnowledgeSearchRequest = Readonly<{
  query: string;
  limit?: number;
}>;

export type KnowledgeSearchHit = Readonly<{
  nodeId: UUID;
  documentId: UUID;
  coordinate?: string;
  title?: string;
  snippet: string;
  lexicalRank: number;
  authorityState: KnowledgeAuthorityState;
  authorityWeight: number;
  canonicalPointer: string;
  sourceAnchor: string;
}>;

export const AUTHORITY_WEIGHT: Readonly<Record<KnowledgeAuthorityState, number>> = Object.freeze({
  GOVERNANCE_BINDING: 120,
  CURRENT_CANONICAL: 115,
  CERTIFIED: 110,
  CLOSED_PASS: 105,
  CURRENT: 100,
  DESIGN_FROZEN: 95,
  EVIDENCE: 80,
  HISTORICAL: 60,
  FAILED_CLOSED: 55,
  SUPERSEDED: 40,
  DRAFT: 20,
  UNVERIFIED: 10,
});

const COORDINATE_PATTERN = /^AOS(?:\.[A-Z0-9][A-Z0-9_-]*){1,12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function assertKnowledgeCoordinate(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!COORDINATE_PATTERN.test(normalized)) throw new Error("Invalid Kairos knowledge coordinate");
  return normalized;
}

export function assertSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HASH_PATTERN.test(normalized)) throw new Error("Invalid SHA-256 digest");
  return normalized;
}

export function normalizeKnowledgeSearchRequest(input: KnowledgeSearchRequest): Readonly<{ query: string; limit: number }> {
  const query = input.query.trim();
  if (query.length < 2 || query.length > 512) throw new Error("Kairos search query length must be between 2 and 512 characters");
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Kairos search result limit must be an integer between 1 and 50");
  return Object.freeze({ query, limit });
}

export function assertSecretExclusionAttested(input: Pick<KnowledgeSourceRevision, "secretScanStatus" | "containsSecretValues">): void {
  if (input.secretScanStatus !== "PASS" || input.containsSecretValues !== false) {
    throw new Error("Kairos source revision is not eligible for ingestion because secret exclusion is not attested");
  }
}

export function authorityWeight(state: KnowledgeAuthorityState): number {
  return AUTHORITY_WEIGHT[state];
}
