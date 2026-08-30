import { Pool, type PoolClient } from "pg";
import { AppError, type PlatformSecurityContext, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import type { KnowledgeAuthorityState, KnowledgeSearchHit, KnowledgeVisibilityClass } from "../../kairos/src/index.ts";
import {
  assertKairosNodeId,
  normalizeKairosGraphRequest,
  normalizeKairosGraphSearch,
  normalizeKairosTimelineLimit,
  type KairosGraphEdge,
  type KairosGraphEdgeType,
  type KairosGraphNode,
  type KairosGraphNodeDetail,
  type KairosGraphQueryStore,
  type KairosGraphRequest,
  type KairosGraphSecurityContext,
  type KairosGraphSubgraph,
  type KairosTimelineEvent,
} from "../../kairos/src/graph.ts";

function isTenantContext(context: KairosGraphSecurityContext): context is SecurityContext {
  return !((context as PlatformSecurityContext).scopeKind === "platform");
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.freeze({ ...(value as Record<string, unknown>) })
    : Object.freeze({});
}

function graphNode(row: Record<string, unknown>): KairosGraphNode {
  return Object.freeze({
    nodeId: String(row.node_id) as UUID,
    documentId: String(row.document_id) as UUID,
    ...(row.coordinate ? { coordinate: String(row.coordinate) } : {}),
    nodeType: String(row.node_type),
    title: String(row.title ?? ""),
    bodyExcerpt: String(row.body_excerpt ?? ""),
    authorityState: String(row.authority_state) as KnowledgeAuthorityState,
    authorityWeight: Number(row.authority_weight),
    visibilityClass: String(row.visibility_class) as KnowledgeVisibilityClass,
    ...(row.tenant_id ? { tenantId: String(row.tenant_id) as UUID } : {}),
    sourceType: String(row.source_type),
    canonicalPointer: String(row.canonical_pointer),
    sourceAnchor: String(row.source_anchor),
    metadata: jsonObject(row.metadata),
  });
}

function graphEdge(row: Record<string, unknown>): KairosGraphEdge {
  return Object.freeze({
    edgeKey: String(row.edge_key),
    fromNodeId: String(row.from_node_id) as UUID,
    toNodeId: String(row.to_node_id) as UUID,
    relationType: String(row.relation_type) as KairosGraphEdgeType,
    confidence: Number(row.confidence),
    metadata: jsonObject(row.metadata),
  });
}

export class PostgresKairosGraphStore implements KairosGraphQueryStore {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  private async inSecurityScope<T>(context: KairosGraphSecurityContext, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!context.actorIdentityId || !context.correlationId?.trim()) {
      throw new AppError("VALIDATION_FAILED", "Kairos graph security context is incomplete");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      await client.query("SET LOCAL ROLE airen_app");
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",
        [
          context.actorIdentityId,
          isTenantContext(context) ? context.tenantId : "",
          isTenantContext(context) ? context.locationId : "",
          context.correlationId,
        ],
      );
      const result = await operation(client);
      await client.query("ROLLBACK");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async readSubgraph(input: KairosGraphRequest, context: KairosGraphSecurityContext): Promise<KairosGraphSubgraph> {
    const normalized = normalizeKairosGraphRequest(input);
    return this.inSecurityScope(context, async (client) => {
      const nodes = await client.query(
        "SELECT * FROM security.kairos_graph_nodes($1,$2)",
        [normalized.rootCoordinate ?? null, normalized.nodeLimit],
      );
      const edges = await client.query(
        "SELECT * FROM security.kairos_graph_edges($1,$2,$3)",
        [normalized.rootCoordinate ?? null, normalized.nodeLimit, normalized.edgeLimit],
      );
      return Object.freeze({
        ...(normalized.rootCoordinate ? { rootCoordinate: normalized.rootCoordinate } : {}),
        nodes: Object.freeze(nodes.rows.map((row) => graphNode(row))),
        edges: Object.freeze(edges.rows.map((row) => graphEdge(row))),
      });
    });
  }

  async readNodeDetail(rawNodeId: UUID, context: KairosGraphSecurityContext): Promise<KairosGraphNodeDetail | null> {
    const nodeId = assertKairosNodeId(rawNodeId);
    return this.inSecurityScope(context, async (client) => {
      const result = await client.query("SELECT * FROM security.kairos_graph_node_detail($1)", [nodeId]);
      if (!result.rowCount) return null;
      if (result.rowCount !== 1) throw new AppError("INTERNAL_ERROR", "Kairos node detail is ambiguous");
      const row = result.rows[0] as Record<string, unknown>;
      const base = graphNode({ ...row, body_excerpt: String(row.body_text ?? "").slice(0,500) });
      return Object.freeze({ ...base, bodyText: String(row.body_text ?? "") });
    });
  }

  async readTimeline(rawNodeId: UUID, rawLimit: number | undefined, context: KairosGraphSecurityContext): Promise<readonly KairosTimelineEvent[]> {
    const nodeId = assertKairosNodeId(rawNodeId);
    const limit = normalizeKairosTimelineLimit(rawLimit);
    return this.inSecurityScope(context, async (client) => {
      const result = await client.query("SELECT * FROM security.kairos_graph_timeline($1,$2)", [nodeId, limit]);
      return Object.freeze(result.rows.map((row) => Object.freeze({
        eventId: String(row.event_id) as UUID,
        eventType: String(row.event_type),
        correlationId: String(row.correlation_id),
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
        metadata: jsonObject(row.metadata),
      })));
    });
  }

  async searchLexical(rawQuery: string, rawLimit: number | undefined, context: KairosGraphSecurityContext): Promise<readonly KnowledgeSearchHit[]> {
    const input = normalizeKairosGraphSearch(rawQuery, rawLimit);
    return this.inSecurityScope(context, async (client) => {
      const result = await client.query("SELECT * FROM security.kairos_search_lexical($1,$2)", [input.query,input.limit]);
      return Object.freeze(result.rows.map((row) => Object.freeze({
        nodeId: String(row.node_id) as UUID,
        documentId: String(row.document_id) as UUID,
        ...(row.coordinate ? { coordinate: String(row.coordinate) } : {}),
        ...(row.title ? { title: String(row.title) } : {}),
        snippet: String(row.snippet ?? ""),
        lexicalRank: Number(row.lexical_rank),
        authorityState: String(row.authority_state) as KnowledgeAuthorityState,
        authorityWeight: Number(row.authority_weight),
        canonicalPointer: String(row.canonical_pointer),
        sourceAnchor: String(row.source_anchor),
      })));
    });
  }
}
