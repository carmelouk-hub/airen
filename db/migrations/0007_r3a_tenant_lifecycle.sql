-- R3-A / 0007 Tenant lifecycle + platform query surface
-- Preserves Tenant.slug as stable SaaS identity. No hard delete and no silent child cascade.
BEGIN;

CREATE TABLE platform.tenant_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  from_status text NOT NULL CHECK (from_status IN ('active','suspended','archived')),
  to_status text NOT NULL CHECK (to_status IN ('active','suspended','archived')),
  reason_code text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'platform_control_plane',
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tenant_state_transition_actual_change CHECK (from_status <> to_status)
);
CREATE INDEX idx_tenant_state_transitions_tenant_created ON platform.tenant_state_transitions(tenant_id, created_at DESC);
REVOKE ALL ON platform.tenant_state_transitions FROM PUBLIC;

CREATE TABLE platform.tenant_lifecycle_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  action_key text NOT NULL CHECK (action_key IN ('update','suspend','reactivate','archive')),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_tenant_lifecycle_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_tenant_lifecycle_completed_result CHECK (status <> 'completed' OR (result IS NOT NULL AND completed_at IS NOT NULL))
);
REVOKE ALL ON platform.tenant_lifecycle_idempotency FROM PUBLIC;

INSERT INTO authz.permission_registry(permission_key, description, sensitivity) VALUES
  ('platform.tenants.read', 'Read safe Tenant control-plane projections', 'high'),
  ('platform.tenants.update', 'Update mutable Tenant metadata', 'high'),
  ('platform.tenants.suspend', 'Suspend active Tenant', 'critical'),
  ('platform.tenants.reactivate', 'Reactivate suspended Tenant', 'critical'),
  ('platform.tenants.archive', 'Archive Tenant without hard deletion', 'critical')
ON CONFLICT (permission_key) DO NOTHING;

