import type { UUID } from "../../shared-contracts/src/index.ts";
import {
  AUTHORITY_WEIGHT,
  normalizeKnowledgeSearchRequest,
  type KnowledgeAclEffect,
  type KnowledgeAclSubjectKind,
  type KnowledgeAuthorityState,
  type KnowledgeVisibilityClass,
} from "./index.ts";
import { KairosIngestionPipeline, type IngestionCheckpoint, type KairosIngestionEnvelope } from "./ingestion.ts";
import {
  kairosVectorLiteral,
  normalizeKairosEmbeddingModelSpec,
  normalizeKairosSemanticSearchRequest,
  type KairosEmbeddingModelSpec,
} from "./vector.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISIBILITY = new Set<KnowledgeVisibilityClass>(["PLATFORM_INTERNAL", "TENANT_AUTHORIZED", "PUBLIC_PRODUCT"]);
const ACL_SUBJECTS = new Set<KnowledgeAclSubjectKind>(["IDENTITY", "PLATFORM_ROLE", "PLATFORM_PERMISSION", "TENANT_ROLE", "TENANT_ENTITLEMENT"]);
const ACL_EFFECTS = new Set<KnowledgeAclEffect>(["ALLOW", "DENY"]);

export type KairosDocumentAclInput = Readonly<{
  subjectKind: KnowledgeAclSubjectKind;
  subjectKey: string;
  effect: KnowledgeAclEffect;
}>;

export type KairosIngestionPolicy = Readonly<{
  documentKind: string;
  authorityState: KnowledgeAuthorityState;
  visibilityClass: KnowledgeVisibilityClass;
  tenantId?: UUID;
  requiredPlatformPermission?: string;
  documentAcl?: readonly KairosDocumentAclInput[];
}>;

export type NormalizedKairosIngestionPolicy = Readonly<KairosIngestionPolicy & { authorityWeight: number; documentAcl: readonly KairosDocumentAclInput[] }>;

export type KairosPersistenceCheckpoint = Readonly<IngestionCheckpoint & {
  sourceId: UUID;
  sourceRevisionId: UUID;
  documentId?: UUID;
}>;

export type KairosCommitReceipt = Readonly<{
  sourceId: UUID;
  sourceRevisionId: UUID;
  documentId: UUID;
  unitCount: number;
  changed: boolean;
  ingestionStatus: KairosIngestionEnvelope["status"];
}>;

export interface KairosKnowledgePersistence {
  getCheckpoint(sourceKey: string): Promise<KairosPersistenceCheckpoint | undefined>;
  commit(envelope: KairosIngestionEnvelope, policy: KairosIngestionPolicy, correlationId: string): Promise<KairosCommitReceipt>;
}

export interface KairosSqlQueryable {
  query(text: string, values?: readonly unknown[]): Promise<Readonly<{ rowCount: number | null; rows: readonly Record<string, unknown>[] }>>;
}

function bounded(value: string, label: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`${label} length must be between ${min} and ${max}`);
  return normalized;
}

export function normalizeKairosIngestionPolicy(input: KairosIngestionPolicy): NormalizedKairosIngestionPolicy {
  const documentKind = bounded(input.documentKind, "Kairos document kind", 1, 128);
  if (!(input.authorityState in AUTHORITY_WEIGHT)) throw new Error("Invalid Kairos authority state");
  if (!VISIBILITY.has(input.visibilityClass)) throw new Error("Invalid Kairos visibility class");
  const tenantId = input.tenantId?.trim();
  if (tenantId && !UUID_PATTERN.test(tenantId)) throw new Error("Invalid Kairos tenant id");
  if (input.visibilityClass === "TENANT_AUTHORIZED" && !tenantId) throw new Error("Tenant-authorized Kairos knowledge requires explicit tenant id");
  if (input.visibilityClass !== "TENANT_AUTHORIZED" && tenantId) throw new Error("Non-tenant Kairos knowledge must not carry tenant id");
  const requiredPlatformPermission = input.requiredPlatformPermission?.trim();
  if (requiredPlatformPermission && requiredPlatformPermission.length > 256) throw new Error("Kairos required platform permission is too long");

  const documentAcl = Object.freeze((input.documentAcl ?? []).map((rule) => {
    if (!ACL_SUBJECTS.has(rule.subjectKind)) throw new Error("Invalid Kairos ACL subject kind");
    if (!ACL_EFFECTS.has(rule.effect)) throw new Error("Invalid Kairos ACL effect");
    return Object.freeze({
      subjectKind: rule.subjectKind,
      subjectKey: bounded(rule.subjectKey, "Kairos ACL subject key", 1, 256),
      effect: rule.effect,
    });
  }));
  if (input.visibilityClass === "TENANT_AUTHORIZED" && !documentAcl.some((rule) => rule.effect === "ALLOW")) {
    throw new Error("Tenant-authorized Kairos knowledge requires at least one explicit ALLOW ACL");
  }

  return Object.freeze({
    documentKind,
    authorityState: input.authorityState,
    authorityWeight: AUTHORITY_WEIGHT[input.authorityState],
    visibilityClass: input.visibilityClass,
    ...(tenantId ? { tenantId: tenantId as UUID } : {}),
    ...(requiredPlatformPermission ? { requiredPlatformPermission } : {}),
    documentAcl,
  });
}

