-- K3-D / AIRen Kairos governed ingestion persistence + ACL-first hybrid retrieval boundary
-- Connects K3-B prepared envelopes to K3-A canonical persistence/provenance and fuses only K3-A/K3-C authorized results.
BEGIN;

CREATE OR REPLACE FUNCTION security.kairos_ingestion_checkpoint(p_source_key text)
RETURNS TABLE(
  source_id uuid,
  source_revision_id uuid,
  document_id uuid,
  revision_key text,
  content_hash text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_source_key text := btrim(COALESCE(p_source_key,''));
BEGIN
  IF NOT security.kairos_platform_has_permission('kairos.knowledge.ingest') THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INGEST_PERMISSION_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF char_length(v_source_key) NOT BETWEEN 3 AND 256 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_SOURCE_KEY' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT s.id,r.id,d.id,r.revision_key,r.content_hash::text
  FROM kairos.knowledge_sources s
  JOIN kairos.knowledge_source_revisions r ON r.source_id=s.id AND r.is_current=true
  LEFT JOIN LATERAL (
    SELECT kd.id
    FROM kairos.knowledge_documents kd
    WHERE kd.source_revision_id=r.id AND kd.status='ACTIVE'
    ORDER BY kd.id
    LIMIT 1
  ) d ON true
  WHERE s.source_key=v_source_key AND s.status<>'DISABLED';
END;
$$;
ALTER FUNCTION security.kairos_ingestion_checkpoint(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_ingestion_checkpoint(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.kairos_ingestion_checkpoint(text) TO airen_app;

CREATE OR REPLACE FUNCTION security.kairos_commit_ingestion(
  p_envelope jsonb,
  p_policy jsonb,
  p_correlation_id text
)
RETURNS TABLE(
  source_id uuid,
  source_revision_id uuid,
  document_id uuid,
  unit_count integer,
  changed boolean,
  ingestion_status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_identity uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_correlation text := btrim(COALESCE(p_correlation_id,''));
  v_status text;
  v_source jsonb;
  v_revision jsonb;
  v_units jsonb;
  v_acl jsonb;
  v_source_key text;
  v_source_type text;
  v_pointer text;
  v_title text;
  v_observed_at timestamptz;
  v_revision_key text;
  v_content_hash text;
  v_parser_kind text;
  v_native boolean;
  v_ocr boolean;
  v_document_kind text;
  v_authority_state text;
  v_authority_weight smallint;
  v_visibility text;
  v_tenant uuid;
  v_required_permission text;
  v_source_id uuid;
  v_current_revision_id uuid;
  v_current_revision_key text;
  v_current_hash text;
  v_current_document_id uuid;
  v_document_id uuid;
  v_section_id uuid;
  v_unit jsonb;
  v_acl_rule jsonb;
  v_ordinal integer;
  v_expected_ordinal integer := 0;
  v_unit_type text;
  v_heading text;
  v_body text;
  v_anchor text;
  v_count integer := 0;
  v_existing_source_type text;
  v_existing_pointer text;
  v_existing_visibility text;
  v_existing_tenant uuid;
  v_existing_status text;
  v_source_was_new boolean := false;
  v_reused_hash text;
BEGIN
  IF NOT security.kairos_platform_has_permission('kairos.knowledge.ingest') THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INGEST_PERMISSION_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF v_identity IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_IDENTITY_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF char_length(v_correlation) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_CORRELATION_ID' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_envelope)<>'object' OR jsonb_typeof(p_policy)<>'object' THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_INGESTION_ENVELOPE' USING ERRCODE='22023';
  END IF;

  v_status := p_envelope->>'status';
  v_source := p_envelope->'source';
  v_revision := p_envelope->'revision';
  v_units := p_envelope->'units';
  IF v_status NOT IN ('READY_NEW_SOURCE','READY_NEW_REVISION','UNCHANGED')
     OR jsonb_typeof(v_source)<>'object' OR jsonb_typeof(v_revision)<>'object'
     OR jsonb_typeof(v_units)<>'array' OR jsonb_array_length(v_units)=0 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_INGESTION_ENVELOPE' USING ERRCODE='22023';
  END IF;

  v_source_key := btrim(COALESCE(v_source->>'sourceKey',''));
  v_source_type := v_source->>'sourceType';
  v_pointer := btrim(COALESCE(v_source->>'canonicalPointer',''));
  v_title := btrim(COALESCE(v_source->>'title',''));
  IF char_length(v_source_key) NOT BETWEEN 3 AND 256
     OR v_source_type NOT IN ('GOOGLE_DRIVE','GITHUB','RUNTIME_EVIDENCE','OCR_DERIVED','AIRENOS_INTERNAL')
     OR char_length(v_pointer) NOT BETWEEN 1 AND 2048
     OR char_length(v_title) NOT BETWEEN 1 AND 1024 THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_SOURCE_IDENTITY' USING ERRCODE='22023';
  END IF;
  BEGIN
    v_observed_at := (v_source->>'observedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_OBSERVED_AT' USING ERRCODE='22023';
  END;

  v_revision_key := btrim(COALESCE(v_revision->>'revisionKey',''));
  v_content_hash := lower(COALESCE(v_revision->>'contentHash',''));
  v_parser_kind := btrim(COALESCE(v_revision->>'parserKind',''));
  IF char_length(v_revision_key) NOT BETWEEN 1 AND 512
     OR v_content_hash !~ '^[0-9a-f]{64}$'
     OR char_length(v_parser_kind) NOT BETWEEN 1 AND 128
     OR v_revision->>'secretScanStatus'<>'PASS'
     OR v_revision->>'containsSecretValues'<>'false'
     OR v_revision->>'nativeTextAvailable' NOT IN ('true','false')
     OR v_revision->>'ocrFallbackUsed' NOT IN ('true','false') THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_SECRET_ATTESTATION_OR_REVISION_INVALID' USING ERRCODE='22023';
  END IF;
  v_native := (v_revision->>'nativeTextAvailable')::boolean;
  v_ocr := (v_revision->>'ocrFallbackUsed')::boolean;

  v_document_kind := btrim(COALESCE(p_policy->>'documentKind',''));
  v_authority_state := p_policy->>'authorityState';
  v_visibility := p_policy->>'visibilityClass';
  v_required_permission := NULLIF(btrim(COALESCE(p_policy->>'requiredPlatformPermission','')),'');
  v_acl := COALESCE(p_policy->'documentAcl','[]'::jsonb);
  IF char_length(v_document_kind) NOT BETWEEN 1 AND 128 OR jsonb_typeof(v_acl)<>'array' THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_INGESTION_POLICY' USING ERRCODE='22023';
  END IF;
  v_authority_weight := CASE v_authority_state
    WHEN 'GOVERNANCE_BINDING' THEN 120 WHEN 'CURRENT_CANONICAL' THEN 115 WHEN 'CERTIFIED' THEN 110
    WHEN 'CLOSED_PASS' THEN 105 WHEN 'CURRENT' THEN 100 WHEN 'DESIGN_FROZEN' THEN 95 WHEN 'EVIDENCE' THEN 80
    WHEN 'HISTORICAL' THEN 60 WHEN 'FAILED_CLOSED' THEN 55 WHEN 'SUPERSEDED' THEN 40 WHEN 'DRAFT' THEN 20
    WHEN 'UNVERIFIED' THEN 10 ELSE NULL END;
  IF v_authority_weight IS NULL OR v_visibility NOT IN ('PLATFORM_INTERNAL','TENANT_AUTHORIZED','PUBLIC_PRODUCT') THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_AUTHORITY_OR_VISIBILITY' USING ERRCODE='22023';
  END IF;
  IF p_policy ? 'tenantId' AND NULLIF(btrim(COALESCE(p_policy->>'tenantId','')),'') IS NOT NULL THEN
    BEGIN
      v_tenant := (p_policy->>'tenantId')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_TENANT_ID' USING ERRCODE='22023';
    END;
  END IF;
  IF (v_visibility='TENANT_AUTHORIZED' AND v_tenant IS NULL)
     OR (v_visibility<>'TENANT_AUTHORIZED' AND v_tenant IS NOT NULL) THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_VISIBILITY_SCOPE_MISMATCH' USING ERRCODE='22023';
  END IF;
  IF v_visibility='TENANT_AUTHORIZED' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_acl) a(value) WHERE a.value->>'effect'='ALLOW'
  ) THEN
    RAISE EXCEPTION 'AIRENOS_KAIROS_TENANT_ACL_ALLOW_REQUIRED' USING ERRCODE='22023';
  END IF;

  SELECT s.id,s.source_type,s.canonical_pointer,s.visibility_class,s.tenant_id,s.status
  INTO v_source_id,v_existing_source_type,v_existing_pointer,v_existing_visibility,v_existing_tenant,v_existing_status
  FROM kairos.knowledge_sources s WHERE s.source_key=v_source_key;
  IF FOUND THEN
    IF v_existing_status='DISABLED' OR v_existing_source_type<>v_source_type OR v_existing_pointer<>v_pointer
       OR v_existing_visibility<>v_visibility OR v_existing_tenant IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'AIRENOS_KAIROS_SOURCE_IDENTITY_CONFLICT' USING ERRCODE='23505';
    END IF;
  ELSE
    IF v_status<>'READY_NEW_SOURCE' THEN
      RAISE EXCEPTION 'AIRENOS_KAIROS_SOURCE_STATE_MISMATCH' USING ERRCODE='22023';
    END IF;
    INSERT INTO kairos.knowledge_sources(source_key,source_type,canonical_pointer,title,visibility_class,tenant_id,status)
    VALUES(v_source_key,v_source_type,v_pointer,v_title,v_visibility,v_tenant,'CURRENT') RETURNING id INTO v_source_id;
    v_source_was_new := true;
  END IF;

  SELECT r.id,r.revision_key,r.content_hash::text,d.id
  INTO v_current_revision_id,v_current_revision_key,v_current_hash,v_current_document_id
  FROM kairos.knowledge_source_revisions r
  LEFT JOIN LATERAL (
    SELECT kd.id FROM kairos.knowledge_documents kd
    WHERE kd.source_revision_id=r.id AND kd.status='ACTIVE' ORDER BY kd.id LIMIT 1
  ) d ON true
  WHERE r.source_id=v_source_id AND r.is_current=true;

  IF FOUND AND v_current_revision_key=v_revision_key THEN
    IF v_current_hash<>v_content_hash THEN
      RAISE EXCEPTION 'AIRENOS_KAIROS_REVISION_KEY_REUSED_WITH_DIFFERENT_CONTENT' USING ERRCODE='23505';
    END IF;
    IF v_status<>'UNCHANGED' THEN
      RAISE EXCEPTION 'AIRENOS_KAIROS_SOURCE_STATE_MISMATCH' USING ERRCODE='22023';
    END IF;
    SELECT count(*)::integer INTO v_count FROM kairos.knowledge_nodes n WHERE n.document_id=v_current_document_id;
    RETURN QUERY SELECT v_source_id,v_current_revision_id,v_current_document_id,v_count,false,'UNCHANGED'::text;
    RETURN;
  END IF;

  SELECT r.content_hash::text INTO v_reused_hash
  FROM kairos.knowledge_source_revisions r
  WHERE r.source_id=v_source_id AND r.revision_key=v_revision_key LIMIT 1;
  IF FOUND THEN
    IF v_reused_hash<>v_content_hash THEN
      RAISE EXCEPTION 'AIRENOS_KAIROS_REVISION_KEY_REUSED_WITH_DIFFERENT_CONTENT' USING ERRCODE='23505';
    END IF;
    RAISE EXCEPTION 'AIRENOS_KAIROS_HISTORICAL_REVISION_REPLAY_REJECTED' USING ERRCODE='23505';
  END IF;

  IF v_source_was_new THEN
    IF v_status<>'READY_NEW_SOURCE' THEN RAISE EXCEPTION 'AIRENOS_KAIROS_SOURCE_STATE_MISMATCH' USING ERRCODE='22023'; END IF;
  ELSE
    IF v_status<>'READY_NEW_REVISION' THEN RAISE EXCEPTION 'AIRENOS_KAIROS_SOURCE_STATE_MISMATCH' USING ERRCODE='22023'; END IF;
  END IF;

  IF v_current_revision_id IS NOT NULL THEN
    INSERT INTO kairos.knowledge_provenance_events(event_type,source_id,source_revision_id,document_id,actor_identity_id,correlation_id,metadata)
    SELECT 'SUPERSEDED',v_source_id,v_current_revision_id,d.id,v_identity,v_correlation,
           jsonb_build_object('supersededByRevisionKey',v_revision_key)
    FROM kairos.knowledge_documents d WHERE d.source_revision_id=v_current_revision_id AND d.status='ACTIVE';
    UPDATE kairos.knowledge_documents SET status='SUPERSEDED',updated_at=now() WHERE source_revision_id=v_current_revision_id AND status='ACTIVE';
    UPDATE kairos.knowledge_source_revisions SET is_current=false WHERE id=v_current_revision_id;
  END IF;
  UPDATE kairos.knowledge_sources SET title=v_title,status='CURRENT',updated_at=now() WHERE id=v_source_id;

  INSERT INTO kairos.knowledge_source_revisions(
    source_id,revision_key,content_hash,parser_kind,native_text_available,secret_scan_status,contains_secret_values,observed_at,is_current,metadata
  ) VALUES(
    v_source_id,v_revision_key,v_content_hash,v_parser_kind,v_native,'PASS',false,v_observed_at,true,
    jsonb_build_object('ocrFallbackUsed',v_ocr,'unitCount',jsonb_array_length(v_units))
  ) RETURNING id INTO source_revision_id;

  INSERT INTO kairos.knowledge_documents(
    source_revision_id,title,document_kind,authority_state,authority_weight,visibility_class,tenant_id,source_anchor,required_platform_permission,status
  ) VALUES(
    source_revision_id,v_title,v_document_kind,v_authority_state,v_authority_weight,v_visibility,v_tenant,'$document',v_required_permission,'ACTIVE'
  ) RETURNING id INTO v_document_id;

  FOR v_acl_rule IN SELECT value FROM jsonb_array_elements(v_acl) LOOP
    IF v_acl_rule->>'subjectKind' NOT IN ('IDENTITY','PLATFORM_ROLE','PLATFORM_PERMISSION','TENANT_ROLE','TENANT_ENTITLEMENT')
       OR char_length(btrim(COALESCE(v_acl_rule->>'subjectKey',''))) NOT BETWEEN 1 AND 256
       OR v_acl_rule->>'effect' NOT IN ('ALLOW','DENY') THEN
      RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_DOCUMENT_ACL' USING ERRCODE='22023';
    END IF;
    INSERT INTO kairos.knowledge_acl(document_id,subject_kind,subject_key,effect)
    VALUES(v_document_id,v_acl_rule->>'subjectKind',btrim(v_acl_rule->>'subjectKey'),v_acl_rule->>'effect')
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR v_unit IN SELECT value FROM jsonb_array_elements(v_units) LOOP
    BEGIN v_ordinal := (v_unit->>'ordinal')::integer; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_UNIT_ORDINAL' USING ERRCODE='22023'; END;
    v_unit_type := v_unit->>'unitType';
    v_heading := NULLIF(btrim(COALESCE(v_unit->>'heading','')),'');
    v_body := COALESCE(v_unit->>'bodyText','');
    v_anchor := btrim(COALESCE(v_unit->>'sourceAnchor',''));
    IF v_ordinal<>v_expected_ordinal OR v_unit_type NOT IN ('SECTION','PARAGRAPH','CODE','STRUCTURED')
       OR char_length(v_anchor) NOT BETWEEN 1 AND 2048 THEN
      RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_PARSED_UNIT' USING ERRCODE='22023';
    END IF;
    INSERT INTO kairos.knowledge_sections(document_id,ordinal,heading,body_text,source_anchor)
    VALUES(v_document_id,v_ordinal,v_heading,v_body,v_anchor) RETURNING id INTO v_section_id;
    INSERT INTO kairos.knowledge_nodes(document_id,section_id,node_type,title,body_text,source_anchor,metadata)
    VALUES(v_document_id,v_section_id,v_unit_type,v_heading,v_body,v_anchor,jsonb_build_object('ordinal',v_ordinal,'unitType',v_unit_type));
    v_expected_ordinal := v_expected_ordinal+1;
    v_count := v_count+1;
  END LOOP;

  INSERT INTO kairos.knowledge_provenance_events(event_type,source_id,source_revision_id,document_id,actor_identity_id,correlation_id,metadata)
  VALUES
    ('INGESTED',v_source_id,source_revision_id,v_document_id,v_identity,v_correlation,jsonb_build_object('parserKind',v_parser_kind,'unitCount',v_count)),
    (CASE WHEN v_ocr THEN 'OCR_FALLBACK' ELSE 'PARSED_NATIVE' END,v_source_id,source_revision_id,v_document_id,v_identity,v_correlation,jsonb_build_object('unitCount',v_count)),
    ('INDEXED',v_source_id,source_revision_id,v_document_id,v_identity,v_correlation,jsonb_build_object('lexical',true,'semanticPending',true));

  RETURN QUERY SELECT v_source_id,source_revision_id,v_document_id,v_count,true,v_status;
END;
$$;
ALTER FUNCTION security.kairos_commit_ingestion(jsonb,jsonb,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_commit_ingestion(jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.kairos_commit_ingestion(jsonb,jsonb,text) TO airen_app;

CREATE OR REPLACE FUNCTION security.kairos_search_hybrid(
  p_query text,
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
  lexical_rank real,
  semantic_distance double precision,
  fusion_score double precision,
  authority_state text,
  authority_weight smallint,
  canonical_pointer text,
  source_anchor text,
  model_key text,
  matched_lexical boolean,
  matched_semantic boolean
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
  IF char_length(v_query) NOT BETWEEN 2 AND 512 THEN RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_QUERY' USING ERRCODE='22023'; END IF;
  IF v_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'AIRENOS_KAIROS_INVALID_LIMIT' USING ERRCODE='22023'; END IF;
  IF NOT security.kairos_vector_runtime_available() THEN RAISE EXCEPTION 'AIRENOS_KAIROS_VECTOR_RUNTIME_UNAVAILABLE' USING ERRCODE='55000'; END IF;

  RETURN QUERY
  WITH lexical AS (
    SELECT l.*,row_number() OVER (ORDER BY l.authority_weight DESC,l.lexical_rank DESC,l.node_id) AS rank_position
    FROM security.kairos_search_lexical(v_query,50) l
  ),
  semantic AS (
    SELECT s.*,row_number() OVER (ORDER BY s.authority_weight DESC,s.semantic_distance ASC,s.node_id) AS rank_position
    FROM security.kairos_search_semantic(p_model_key,p_query_embedding,50) s
  ),
  fused AS (
    SELECT
      COALESCE(l.node_id,s.node_id) AS node_id,
      COALESCE(l.document_id,s.document_id) AS document_id,
      COALESCE(l.coordinate,s.coordinate) AS coordinate,
      COALESCE(l.title,s.title) AS title,
      COALESCE(l.snippet,s.snippet) AS snippet,
      l.lexical_rank,
      s.semantic_distance,
      ((CASE WHEN l.node_id IS NULL THEN 0.0 ELSE 1.0/l.rank_position::double precision END)
       +(CASE WHEN s.node_id IS NULL THEN 0.0 ELSE 1.0/s.rank_position::double precision END)) AS fusion_score,
      COALESCE(l.authority_state,s.authority_state) AS authority_state,
      COALESCE(l.authority_weight,s.authority_weight) AS authority_weight,
      COALESCE(l.canonical_pointer,s.canonical_pointer) AS canonical_pointer,
      COALESCE(l.source_anchor,s.source_anchor) AS source_anchor,
      p_model_key AS model_key,
      l.node_id IS NOT NULL AS matched_lexical,
      s.node_id IS NOT NULL AS matched_semantic
    FROM lexical l FULL OUTER JOIN semantic s ON s.node_id=l.node_id
  )
  SELECT f.node_id,f.document_id,f.coordinate,f.title,f.snippet,f.lexical_rank,f.semantic_distance,f.fusion_score,
         f.authority_state,f.authority_weight,f.canonical_pointer,f.source_anchor,f.model_key,f.matched_lexical,f.matched_semantic
  FROM fused f
  ORDER BY f.authority_weight DESC,f.fusion_score DESC,f.lexical_rank DESC NULLS LAST,f.semantic_distance ASC NULLS LAST,f.node_id
  LIMIT v_limit;
END;
$$;
ALTER FUNCTION security.kairos_search_hybrid(text,text,text,integer) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.kairos_search_hybrid(text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.kairos_search_hybrid(text,text,text,integer) TO airen_app;

COMMIT;
