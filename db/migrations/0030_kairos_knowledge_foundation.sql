-- K3-A1 / AIRen Kairos Knowledge Persistence, ACL & Lexical Search Foundation
-- Scope: provider-independent knowledge records, provenance, pre-retrieval authorization and PostgreSQL full-text foundation.
-- Vector/pgvector storage is intentionally deferred to a later K3 slice after ACL runtime certification.
BEGIN;

CREATE SCHEMA IF NOT EXISTS kairos;
REVOKE ALL ON SCHEMA kairos FROM PUBLIC;

INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES
  ('kairos.knowledge.read.internal','Read AIRenOS internal Kairos knowledge','critical'),
  ('kairos.knowledge.read.public','Read authorized public/product Kairos knowledge','high'),
  ('kairos.knowledge.ingest','Ingest governed Kairos source revisions','critical')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE kairos.knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE CHECK (char_length(btrim(source_key)) BETWEEN 3 AND 256),
  source_type text NOT NULL CHECK (source_type IN ('GOOGLE_DRIVE','GITHUB','RUNTIME_EVIDENCE','OCR_DERIVED','AIRENOS_INTERNAL')),
  canonical_pointer text NOT NULL CHECK (char_length(btrim(canonical_pointer)) BETWEEN 1 AND 2048),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 1024),
  visibility_class text NOT NULL CHECK (visibility_class IN ('PLATFORM_INTERNAL','TENANT_AUTHORIZED','PUBLIC_PRODUCT')),
  tenant_id uuid NULL REFERENCES platform.tenants(id),
  status text NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT','HISTORICAL','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kairos_knowledge_sources_visibility_scope_ck CHECK (
    (visibility_class='TENANT_AUTHORIZED' AND tenant_id IS NOT NULL)
    OR (visibility_class IN ('PLATFORM_INTERNAL','PUBLIC_PRODUCT') AND tenant_id IS NULL)
  ),
  UNIQUE (source_type,canonical_pointer)
);
CREATE INDEX kairos_knowledge_sources_tenant_status_idx ON kairos.knowledge_sources(tenant_id,status,source_type);

CREATE TABLE kairos.knowledge_source_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES kairos.knowledge_sources(id) ON DELETE RESTRICT,
  revision_key text NOT NULL CHECK (char_length(btrim(revision_key)) BETWEEN 1 AND 512),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  parser_kind text NOT NULL CHECK (char_length(btrim(parser_kind)) BETWEEN 1 AND 128),
  native_text_available boolean NOT NULL,
  secret_scan_status text NOT NULL CHECK (secret_scan_status='PASS'),
  contains_secret_values boolean NOT NULL DEFAULT false CHECK (contains_secret_values=false),
  observed_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id,revision_key)
);
CREATE UNIQUE INDEX kairos_knowledge_source_revisions_current_uq
  ON kairos.knowledge_source_revisions(source_id)
  WHERE is_current;
CREATE INDEX kairos_knowledge_source_revisions_hash_idx ON kairos.knowledge_source_revisions(content_hash);

CREATE TABLE kairos.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_revision_id uuid NOT NULL REFERENCES kairos.knowledge_source_revisions(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 1024),
  document_kind text NOT NULL CHECK (char_length(btrim(document_kind)) BETWEEN 1 AND 128),
  authority_state text NOT NULL CHECK (authority_state IN (
    'CURRENT_CANONICAL','GOVERNANCE_BINDING','CERTIFIED','CLOSED_PASS','CURRENT','DESIGN_FROZEN',
    'EVIDENCE','HISTORICAL','FAILED_CLOSED','SUPERSEDED','DRAFT','UNVERIFIED'
  )),
  authority_weight smallint NOT NULL CHECK (authority_weight BETWEEN 0 AND 1000),
  visibility_class text NOT NULL CHECK (visibility_class IN ('PLATFORM_INTERNAL','TENANT_AUTHORIZED','PUBLIC_PRODUCT')),
  tenant_id uuid NULL REFERENCES platform.tenants(id),
  source_anchor text NOT NULL CHECK (char_length(btrim(source_anchor)) BETWEEN 1 AND 2048),
  required_platform_permission text NULL REFERENCES authz.permission_registry(permission_key),
  content_summary text NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kairos_knowledge_documents_visibility_scope_ck CHECK (
    (visibility_class='TENANT_AUTHORIZED' AND tenant_id IS NOT NULL)
    OR (visibility_class IN ('PLATFORM_INTERNAL','PUBLIC_PRODUCT') AND tenant_id IS NULL)
  ),
  UNIQUE (source_revision_id,source_anchor)
);
CREATE INDEX kairos_knowledge_documents_authority_idx ON kairos.knowledge_documents(authority_weight DESC,authority_state,status);
CREATE INDEX kairos_knowledge_documents_tenant_idx ON kairos.knowledge_documents(tenant_id,visibility_class,status);

