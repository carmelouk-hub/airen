-- K3-C / AIRen Kairos Optional pgvector Runtime + ACL-First Semantic Search Foundation
-- pgvector is an optional derived-search capability. Canonical knowledge remains in Kairos tables.
-- A runtime without pgvector must still migrate successfully and semantic search must fail closed.
BEGIN;

CREATE TABLE kairos.embedding_model_registry (
  model_key text PRIMARY KEY CHECK (model_key ~ '^[a-z0-9][a-z0-9._:-]{2,127}$'),
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z0-9][a-z0-9._:-]{1,127}$'),
  dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  distance_metric text NOT NULL CHECK (distance_metric IN ('COSINE','L2','INNER_PRODUCT')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kairos.knowledge_embeddings
  ADD CONSTRAINT kairos_knowledge_embeddings_model_fk
  FOREIGN KEY (model_key) REFERENCES kairos.embedding_model_registry(model_key);
ALTER TABLE kairos.knowledge_embeddings
  ADD CONSTRAINT kairos_knowledge_embeddings_vector_identity_uq
  UNIQUE (id,model_key,dimensions);

ALTER TABLE kairos.embedding_model_registry OWNER TO airen_control_plane_owner;
REVOKE ALL PRIVILEGES ON kairos.embedding_model_registry FROM PUBLIC,airen_app,airen_control_plane;
ALTER TABLE kairos.embedding_model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.embedding_model_registry FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON kairos.embedding_model_registry TO airen_control_plane_owner;

-- Install pgvector only when the database advertises it and the migration principal can install it.
-- Lack of the extension is a supported fail-closed runtime state, not a migration failure.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name='vector') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'K3-C pgvector is available but migration principal cannot install it; semantic runtime remains disabled';
    END;
  END IF;

  IF pg_catalog.to_regtype('public.vector') IS NOT NULL THEN
    EXECUTE $ddl$
      CREATE TABLE kairos.knowledge_embedding_vectors (
        embedding_id uuid PRIMARY KEY,
        model_key text NOT NULL,
        dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
        embedding public.vector NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT kairos_knowledge_embedding_vectors_metadata_fk
          FOREIGN KEY (embedding_id,model_key,dimensions)
          REFERENCES kairos.knowledge_embeddings(id,model_key,dimensions)
          ON DELETE CASCADE,
        CONSTRAINT kairos_knowledge_embedding_vectors_dimension_ck
          CHECK (public.vector_dims(embedding)=dimensions)
      )
    $ddl$;
    EXECUTE 'ALTER TABLE kairos.knowledge_embedding_vectors OWNER TO airen_control_plane_owner';
    EXECUTE 'REVOKE ALL PRIVILEGES ON kairos.knowledge_embedding_vectors FROM PUBLIC,airen_app,airen_control_plane';
    EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON kairos.knowledge_embedding_vectors TO airen_control_plane_owner';
    EXECUTE 'ALTER TABLE kairos.knowledge_embedding_vectors ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE kairos.knowledge_embedding_vectors FORCE ROW LEVEL SECURITY';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION security.kairos_vector_runtime_available()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  SELECT pg_catalog.to_regtype('public.vector') IS NOT NULL
     AND pg_catalog.to_regclass('kairos.knowledge_embedding_vectors') IS NOT NULL;
