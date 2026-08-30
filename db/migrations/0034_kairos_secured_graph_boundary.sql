-- K4-A / AIRen Kairos Secured Graph Boundary
-- Scope: ACL-first graph nodes/edges, node detail and provenance timeline for presentation/API consumers.
-- No raw-table grants are introduced. Base44 and other clients must consume security.kairos_* boundaries only.
BEGIN;

CREATE OR REPLACE FUNCTION security.kairos_graph_nodes(
  p_root_coordinate text DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  node_id uuid,
  document_id uuid,
  coordinate text,
  node_type text,
  title text,
  body_excerpt text,
  authority_state text,
  authority_weight integer,
  visibility_class text,
  tenant_id uuid,
  source_type text,
  canonical_pointer text,
  source_anchor text,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_root text := NULLIF(upper(btrim(p_root_coordinate)), '');
BEGIN
  IF v_root IS NOT NULL AND v_root !~ '^AOS(\.[A-Z0-9][A-Z0-9_-]*){1,12}$' THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_GRAPH_ROOT' USING ERRCODE='22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_GRAPH_NODE_LIMIT' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH authorized AS (
    SELECT a.node_id FROM security.kairos_authorized_nodes() a
  ), resolved AS (
    SELECT
      n.id AS node_id,
      n.document_id,
      coord.coordinate,
      n.node_type,
      COALESCE(n.title,d.title) AS title,
      left(n.body_text,500) AS body_excerpt,
      d.authority_state,
      d.authority_weight::integer AS authority_weight,
      d.visibility_class,
      d.tenant_id,
      s.source_type,
      s.canonical_pointer,
      n.source_anchor,
      n.metadata
    FROM authorized a
    JOIN kairos.knowledge_nodes n ON n.id=a.node_id
    JOIN kairos.knowledge_documents d ON d.id=n.document_id AND d.status='ACTIVE'
    JOIN kairos.knowledge_source_revisions sr ON sr.id=d.source_revision_id
    JOIN kairos.knowledge_sources s ON s.id=sr.source_id AND s.status<>'DISABLED'
    LEFT JOIN LATERAL (
      SELECT c.coordinate
      FROM kairos.knowledge_coordinates c
      WHERE c.node_id=n.id AND c.status='ACTIVE'
      ORDER BY c.coordinate
      LIMIT 1
    ) coord ON true
  )
  SELECT
    r.node_id,r.document_id,r.coordinate,r.node_type,r.title,r.body_excerpt,
    r.authority_state,r.authority_weight,r.visibility_class,r.tenant_id,
    r.source_type,r.canonical_pointer,r.source_anchor,r.metadata
  FROM resolved r
  WHERE v_root IS NULL
     OR r.coordinate=v_root
     OR r.coordinate LIKE v_root || '.%'
  ORDER BY r.authority_weight DESC,r.coordinate NULLS LAST,r.node_id
  LIMIT p_limit;
END;
$$;
ALTER FUNCTION security.kairos_graph_nodes(text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_graph_nodes(text,integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_graph_edges(
  p_root_coordinate text DEFAULT NULL,
  p_node_limit integer DEFAULT 200,
  p_edge_limit integer DEFAULT 500
)
RETURNS TABLE(
  edge_key text,
  from_node_id uuid,
  to_node_id uuid,
  relation_type text,
  confidence numeric,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
BEGIN
  IF p_edge_limit IS NULL OR p_edge_limit < 1 OR p_edge_limit > 1000 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_GRAPH_EDGE_LIMIT' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH selected AS MATERIALIZED (
    SELECT g.node_id,g.coordinate
    FROM security.kairos_graph_nodes(p_root_coordinate,p_node_limit) g
  ), persisted AS (
    SELECT
      'relation:' || r.id::text AS edge_key,
      r.from_node_id,
      r.to_node_id,
      r.relation_type,
      r.confidence,
      r.metadata
    FROM kairos.knowledge_relations r
    JOIN selected f ON f.node_id=r.from_node_id
    JOIN selected t ON t.node_id=r.to_node_id
  ), coordinate_hierarchy AS (
    SELECT
      'coordinate:' || parent.node_id::text || '>' || child.node_id::text AS edge_key,
      parent.node_id AS from_node_id,
      child.node_id AS to_node_id,
      'COORDINATE_PARENT'::text AS relation_type,
      1.0000::numeric AS confidence,
      jsonb_build_object('derived',true,'source','AOS_COORDINATE_HIERARCHY') AS metadata
    FROM selected child
    JOIN selected parent
      ON child.coordinate IS NOT NULL
     AND parent.coordinate=regexp_replace(child.coordinate,'\.[^.]+$','')
     AND parent.node_id<>child.node_id
  )
  SELECT e.edge_key,e.from_node_id,e.to_node_id,e.relation_type,e.confidence,e.metadata
  FROM (
    SELECT * FROM persisted
    UNION ALL
    SELECT * FROM coordinate_hierarchy
  ) e
  ORDER BY e.relation_type,e.edge_key
  LIMIT p_edge_limit;
END;
$$;
ALTER FUNCTION security.kairos_graph_edges(text,integer,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_graph_edges(text,integer,integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_graph_node_detail(p_node_id uuid)
RETURNS TABLE(
  node_id uuid,
  document_id uuid,
  coordinate text,
  node_type text,
  title text,
  body_text text,
  authority_state text,
  authority_weight integer,
  visibility_class text,
  tenant_id uuid,
  source_type text,
  canonical_pointer text,
  source_anchor text,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  SELECT
    n.id,n.document_id,coord.coordinate,n.node_type,COALESCE(n.title,d.title),n.body_text,
    d.authority_state,d.authority_weight::integer,d.visibility_class,d.tenant_id,
    s.source_type,s.canonical_pointer,n.source_anchor,n.metadata
  FROM kairos.knowledge_nodes n
  JOIN kairos.knowledge_documents d ON d.id=n.document_id AND d.status='ACTIVE'
  JOIN kairos.knowledge_source_revisions sr ON sr.id=d.source_revision_id
  JOIN kairos.knowledge_sources s ON s.id=sr.source_id AND s.status<>'DISABLED'
  LEFT JOIN LATERAL (
    SELECT c.coordinate
    FROM kairos.knowledge_coordinates c
    WHERE c.node_id=n.id AND c.status='ACTIVE'
    ORDER BY c.coordinate
    LIMIT 1
  ) coord ON true
  WHERE n.id=p_node_id
    AND security.kairos_can_read_node(n.id);
$$;
ALTER FUNCTION security.kairos_graph_node_detail(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_graph_node_detail(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_graph_timeline(
  p_node_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  event_id uuid,
  event_type text,
  correlation_id text,
  occurred_at timestamptz,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_TIMELINE_LIMIT' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT e.id,e.event_type,e.correlation_id,e.occurred_at,e.metadata
  FROM kairos.knowledge_nodes n
  JOIN kairos.knowledge_documents d ON d.id=n.document_id
  JOIN kairos.knowledge_provenance_events e
    ON e.node_id=n.id OR (e.node_id IS NULL AND e.document_id=d.id)
  WHERE n.id=p_node_id
    AND security.kairos_can_read_node(n.id)
  ORDER BY e.occurred_at DESC,e.id DESC
  LIMIT p_limit;
END;
$$;
ALTER FUNCTION security.kairos_graph_timeline(uuid,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_graph_timeline(uuid,integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION security.kairos_graph_nodes(text,integer) TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_graph_edges(text,integer,integer) TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_graph_node_detail(uuid) TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_graph_timeline(uuid,integer) TO airen_app;

COMMIT;