CREATE TABLE kairos.knowledge_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES kairos.knowledge_documents(id) ON DELETE CASCADE,
  parent_section_id uuid NULL REFERENCES kairos.knowledge_sections(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  heading text NULL,
  body_text text NOT NULL DEFAULT '',
  source_anchor text NOT NULL CHECK (char_length(btrim(source_anchor)) BETWEEN 1 AND 2048),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',coalesce(heading,'') || ' ' || coalesce(body_text,''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id,source_anchor)
);
CREATE INDEX kairos_knowledge_sections_document_ordinal_idx ON kairos.knowledge_sections(document_id,ordinal,id);
CREATE INDEX kairos_knowledge_sections_search_idx ON kairos.knowledge_sections USING GIN(search_vector);

CREATE TABLE kairos.knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES kairos.knowledge_documents(id) ON DELETE CASCADE,
  section_id uuid NULL REFERENCES kairos.knowledge_sections(id) ON DELETE SET NULL,
  node_type text NOT NULL CHECK (char_length(btrim(node_type)) BETWEEN 1 AND 128),
  title text NULL,
  body_text text NOT NULL DEFAULT '',
  source_anchor text NOT NULL CHECK (char_length(btrim(source_anchor)) BETWEEN 1 AND 2048),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',coalesce(title,'') || ' ' || coalesce(body_text,''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id,source_anchor,node_type)
);
CREATE INDEX kairos_knowledge_nodes_document_idx ON kairos.knowledge_nodes(document_id,section_id,node_type);
CREATE INDEX kairos_knowledge_nodes_search_idx ON kairos.knowledge_nodes USING GIN(search_vector);