function reconcileEnvelope(envelope: KairosIngestionEnvelope, previous?: KairosPersistenceCheckpoint): KairosIngestionEnvelope {
  if (!previous) return Object.freeze({ ...envelope, status: "READY_NEW_SOURCE" });
  if (previous.revisionKey === envelope.revision.revisionKey && previous.contentHash !== envelope.revision.contentHash) {
    throw new Error("Kairos source revision key was reused for different content");
  }
  const status: KairosIngestionEnvelope["status"] = previous.revisionKey === envelope.revision.revisionKey
    ? "UNCHANGED"
    : "READY_NEW_REVISION";
  return Object.freeze({ ...envelope, status });
}

function correlationId(value: string): string {
  return bounded(value, "Kairos correlation id", 1, 256);
}

export class PostgresKairosKnowledgePersistence implements KairosKnowledgePersistence {
  private readonly sql: KairosSqlQueryable;
  constructor(sql: KairosSqlQueryable) { this.sql = sql; }

  async getCheckpoint(sourceKey: string): Promise<KairosPersistenceCheckpoint | undefined> {
    const key = bounded(sourceKey, "Kairos source key", 3, 256);
    const result = await this.sql.query(
      "SELECT source_id,source_revision_id,document_id,revision_key,content_hash FROM security.kairos_ingestion_checkpoint($1)",
      [key],
    );
    if (!result.rowCount) return undefined;
    if (result.rowCount !== 1) throw new Error("Kairos ingestion checkpoint is ambiguous");
    const row = result.rows[0];
    return Object.freeze({
      sourceId: String(row.source_id) as UUID,
      sourceRevisionId: String(row.source_revision_id) as UUID,
      ...(row.document_id ? { documentId: String(row.document_id) as UUID } : {}),
      revisionKey: String(row.revision_key),
      contentHash: String(row.content_hash),
    });
  }

  async commit(envelope: KairosIngestionEnvelope, policy: KairosIngestionPolicy, rawCorrelationId: string): Promise<KairosCommitReceipt> {
    if (envelope.status === "UNCHANGED") throw new Error("Unchanged Kairos ingestion envelopes must not execute a persistence mutation");
    const normalizedPolicy = normalizeKairosIngestionPolicy(policy);
    const payload = Object.freeze({
      status: envelope.status,
      source: Object.freeze({
        sourceKey: envelope.source.sourceKey,
        sourceType: envelope.source.sourceType,
        canonicalPointer: envelope.source.canonicalPointer,
        title: envelope.source.title,
        observedAt: envelope.source.observedAt,
      }),
      revision: envelope.revision,
      units: envelope.units,
    });
    const policyPayload = Object.freeze({
      documentKind: normalizedPolicy.documentKind,
      authorityState: normalizedPolicy.authorityState,
      visibilityClass: normalizedPolicy.visibilityClass,
      ...(normalizedPolicy.tenantId ? { tenantId: normalizedPolicy.tenantId } : {}),
      ...(normalizedPolicy.requiredPlatformPermission ? { requiredPlatformPermission: normalizedPolicy.requiredPlatformPermission } : {}),
      documentAcl: normalizedPolicy.documentAcl,
    });
    const result = await this.sql.query(
      "SELECT source_id,source_revision_id,document_id,unit_count,changed,ingestion_status FROM security.kairos_commit_ingestion($1::jsonb,$2::jsonb,$3)",
      [JSON.stringify(payload), JSON.stringify(policyPayload), correlationId(rawCorrelationId)],
    );
    if (result.rowCount !== 1) throw new Error("Kairos ingestion commit did not return exactly one receipt");
    const row = result.rows[0];
    return Object.freeze({
      sourceId: String(row.source_id) as UUID,
      sourceRevisionId: String(row.source_revision_id) as UUID,
      documentId: String(row.document_id) as UUID,
      unitCount: Number(row.unit_count),
      changed: row.changed === true,
      ingestionStatus: String(row.ingestion_status) as KairosIngestionEnvelope["status"],
    });
  }
}