$$;
ALTER FUNCTION security.kairos_vector_runtime_available() OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_vector_runtime_available() FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_store_embedding(
  p_node_id uuid,
  p_model_key text,
  p_content_hash text,
  p_embedding text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_dimensions integer;
  v_actual_dimensions integer;
  v_embedding_id uuid;
BEGIN
  IF NOT security.kairos_vector_runtime_available() THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_VECTOR_RUNTIME_UNAVAILABLE' USING ERRCODE='55000';
  END IF;
  IF p_node_id IS NULL OR NOT EXISTS (SELECT 1 FROM kairos.knowledge_nodes n WHERE n.id=p_node_id) THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_NODE_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
  IF p_model_key IS NULL OR p_model_key<>lower(btrim(p_model_key)) THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_MODEL_KEY' USING ERRCODE='22023';
  END IF;
  IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_CONTENT_HASH' USING ERRCODE='22023';
  END IF;
  IF p_embedding IS NULL OR btrim(p_embedding)='' THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_EMBEDDING' USING ERRCODE='22023';
  END IF;

  SELECT m.dimensions INTO v_dimensions
  FROM kairos.embedding_model_registry m
  WHERE m.model_key=p_model_key AND m.status='ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_EMBEDDING_MODEL_UNAVAILABLE' USING ERRCODE='P0002';
  END IF;

  BEGIN
    EXECUTE 'SELECT public.vector_dims($1::public.vector)' INTO v_actual_dimensions USING p_embedding;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_EMBEDDING' USING ERRCODE='22023';
  END;
  IF v_actual_dimensions<>v_dimensions THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_EMBEDDING_DIMENSION_MISMATCH' USING ERRCODE='22023';
  END IF;

  INSERT INTO kairos.knowledge_embeddings(node_id,model_key,dimensions,content_hash,state,vector_store_key,updated_at)
  VALUES(p_node_id,p_model_key,v_dimensions,p_content_hash,'READY','pgvector:'||p_model_key,now())
  ON CONFLICT(node_id,model_key,content_hash)
  DO UPDATE SET dimensions=EXCLUDED.dimensions,state='READY',vector_store_key=EXCLUDED.vector_store_key,updated_at=now()
  RETURNING id INTO v_embedding_id;

  EXECUTE $sql$
    INSERT INTO kairos.knowledge_embedding_vectors(embedding_id,model_key,dimensions,embedding,updated_at)
    VALUES($1,$2,$3,$4::public.vector,now())
    ON CONFLICT(embedding_id)
    DO UPDATE SET model_key=EXCLUDED.model_key,dimensions=EXCLUDED.dimensions,embedding=EXCLUDED.embedding,updated_at=now()
  $sql$ USING v_embedding_id,p_model_key,v_dimensions,p_embedding;

  RETURN v_embedding_id;
END;
$$;
ALTER FUNCTION security.kairos_store_embedding(uuid,text,text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_store_embedding(uuid,text,text,text) FROM PUBLIC,airen_app,airen_control_plane;
GRANT EXECUTE ON FUNCTION security.kairos_store_embedding(uuid,text,text,text) TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.kairos_build_model_vector_index(p_model_key text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_dimensions integer;
  v_metric text;
  v_opclass text;
  v_index_name text;
BEGIN
  IF NOT security.kairos_vector_runtime_available() THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_VECTOR_RUNTIME_UNAVAILABLE' USING ERRCODE='55000';
  END IF;
  SELECT m.dimensions,m.distance_metric INTO v_dimensions,v_metric
  FROM kairos.embedding_model_registry m
  WHERE m.model_key=p_model_key AND m.status='ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_EMBEDDING_MODEL_UNAVAILABLE' USING ERRCODE='P0002';
  END IF;
  IF v_dimensions>2000 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_HNSW_DIMENSION_UNSUPPORTED' USING ERRCODE='22023';
  END IF;

  v_opclass := CASE v_metric
    WHEN 'COSINE' THEN 'public.vector_cosine_ops'
    WHEN 'L2' THEN 'public.vector_l2_ops'
    WHEN 'INNER_PRODUCT' THEN 'public.vector_ip_ops'
    ELSE NULL
  END;
  IF v_opclass IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_VECTOR_METRIC_UNSUPPORTED' USING ERRCODE='22023';
  END IF;
  v_index_name := 'kairos_kemb_'||substr(pg_catalog.md5(p_model_key),1,16)||'_hnsw';

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON kairos.knowledge_embedding_vectors USING hnsw ((embedding::public.vector(%s)) %s) WHERE model_key=%L',
    v_index_name,v_dimensions,v_opclass,p_model_key
  );
  RETURN v_index_name;
END;
$$;
ALTER FUNCTION security.kairos_build_model_vector_index(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_build_model_vector_index(text) FROM PUBLIC,airen_app,airen_control_plane;
GRANT EXECUTE ON FUNCTION security.kairos_build_model_vector_index(text) TO airen_control_plane_owner;

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

  v_operator := CASE v_metric WHEN 'COSINE' THEN '<=>' WHEN 'L2' THEN '<->' WHEN 'INNER_PRODUCT' THEN '<#>' ELSE NULL END;
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_VECTOR_METRIC_UNSUPPORTED' USING ERRCODE='22023';
  END IF;

  -- Exact distance is intentionally evaluated only over the pre-authorized node set.
  -- Model-specific HNSW indexes are prepared for benchmarked future partitioned/authorized ANN strategies,
  -- but are not permitted to query the global corpus first and redact afterward.
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

GRANT EXECUTE ON FUNCTION security.kairos_vector_runtime_available() TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_search_semantic(text,text,integer) TO airen_app;

COMMIT;