GRANT SELECT, UPDATE ON platform.tenants TO airen_control_plane_owner;
GRANT SELECT, INSERT, UPDATE ON platform.tenant_lifecycle_idempotency TO airen_control_plane_owner;
GRANT INSERT, SELECT ON platform.tenant_state_transitions TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.platform_mutate_tenant(
  p_action text,
  p_idempotency_key text,
  p_tenant_id uuid,
  p_name text,
  p_locale text,
  p_timezone text,
  p_currency text,
  p_reason_code text
)
RETURNS TABLE (
  action_key text,
  tenant_id uuid,
  tenant_slug text,
  tenant_name text,
  tenant_status text,
  tenant_locale text,
  tenant_timezone text,
  tenant_currency text,
  tenant_created_at timestamptz,
  tenant_updated_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id', true), '');
  v_permission text;
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_from_status text;
  v_to_status text;
  v_row platform.tenants%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('update','suspend','reactivate','archive') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:action' USING ERRCODE='22023'; END IF;
  v_permission := CASE p_action
    WHEN 'update' THEN 'platform.tenants.update'
    WHEN 'suspend' THEN 'platform.tenants.suspend'
    WHEN 'reactivate' THEN 'platform.tenants.reactivate'
    WHEN 'archive' THEN 'platform.tenants.archive'
  END;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key=v_permission AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:tenant_id' USING ERRCODE='22023'; END IF;
  IF p_action='update' THEN
    IF p_name IS NULL AND p_locale IS NULL AND p_timezone IS NULL AND p_currency IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:update_empty' USING ERRCODE='22023'; END IF;
    IF p_name IS NOT NULL AND btrim(p_name)='' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:name' USING ERRCODE='22023'; END IF;
    IF p_locale IS NOT NULL AND btrim(p_locale)='' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:locale' USING ERRCODE='22023'; END IF;
    IF p_timezone IS NOT NULL AND btrim(p_timezone)='' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:timezone' USING ERRCODE='22023'; END IF;
    IF p_currency IS NOT NULL AND p_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:currency' USING ERRCODE='22023'; END IF;
    IF p_reason_code IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:update_reason' USING ERRCODE='22023'; END IF;
  ELSE
    IF p_name IS NOT NULL OR p_locale IS NOT NULL OR p_timezone IS NOT NULL OR p_currency IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:state_fields' USING ERRCODE='22023'; END IF;
    IF p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;
  END IF;

  SELECT * INTO v_row FROM platform.tenants WHERE id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_TENANT_NOT_FOUND' USING ERRCODE='P0002'; END IF;

  v_request_hash := encode(public.digest(jsonb_build_object(
    'action',p_action,'tenantId',p_tenant_id,'name',p_name,'locale',p_locale,'timezone',p_timezone,'currency',p_currency,'reasonCode',p_reason_code
  )::text, 'sha256'), 'hex');

  INSERT INTO platform.tenant_lifecycle_idempotency(idempotency_key, request_hash, action_key, tenant_id, actor_identity_id)
  VALUES (p_idempotency_key, v_request_hash, p_action, p_tenant_id, v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT request_hash, status, result INTO v_existing_hash, v_existing_status, v_existing_result
  FROM platform.tenant_lifecycle_idempotency WHERE idempotency_key=p_idempotency_key FOR UPDATE;

  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT
      p_action,
      (v_existing_result->>'id')::uuid,
      v_existing_result->>'slug',
      v_existing_result->>'name',
      v_existing_result->>'status',
      v_existing_result->>'locale',
      v_existing_result->>'timezone',
      v_existing_result->>'currency',
      (v_existing_result->>'createdAt')::timestamptz,
      (v_existing_result->>'updatedAt')::timestamptz,
      true;
    RETURN;
  END IF;

  v_from_status := v_row.status;
  IF p_action='update' THEN
    IF v_row.status='archived' THEN RAISE EXCEPTION 'AIRENOS_INVALID_TENANT_STATE:archived_update' USING ERRCODE='P0001'; END IF;
    UPDATE platform.tenants SET
      name=COALESCE(p_name,name), locale=COALESCE(p_locale,locale), timezone=COALESCE(p_timezone,timezone), currency=COALESCE(p_currency,currency), updated_at=now()
    WHERE id=p_tenant_id RETURNING * INTO v_row;
  ELSIF p_action='suspend' THEN
    IF v_row.status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_INVALID_TENANT_STATE:suspend_requires_active' USING ERRCODE='P0001'; END IF;
    v_to_status := 'suspended';
    UPDATE platform.tenants SET status=v_to_status, updated_at=now() WHERE id=p_tenant_id RETURNING * INTO v_row;
  ELSIF p_action='reactivate' THEN
    IF v_row.status <> 'suspended' THEN RAISE EXCEPTION 'AIRENOS_INVALID_TENANT_STATE:reactivate_requires_suspended' USING ERRCODE='P0001'; END IF;
    v_to_status := 'active';
    UPDATE platform.tenants SET status=v_to_status, updated_at=now() WHERE id=p_tenant_id RETURNING * INTO v_row;
  ELSE
    IF v_row.status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'AIRENOS_INVALID_TENANT_STATE:archive_terminal' USING ERRCODE='P0001'; END IF;
    v_to_status := 'archived';
    UPDATE platform.tenants SET status=v_to_status, updated_at=now() WHERE id=p_tenant_id RETURNING * INTO v_row;
  END IF;

  IF p_action <> 'update' THEN
    INSERT INTO platform.tenant_state_transitions(tenant_id,from_status,to_status,reason_code,actor_identity_id,correlation_id)
    VALUES (p_tenant_id,v_from_status,v_to_status,p_reason_code,v_actor,v_correlation);
  END IF;

  INSERT INTO audit.audit_events(tenant_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES (p_tenant_id,v_actor,'user','platform.tenant.'||p_action,'Tenant',p_tenant_id::text,v_correlation,'success',
    jsonb_strip_nulls(jsonb_build_object('reasonCode',p_reason_code,'previousStatus',v_from_status,'status',v_row.status,'name',p_name,'locale',p_locale,'timezone',p_timezone,'currency',p_currency)));

  INSERT INTO events.outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES (p_tenant_id,'platform.tenant.'||CASE WHEN p_action='reactivate' THEN 'reactivated' WHEN p_action='archive' THEN 'archived' WHEN p_action='suspend' THEN 'suspended' ELSE 'updated' END,
    'Tenant',p_tenant_id::text,1,jsonb_build_object('tenantId',p_tenant_id,'slug',v_row.slug,'status',v_row.status,'action',p_action,'reasonCode',p_reason_code),v_correlation);

  v_result := jsonb_build_object('id',v_row.id,'slug',v_row.slug,'name',v_row.name,'status',v_row.status,'locale',v_row.locale,'timezone',v_row.timezone,'currency',v_row.currency,'createdAt',v_row.created_at,'updatedAt',v_row.updated_at);
  UPDATE platform.tenant_lifecycle_idempotency SET status='completed', result=v_result, completed_at=now() WHERE idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT p_action,v_row.id,v_row.slug,v_row.name,v_row.status,v_row.locale,v_row.timezone,v_row.currency,v_row.created_at,v_row.updated_at,false;
END;
$$;
ALTER FUNCTION security.platform_mutate_tenant(text,text,uuid,text,text,text,text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_tenant(text,text,uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_tenant(text,text,uuid,text,text,text,text,text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_get_tenant(p_tenant_id uuid)
RETURNS TABLE (
  tenant_id uuid, tenant_slug text, tenant_name text, tenant_status text, tenant_locale text, tenant_timezone text, tenant_currency text, tenant_created_at timestamptz, tenant_updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.tenants.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT t.id,t.slug,t.name,t.status,t.locale,t.timezone,t.currency,t.created_at,t.updated_at FROM platform.tenants t WHERE t.id=p_tenant_id;
END; $$;
ALTER FUNCTION security.platform_get_tenant(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_tenant(uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_tenants(p_status text DEFAULT NULL, p_after uuid DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS TABLE (
  tenant_id uuid, tenant_slug text, tenant_name text, tenant_status text, tenant_locale text, tenant_timezone text, tenant_currency text, tenant_created_at timestamptz, tenant_updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.tenants.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active','suspended','archived') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:status' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT t.id,t.slug,t.name,t.status,t.locale,t.timezone,t.currency,t.created_at,t.updated_at
    FROM platform.tenants t
    WHERE (p_status IS NULL OR t.status=p_status) AND (p_after IS NULL OR t.id>p_after)
    ORDER BY t.id ASC LIMIT p_limit;
END; $$;
ALTER FUNCTION security.platform_list_tenants(text,uuid,int) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_tenants(text,uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_tenants(text,uuid,int) TO airen_control_plane;

COMMIT;
