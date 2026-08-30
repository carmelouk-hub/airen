import { AppError, type PlatformSecurityContext, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { assertKnowledgeCoordinate, normalizeKnowledgeSearchRequest, type KnowledgeAuthorityState, type KnowledgeSearchHit, type KnowledgeVisibilityClass } from "./index.ts";

export type KairosGraphSecurityContext = PlatformSecurityContext | SecurityContext;
export type KairosGraphEdgeType =
  | "MIRRORS"
  | "IMPLEMENTS"
  | "TESTS"
  | "EVIDENCES"
  | "CERTIFIES"
  | "MACHINE_SPEC_FOR"
  | "CLOSURE_RECORD_FOR"
  | "SUPERSEDES"
  | "DERIVED_FROM"
  | "HAS_SOURCE_ARTIFACT"
  | "COORDINATE_PARENT";

export type KairosGraphNode = Readonly<{
  nodeId: UUID;
  documentId: UUID;
  coordinate?: string;
  nodeType: string;
  title: string;
  bodyExcerpt: string;
  authorityState: KnowledgeAuthorityState;
  authorityWeight: number;
  visibilityClass: KnowledgeVisibilityClass;
  tenantId?: UUID;
  sourceType: string;
  canonicalPointer: string;
  sourceAnchor: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type KairosGraphEdge = Readonly<{
  edgeKey: string;
  fromNodeId: UUID;
  toNodeId: UUID;
  relationType: KairosGraphEdgeType;
  confidence: number;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type KairosGraphSubgraph = Readonly<{
  rootCoordinate?: string;
  nodes: readonly KairosGraphNode[];
  edges: readonly KairosGraphEdge[];
}>;

export type KairosGraphNodeDetail = Readonly<KairosGraphNode & { bodyText: string }>;

export type KairosTimelineEvent = Readonly<{
  eventId: UUID;
  eventType: string;
  correlationId: string;
  occurredAt: string;
  metadata: Readonly<Record<string, unknown>>;
}>;

export type KairosGraphRequest = Readonly<{
  rootCoordinate?: string;
  nodeLimit?: number;
  edgeLimit?: number;
}>;

export type NormalizedKairosGraphRequest = Readonly<{
  rootCoordinate?: string;
  nodeLimit: number;
  edgeLimit: number;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function integerLimit(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new AppError("VALIDATION_FAILED", `${label} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

export function normalizeKairosGraphRequest(input: KairosGraphRequest): NormalizedKairosGraphRequest {
  const rootRaw = input.rootCoordinate?.trim();
  const rootCoordinate = rootRaw ? assertKnowledgeCoordinate(rootRaw) : undefined;
  return Object.freeze({
    ...(rootCoordinate ? { rootCoordinate } : {}),
    nodeLimit: integerLimit(input.nodeLimit, 200, 1, 500, "Kairos graph nodeLimit"),
    edgeLimit: integerLimit(input.edgeLimit, 500, 1, 1000, "Kairos graph edgeLimit"),
  });
}

export function normalizeKairosTimelineLimit(value?: number): number {
  return integerLimit(value, 50, 1, 200, "Kairos timeline limit");
}

export function assertKairosNodeId(value: string): UUID {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) throw new AppError("VALIDATION_FAILED", "Invalid Kairos node id");
  return normalized as UUID;
}

export interface KairosGraphQueryStore {
  readSubgraph(input: KairosGraphRequest, context: KairosGraphSecurityContext): Promise<KairosGraphSubgraph>;
  readNodeDetail(nodeId: UUID, context: KairosGraphSecurityContext): Promise<KairosGraphNodeDetail | null>;
  readTimeline(nodeId: UUID, limit: number | undefined, context: KairosGraphSecurityContext): Promise<readonly KairosTimelineEvent[]>;
  searchLexical(query: string, limit: number | undefined, context: KairosGraphSecurityContext): Promise<readonly KnowledgeSearchHit[]>;
}

export function normalizeKairosGraphSearch(query: string, limit?: number): Readonly<{ query: string; limit: number }> {
  return normalizeKnowledgeSearchRequest({ query, limit });
}