export class KairosGovernedIngestionService<TInput> {
  private readonly pipeline: KairosIngestionPipeline<TInput>;
  private readonly persistence: KairosKnowledgePersistence;
  constructor(pipeline: KairosIngestionPipeline<TInput>, persistence: KairosKnowledgePersistence) {
    this.pipeline = pipeline;
    this.persistence = persistence;
  }

  async ingest(input: TInput, policy: KairosIngestionPolicy, rawCorrelationId: string): Promise<Readonly<{ envelope: KairosIngestionEnvelope; receipt?: KairosCommitReceipt }>> {
    normalizeKairosIngestionPolicy(policy);
    const prepared = await this.pipeline.prepare(input);
    const previous = await this.persistence.getCheckpoint(prepared.source.sourceKey);
    const envelope = reconcileEnvelope(prepared, previous);
    if (envelope.status === "UNCHANGED") return Object.freeze({ envelope });
    const receipt = await this.persistence.commit(envelope, policy, correlationId(rawCorrelationId));
    return Object.freeze({ envelope, receipt });
  }
}

export type KairosHybridSearchRequest = Readonly<{
  query: string;
  model: KairosEmbeddingModelSpec;
  embedding: readonly number[];
  limit?: number;
}>;

export type KairosHybridSearchHit = Readonly<{
  nodeId: UUID;
  documentId: UUID;
  coordinate?: string;
  title?: string;
  snippet: string;
  lexicalRank?: number;
  semanticDistance?: number;
  fusionScore: number;
  authorityState: KnowledgeAuthorityState;
  authorityWeight: number;
  canonicalPointer: string;
  sourceAnchor: string;
  modelKey: string;
  matchedLexical: boolean;
  matchedSemantic: boolean;
}>;

export class PostgresKairosHybridSearch {
  private readonly sql: KairosSqlQueryable;
  constructor(sql: KairosSqlQueryable) { this.sql = sql; }

  async search(input: KairosHybridSearchRequest): Promise<readonly KairosHybridSearchHit[]> {
    if (!input.model) throw new Error("Kairos hybrid search requires an explicit embedding model");
    const model = normalizeKairosEmbeddingModelSpec(input.model);
    const lexical = normalizeKnowledgeSearchRequest({ query: input.query, limit: input.limit });
    const semantic = normalizeKairosSemanticSearchRequest({ modelKey: model.modelKey, embedding: input.embedding, limit: lexical.limit }, model);
    const result = await this.sql.query(
      "SELECT * FROM security.kairos_search_hybrid($1,$2,$3,$4)",
      [lexical.query, semantic.modelKey, kairosVectorLiteral(semantic.embedding), lexical.limit],
    );
    return Object.freeze(result.rows.map((row) => {
      if (String(row.model_key) !== semantic.modelKey) throw new Error("Kairos hybrid search returned a model identity mismatch");
      return Object.freeze({
        nodeId: String(row.node_id) as UUID,
        documentId: String(row.document_id) as UUID,
        ...(row.coordinate ? { coordinate: String(row.coordinate) } : {}),
        ...(row.title ? { title: String(row.title) } : {}),
        snippet: String(row.snippet ?? ""),
        ...(row.lexical_rank === null || row.lexical_rank === undefined ? {} : { lexicalRank: Number(row.lexical_rank) }),
        ...(row.semantic_distance === null || row.semantic_distance === undefined ? {} : { semanticDistance: Number(row.semantic_distance) }),
        fusionScore: Number(row.fusion_score),
        authorityState: String(row.authority_state) as KnowledgeAuthorityState,
        authorityWeight: Number(row.authority_weight),
        canonicalPointer: String(row.canonical_pointer),
        sourceAnchor: String(row.source_anchor),
        modelKey: String(row.model_key),
        matchedLexical: row.matched_lexical === true,
        matchedSemantic: row.matched_semantic === true,
      });
    }));
  }
}