CREATE TABLE kairos.knowledge_coordinates (
  coordinate text PRIMARY KEY CHECK (coordinate ~ '^AOS(\.[A-Z0-9][A-Z0-9_-]*){1,12}$'),
  document_id uuid NULL REFERENCES kairos.knowledge_documents(id) ON DELETE CASCADE,
  node_id uuid NULL REFERENCES kairos.knowledge_nodes(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','RESERVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kairos_knowledge_coordinates_target_ck CHECK (
    (status='RESERVED' AND document_id IS NULL AND node_id IS NULL)
    OR (status<>'RESERVED' AND ((document_id IS NOT NULL)::int + (node_id IS NOT NULL)::int)=1)
  )
);
CREATE INDEX kairos_knowledge_coordinates_document_idx ON kairos.knowledge_coordinates(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX kairos_knowledge_coordinates_node_idx ON kairos.knowledge_coordinates(node_id) WHERE node_id IS NOT NULL;

CREATE TABLE kairos.knowledge_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id uuid NOT NULL REFERENCES kairos.knowledge_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES kairos.knowledge_nodes(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (relation_type IN (
    'MIRRORS','IMPLEMENTS','TESTS','EVIDENCES','CERTIFIES','MACHINE_SPEC_FOR','CLOSURE_RECORD_FOR',
    'SUPERSEDES','DERIVED_FROM','HAS_SOURCE_ARTIFACT'
  )),
  source_revision_id uuid NULL REFERENCES kairos.knowledge_source_revisions(id) ON DELETE SET NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000 CHECK (confidence >= 0 AND confidence <= 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  UNIQUE (from_node_id,to_node_id,relation_type,source_revision_id)
);
CREATE INDEX kairos_knowledge_relations_from_idx ON kairos.knowledge_relations(from_node_id,relation_type);
CREATE INDEX kairos_knowledge_relations_to_idx ON kairos.knowledge_relations(to_node_id,relation_type);

CREATE TABLE kairos.knowledge_acl (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NULL REFERENCES kairos.knowledge_documents(id) ON DELETE CASCADE,
  node_id uuid NULL REFERENCES kairos.knowledge_nodes(id) ON DELETE CASCADE,
  subject_kind text NOT NULL CHECK (subject_kind IN ('IDENTITY','PLATFORM_ROLE','PLATFORM_PERMISSION','TENANT_ROLE','TENANT_ENTITLEMENT')),
  subject_key text NOT NULL CHECK (char_length(btrim(subject_key)) BETWEEN 1 AND 256),
  effect text NOT NULL CHECK (effect IN ('ALLOW','DENY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kairos_knowledge_acl_target_ck CHECK (((document_id IS NOT NULL)::int + (node_id IS NOT NULL)::int)=1),
  UNIQUE (document_id,node_id,subject_kind,subject_key,effect)
);
CREATE INDEX kairos_knowledge_acl_document_idx ON kairos.knowledge_acl(document_id,effect,subject_kind) WHERE document_id IS NOT NULL;
CREATE INDEX kairos_knowledge_acl_node_idx ON kairos.knowledge_acl(node_id,effect,subject_kind) WHERE node_id IS NOT NULL;

CREATE TABLE kairos.knowledge_provenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN (
    'DISCOVERED','INGESTED','PARSED_NATIVE','OCR_FALLBACK','INDEXED','SUPERSEDED','REJECTED_SECRET','AUTHORITY_CHANGED'
  )),
  source_id uuid NULL REFERENCES kairos.knowledge_sources(id) ON DELETE SET NULL,
  source_revision_id uuid NULL REFERENCES kairos.knowledge_source_revisions(id) ON DELETE SET NULL,
  document_id uuid NULL REFERENCES kairos.knowledge_documents(id) ON DELETE SET NULL,
  node_id uuid NULL REFERENCES kairos.knowledge_nodes(id) ON DELETE SET NULL,
  actor_identity_id uuid NULL REFERENCES identity.identities(id),
  correlation_id text NOT NULL CHECK (char_length(btrim(correlation_id)) BETWEEN 1 AND 256),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kairos_knowledge_provenance_source_idx ON kairos.knowledge_provenance_events(source_id,occurred_at,id);
CREATE INDEX kairos_knowledge_provenance_document_idx ON kairos.knowledge_provenance_events(document_id,occurred_at,id);

CREATE TABLE kairos.knowledge_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES kairos.knowledge_nodes(id) ON DELETE CASCADE,
  model_key text NOT NULL CHECK (char_length(btrim(model_key)) BETWEEN 1 AND 256),
  dimensions integer NOT NULL CHECK (dimensions > 0),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','READY','REJECTED')),
  vector_store_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id,model_key,content_hash)
);

-- No runtime role receives raw mutation authority over Kairos canonical knowledge tables.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA kairos FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA kairos FROM airen_app;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA kairos FROM airen_control_plane;

ALTER SCHEMA kairos OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_sources OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_source_revisions OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_documents OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_sections OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_nodes OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_coordinates OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_relations OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_acl OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_provenance_events OWNER TO airen_control_plane_owner;
ALTER TABLE kairos.knowledge_embeddings OWNER TO airen_control_plane_owner;

GRANT USAGE ON SCHEMA kairos TO airen_control_plane_owner;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA kairos TO airen_control_plane_owner;
GRANT SELECT ON identity.identities,authz.platform_role_assignments,authz.role_permission_grants,authz.tenant_memberships TO airen_control_plane_owner;
GRANT SELECT ON billing.tenant_entitlements,billing.entitlement_catalog TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.kairos_platform_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  SELECT
    NULLIF(current_setting('airen.identity_id',true),'')::uuid IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM identity.identities i
      WHERE i.id=NULLIF(current_setting('airen.identity_id',true),'')::uuid
        AND i.status='active'
    )
    AND EXISTS (
      SELECT 1
      FROM authz.platform_role_assignments pra
      JOIN authz.role_permission_grants rpg
        ON rpg.scope_kind='platform'
       AND rpg.role_key=pra.role_key
       AND rpg.permission_key=p_permission
       AND rpg.effect='allow'
      WHERE pra.identity_id=NULLIF(current_setting('airen.identity_id',true),'')::uuid
        AND pra.status='active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM authz.platform_role_assignments pra
      JOIN authz.role_permission_grants rpg
        ON rpg.scope_kind='platform'
       AND rpg.role_key=pra.role_key
       AND rpg.permission_key=p_permission
       AND rpg.effect='deny'
      WHERE pra.identity_id=NULLIF(current_setting('airen.identity_id',true),'')::uuid
        AND pra.status='active'
    );
$$;
ALTER FUNCTION security.kairos_platform_has_permission(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_platform_has_permission(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_acl_matches(
  p_document_id uuid,
  p_node_id uuid,
  p_effect text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM kairos.knowledge_acl a
    WHERE a.effect=p_effect
      AND (
        (p_node_id IS NULL AND a.document_id=p_document_id AND a.node_id IS NULL)
        OR (p_node_id IS NOT NULL AND a.node_id=p_node_id)
      )
      AND (
        (a.subject_kind='IDENTITY' AND a.subject_key=NULLIF(current_setting('airen.identity_id',true),''))
        OR
        (a.subject_kind='PLATFORM_ROLE' AND EXISTS (
          SELECT 1 FROM authz.platform_role_assignments pra
          WHERE pra.identity_id=NULLIF(current_setting('airen.identity_id',true),'')::uuid
            AND pra.status='active'
            AND pra.role_key=a.subject_key
        ))
        OR
        (a.subject_kind='PLATFORM_PERMISSION' AND security.kairos_platform_has_permission(a.subject_key))
        OR
        (a.subject_kind='TENANT_ROLE' AND EXISTS (
          SELECT 1 FROM authz.tenant_memberships tm
          JOIN identity.identities i ON i.id=tm.identity_id AND i.status='active'
          WHERE tm.identity_id=NULLIF(current_setting('airen.identity_id',true),'')::uuid
            AND tm.tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
            AND tm.status='active'
            AND tm.role_key=a.subject_key
        ))
        OR
        (a.subject_kind='TENANT_ENTITLEMENT' AND EXISTS (
          SELECT 1
          FROM billing.tenant_entitlements te
          JOIN billing.entitlement_catalog ec ON ec.entitlement_key=te.entitlement_key
          WHERE te.tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
            AND te.entitlement_key=a.subject_key
            AND te.enabled=true
            AND ec.status='active'
            AND COALESCE(te.valid_from,'-infinity'::timestamptz) <= now()
            AND (te.valid_until IS NULL OR te.valid_until > now())
        ))
      )
  );
$$;
ALTER FUNCTION security.kairos_acl_matches(uuid,uuid,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_acl_matches(uuid,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_can_read_document(p_document_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_visibility text;
  v_tenant uuid;
  v_permission text;
  v_identity uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_session_tenant uuid := NULLIF(current_setting('airen.tenant_id',true),'')::uuid;
  v_base_allowed boolean := false;
  v_has_acl boolean := false;
BEGIN
  SELECT d.visibility_class,d.tenant_id,d.required_platform_permission
  INTO v_visibility,v_tenant,v_permission
  FROM kairos.knowledge_documents d
  WHERE d.id=p_document_id AND d.status='ACTIVE';
  IF NOT FOUND OR v_identity IS NULL THEN RETURN false; END IF;

  IF v_visibility='PLATFORM_INTERNAL' THEN
    v_base_allowed := security.kairos_platform_has_permission(COALESCE(v_permission,'kairos.knowledge.read.internal'));
  ELSIF v_visibility='TENANT_AUTHORIZED' THEN
    v_base_allowed := v_session_tenant IS NOT NULL
      AND v_session_tenant=v_tenant
      AND EXISTS (
        SELECT 1 FROM authz.tenant_memberships tm
        JOIN identity.identities i ON i.id=tm.identity_id AND i.status='active'
        WHERE tm.identity_id=v_identity AND tm.tenant_id=v_tenant AND tm.status='active'
      );
  ELSE
    v_base_allowed := security.kairos_platform_has_permission(COALESCE(v_permission,'kairos.knowledge.read.public'))
      OR (
        v_session_tenant IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM authz.tenant_memberships tm
          JOIN identity.identities i ON i.id=tm.identity_id AND i.status='active'
          WHERE tm.identity_id=v_identity AND tm.tenant_id=v_session_tenant AND tm.status='active'
        )
      );
  END IF;

  IF NOT v_base_allowed THEN RETURN false; END IF;
  IF security.kairos_acl_matches(p_document_id,NULL,'DENY') THEN RETURN false; END IF;

  SELECT EXISTS(SELECT 1 FROM kairos.knowledge_acl a WHERE a.document_id=p_document_id AND a.node_id IS NULL)
  INTO v_has_acl;

  IF v_visibility='TENANT_AUTHORIZED' OR v_has_acl THEN
    RETURN security.kairos_acl_matches(p_document_id,NULL,'ALLOW');
  END IF;
  RETURN true;
END;
$$;
ALTER FUNCTION security.kairos_can_read_document(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_can_read_document(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_can_read_node(p_node_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_document uuid;
  v_has_acl boolean;
BEGIN
  SELECT n.document_id INTO v_document FROM kairos.knowledge_nodes n WHERE n.id=p_node_id;
  IF NOT FOUND OR NOT security.kairos_can_read_document(v_document) THEN RETURN false; END IF;
  IF security.kairos_acl_matches(v_document,p_node_id,'DENY') THEN RETURN false; END IF;
  SELECT EXISTS(SELECT 1 FROM kairos.knowledge_acl a WHERE a.node_id=p_node_id) INTO v_has_acl;
  IF v_has_acl THEN RETURN security.kairos_acl_matches(v_document,p_node_id,'ALLOW'); END IF;
  RETURN true;
END;
$$;
ALTER FUNCTION security.kairos_can_read_node(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_can_read_node(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_authorized_nodes()
RETURNS TABLE(node_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  SELECT n.id
  FROM kairos.knowledge_nodes n
  JOIN kairos.knowledge_documents d ON d.id=n.document_id AND d.status='ACTIVE'
  WHERE security.kairos_can_read_node(n.id);
$$;
ALTER FUNCTION security.kairos_authorized_nodes() OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_authorized_nodes() FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.kairos_search_lexical(p_query text,p_limit integer DEFAULT 20)
RETURNS TABLE(
  node_id uuid,
  document_id uuid,
  coordinate text,
  title text,
  snippet text,
  lexical_rank real,
  authority_state text,
  authority_weight smallint,
  canonical_pointer text,
  source_anchor text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_query text := btrim(COALESCE(p_query,''));
  v_limit integer := COALESCE(p_limit,20);
BEGIN
  IF char_length(v_query) NOT BETWEEN 2 AND 512 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_QUERY' USING ERRCODE='22023';
  END IF;
  IF v_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_LIMIT' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  WITH q AS (SELECT websearch_to_tsquery('simple',v_query) AS tsq),
  authorized AS (SELECT a.node_id FROM security.kairos_authorized_nodes() a)
  SELECT
    n.id,
    n.document_id,
    c.coordinate,
    COALESCE(n.title,d.title),
    left(n.body_text,400),
    ts_rank_cd(n.search_vector,q.tsq)::real,
    d.authority_state,
    d.authority_weight,
    s.canonical_pointer,
    n.source_anchor
  FROM authorized a
  JOIN kairos.knowledge_nodes n ON n.id=a.node_id
  JOIN kairos.knowledge_documents d ON d.id=n.document_id
  JOIN kairos.knowledge_source_revisions r ON r.id=d.source_revision_id
  JOIN kairos.knowledge_sources s ON s.id=r.source_id
  CROSS JOIN q
  LEFT JOIN LATERAL (
    SELECT kc.coordinate
    FROM kairos.knowledge_coordinates kc
    WHERE kc.node_id=n.id AND kc.status='ACTIVE'
    ORDER BY kc.coordinate
    LIMIT 1
  ) c ON true
  WHERE n.search_vector @@ q.tsq
  ORDER BY d.authority_weight DESC,ts_rank_cd(n.search_vector,q.tsq) DESC,n.id
  LIMIT v_limit;
END;
$$;
ALTER FUNCTION security.kairos_search_lexical(text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_search_lexical(text,integer) FROM PUBLIC;

-- Defense in depth: raw tables are RLS protected even though airen_app has no direct table privileges.
ALTER TABLE kairos.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_source_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_source_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_sections FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_coordinates ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_coordinates FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_relations FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_acl ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_acl FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_provenance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_provenance_events FORCE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE kairos.knowledge_embeddings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kairos_documents_read_policy ON kairos.knowledge_documents;
CREATE POLICY kairos_documents_read_policy ON kairos.knowledge_documents
  FOR SELECT USING (security.kairos_can_read_document(id));
DROP POLICY IF EXISTS kairos_sections_read_policy ON kairos.knowledge_sections;
CREATE POLICY kairos_sections_read_policy ON kairos.knowledge_sections
  FOR SELECT USING (security.kairos_can_read_document(document_id));
DROP POLICY IF EXISTS kairos_nodes_read_policy ON kairos.knowledge_nodes;
CREATE POLICY kairos_nodes_read_policy ON kairos.knowledge_nodes
  FOR SELECT USING (security.kairos_can_read_node(id));
DROP POLICY IF EXISTS kairos_relations_read_policy ON kairos.knowledge_relations;
CREATE POLICY kairos_relations_read_policy ON kairos.knowledge_relations
  FOR SELECT USING (security.kairos_can_read_node(from_node_id) AND security.kairos_can_read_node(to_node_id));
DROP POLICY IF EXISTS kairos_coordinates_read_policy ON kairos.knowledge_coordinates;
CREATE POLICY kairos_coordinates_read_policy ON kairos.knowledge_coordinates
  FOR SELECT USING (
    (node_id IS NOT NULL AND security.kairos_can_read_node(node_id))
    OR (document_id IS NOT NULL AND security.kairos_can_read_document(document_id))
  );

GRANT USAGE ON SCHEMA security TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_platform_has_permission(text) TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_can_read_document(uuid) TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_can_read_node(uuid) TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_authorized_nodes() TO airen_app;
GRANT EXECUTE ON FUNCTION security.kairos_search_lexical(text,integer) TO airen_app;

COMMIT;
