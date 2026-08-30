-- K3-C V1 / pgvector operator qualification correction
-- Preserves SECURITY DEFINER search_path=pg_catalog; pgvector operators are explicitly schema-qualified.
BEGIN;

CREATE OR REPLACE FUNCTION security.kairos_search_semantic(
  p_model_key text,
  p_query_embedding text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  node_id uuid,
  document_id uuid,
  coordinate text,
  title text,
  snippet text,
  semantic_distance double precision,
  authority_state text,
  authority_weight smallint,
  canonical_pointer text,
  source_anchor text,
  model_key text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_dimensions integer;
  v_metric text;
  v_operator text;
  v_actual_dimensions integer;
  v_limit integer := COALESCE(p_limit,20);
  v_authorized_nodes uuid[];
  v_sql text;
BEGIN
  IF NOT security.kairos_vector_runtime_available() THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_VECTOR_RUNTIME_UNAVAILABLE' USING ERRCODE='55000';
  END IF;
  IF v_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_LIMIT' USING ERRCODE='22023';
  END IF;
  IF p_model_key IS NULL OR p_model_key<>lower(btrim(p_model_key)) THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_MODEL_KEY' USING ERRCODE='22023';
  END IF;

  SELECT m.dimensions,m.distance_metric INTO v_dimensions,v_metric
  FROM kairos.embedding_model_registry m
  WHERE m.model_key=p_model_key AND m.status='ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_EMBEDDING_MODEL_UNAVAILABLE' USING ERRCODE='P0002';
  END IF;

  BEGIN
    EXECUTE 'SELECT public.vector_dims($1::public.vector)' INTO v_actual_dimensions USING p_query_embedding;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_EMBEDDING' USING ERRCODE='22023';
  END;
  IF v_actual_dimensions<>v_dimensions THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_EMBEDDING_DIMENSION_MISMATCH' USING ERRCODE='22023';
  END IF;

  -- Binding security invariant: resolve and materialize the authorized corpus BEFORE vector distance evaluation.
  SELECT COALESCE(array_agg(a.node_id ORDER BY a.node_id),ARRAY[]::uuid[])
  INTO v_authorized_nodes
  FROM security.kairos_authorized_nodes() a;
  IF cardinality(v_authorized_nodes)=0 THEN RETURN; END IF;

  v_operator := CASE v_metric
    WHEN 'COSINE' THEN 'OPERATOR(public.<=>)'
    WHEN 'L2' THEN 'OPERATOR(public.<->)'
    WHEN 'INNER_PRODUCT' THEN 'OPERATOR(public.<#>)'
    ELSE NULL
  END;
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_VECTOR_METRIC_UNSUPPORTED' USING ERRCODE='22023';
  END IF;

  -- Exact distance is intentionally evaluated only over the pre-authorized node set.
  -- Global ANN retrieval followed by redaction remains forbidden.
  v_sql := format($fmt$
    SELECT
      n.id,
      n.document_id,
      c.coordinate,
      COALESCE(n.title,d.title),
      left(n.body_text,400),
      (ev.embedding::public.vector(%1$s) %2$s $1::public.vector(%1$s))::double precision,
      d.authority_state,
      d.authority_weight,
      s.canonical_pointer,
      n.source_anchor,
      e.model_key
    FROM pg_catalog.unnest($4::uuid[]) AS authorized(node_id)
    JOIN kairos.knowledge_embeddings e ON e.node_id=authorized.node_id AND e.model_key=$2 AND e.state='READY'
    JOIN kairos.knowledge_embedding_vectors ev
      ON ev.embedding_id=e.id AND ev.model_key=e.model_key AND ev.dimensions=e.dimensions
    JOIN kairos.knowledge_nodes n ON n.id=e.node_id
    JOIN kairos.knowledge_documents d ON d.id=n.document_id AND d.status='ACTIVE'
    JOIN kairos.knowledge_source_revisions r ON r.id=d.source_revision_id
    JOIN kairos.knowledge_sources s ON s.id=r.source_id
    LEFT JOIN LATERAL (
      SELECT kc.coordinate FROM kairos.knowledge_coordinates kc
      WHERE kc.node_id=n.id AND kc.status='ACTIVE'
      ORDER BY kc.coordinate LIMIT 1
    ) c ON true
    ORDER BY d.authority_weight DESC,6 ASC,n.id
    LIMIT $3
  $fmt$,v_dimensions,v_operator);

  RETURN QUERY EXECUTE v_sql USING p_query_embedding,p_model_key,v_limit,v_authorized_nodes;
END;
$$;
ALTER FUNCTION security.kairos_search_semantic(text,text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_search_semantic(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.kairos_search_semantic(text,text,integer) TO airen_app;

COMMIT;
