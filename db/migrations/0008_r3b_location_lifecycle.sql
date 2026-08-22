-- R3-B / 0008 Location lifecycle + primary transfer + platform query surface
-- Preserves immutable Location tenant ownership and slug. No hard delete.
BEGIN;

CREATE TABLE platform.location_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  from_status text NOT NULL CHECK (from_status IN ('active','suspended','archived')),
  to_status text NOT NULL CHECK (to_status IN ('active','suspended','archived')),
  reason_code text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'platform_control_plane',
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_location_state_transition_scope FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT ck_location_state_transition_actual_change CHECK (from_status <> to_status)
);
CREATE INDEX idx_location_state_transitions_location_created ON platform.location_state_transitions(location_id, created_at DESC);
CREATE INDEX idx_location_state_transitions_tenant_created ON platform.location_state_transitions(tenant_id, created_at DESC);
REVOKE ALL ON platform.location_state_transitions FROM PUBLIC;

CREATE TABLE platform.location_lifecycle_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  action_key text NOT NULL CHECK (action_key IN ('update','suspend','reactivate','archive','transfer_primary')),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT fk_location_lifecycle_idempotency_scope FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT ck_location_lifecycle_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_location_lifecycle_completed_result CHECK (status <> 'completed' OR (result IS NOT NULL AND completed_at IS NOT NULL))
);
REVOKE ALL ON platform.location_lifecycle_idempotency FROM PUBLIC;

INSERT INTO authz.permission_registry(permission_key, description, sensitivity) VALUES
  ('platform.locations.read', 'Read safe Location control-plane projections', 'high'),
  ('platform.locations.update', 'Update mutable Location metadata', 'high'),
  ('platform.locations.suspend', 'Suspend active Location', 'critical'),
  ('platform.locations.reactivate', 'Reactivate suspended Location', 'critical'),
  ('platform.locations.archive', 'Archive Location without hard deletion', 'critical'),
  ('platform.locations.transfer_primary', 'Transfer the primary Location within a Tenant', 'critical')
ON CONFLICT (permission_key) DO NOTHING;

GRANT SELECT, UPDATE ON platform.locations TO airen_control_plane_owner;
GRANT SELECT ON platform.tenants TO airen_control_plane_owner;
GRANT SELECT, INSERT, UPDATE ON platform.location_lifecycle_idempotency TO airen_control_plane_owner;
GRANT INSERT, SELECT ON platform.location_state_transitions TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.platform_mutate_location(
  p_action text,
  p_idempotency_key text,
  p_location_id uuid,
  p_name text,
  p_timezone text,
  p_reason_code text
)
RETURNS TABLE (
  action_key text,
  location_id uuid,
  tenant_id uuid,
  location_slug text,
  location_name text,
  location_status text,
  location_timezone text,
  location_is_primary boolean,
  location_created_at timestamptz,
  location_updated_at timestamptz,
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
  v_tenant_status text;
  v_row platform.locations%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('update','suspend','reactivate','archive') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:action' USING ERRCODE='22023'; END IF;
  v_permission := CASE p_action
    WHEN 'update' THEN 'platform.locations.update'
    WHEN 'suspend' THEN 'platform.locations.suspend'
    WHEN 'reactivate' THEN 'platform.locations.reactivate'
    WHEN 'archive' THEN 'platform.locations.archive'
  END;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key=v_permission AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_location_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:location_id' USING ERRCODE='22023'; END IF;
  IF p_action='update' THEN
    IF p_name IS NULL AND p_timezone IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:update_empty' USING ERRCODE='22023'; END IF;
    IF p_name IS NOT NULL AND btrim(p_name)='' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:name' USING ERRCODE='22023'; END IF;
    IF p_timezone IS NOT NULL AND btrim(p_timezone)='' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:timezone' USING ERRCODE='22023'; END IF;
    IF p_reason_code IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:update_reason' USING ERRCODE='22023'; END IF;
  ELSE
    IF p_name IS NOT NULL OR p_timezone IS NOT NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:state_fields' USING ERRCODE='22023'; END IF;
    IF p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;
  END IF;

  SELECT * INTO v_row FROM platform.locations WHERE id=p_location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_LOCATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;

  v_request_hash := encode(public.digest(jsonb_build_object(
    'action',p_action,'locationId',p_location_id,'name',p_name,'timezone',p_timezone,'reasonCode',p_reason_code
  )::text, 'sha256'), 'hex');

  INSERT INTO platform.location_lifecycle_idempotency(idempotency_key, request_hash, action_key, tenant_id, location_id, actor_identity_id)
  VALUES (p_idempotency_key, v_request_hash, p_action, v_row.tenant_id, p_location_id, v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT request_hash, status, result INTO v_existing_hash, v_existing_status, v_existing_result
  FROM platform.location_lifecycle_idempotency WHERE idempotency_key=p_idempotency_key FOR UPDATE;

  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT
      p_action,
      (v_existing_result->>'id')::uuid,
      (v_existing_result->>'tenantId')::uuid,
      v_existing_result->>'slug',
      v_existing_result->>'name',
      v_existing_result->>'status',
      v_existing_result->>'timezone',
      (v_existing_result->>'isPrimary')::boolean,
      (v_existing_result->>'createdAt')::timestamptz,
      (v_existing_result->>'updatedAt')::timestamptz,
      true;
    RETURN;
  END IF;

  v_from_status := v_row.status;
  IF p_action='update' THEN
    IF v_row.status='archived' THEN RAISE EXCEPTION 'AIRENOS_INVALID_LOCATION_STATE:archived_update' USING ERRCODE='P0001'; END IF;
    UPDATE platform.locations SET
      name=COALESCE(p_name,name), timezone=COALESCE(p_timezone,timezone), updated_at=now()
    WHERE id=p_location_id RETURNING * INTO v_row;
  ELSIF p_action='suspend' THEN
    IF v_row.status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_INVALID_LOCATION_STATE:suspend_requires_active' USING ERRCODE='P0001'; END IF;
    IF v_row.is_primary THEN
      SELECT status INTO v_tenant_status FROM platform.tenants WHERE id=v_row.tenant_id;
      IF v_tenant_status='active' THEN RAISE EXCEPTION 'AIRENOS_PRIMARY_LOCATION_TRANSFER_REQUIRED' USING ERRCODE='P0001'; END IF;
    END IF;
    v_to_status := 'suspended';
    UPDATE platform.locations SET status=v_to_status, updated_at=now() WHERE id=p_location_id RETURNING * INTO v_row;
  ELSIF p_action='reactivate' THEN
    IF v_row.status <> 'suspended' THEN RAISE EXCEPTION 'AIRENOS_INVALID_LOCATION_STATE:reactivate_requires_suspended' USING ERRCODE='P0001'; END IF;
    v_to_status := 'active';
    UPDATE platform.locations SET status=v_to_status, updated_at=now() WHERE id=p_location_id RETURNING * INTO v_row;
  ELSE
    IF v_row.status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'AIRENOS_INVALID_LOCATION_STATE:archive_terminal' USING ERRCODE='P0001'; END IF;
    IF v_row.is_primary THEN
      SELECT status INTO v_tenant_status FROM platform.tenants WHERE id=v_row.tenant_id;
      IF v_tenant_status='active' THEN RAISE EXCEPTION 'AIRENOS_PRIMARY_LOCATION_TRANSFER_REQUIRED' USING ERRCODE='P0001'; END IF;
    END IF;
    v_to_status := 'archived';
    UPDATE platform.locations SET status=v_to_status, updated_at=now() WHERE id=p_location_id RETURNING * INTO v_row;
  END IF;

  IF p_action <> 'update' THEN
    INSERT INTO platform.location_state_transitions(location_id,tenant_id,from_status,to_status,reason_code,actor_identity_id,correlation_id)
    VALUES (p_location_id,v_row.tenant_id,v_from_status,v_to_status,p_reason_code,v_actor,v_correlation);
  END IF;

  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES (v_row.tenant_id,p_location_id,v_actor,'user','platform.location.'||p_action,'Location',p_location_id::text,v_correlation,'success',
    jsonb_strip_nulls(jsonb_build_object('reasonCode',p_reason_code,'previousStatus',v_from_status,'status',v_row.status,'name',p_name,'timezone',p_timezone)));

  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES (v_row.tenant_id,p_location_id,'platform.location.'||CASE WHEN p_action='reactivate' THEN 'reactivated' WHEN p_action='archive' THEN 'archived' WHEN p_action='suspend' THEN 'suspended' ELSE 'updated' END,
    'Location',p_location_id::text,1,jsonb_build_object('tenantId',v_row.tenant_id,'locationId',p_location_id,'slug',v_row.slug,'status',v_row.status,'action',p_action,'reasonCode',p_reason_code),v_correlation);

  v_result := jsonb_build_object('id',v_row.id,'tenantId',v_row.tenant_id,'slug',v_row.slug,'name',v_row.name,'status',v_row.status,'timezone',v_row.timezone,'isPrimary',v_row.is_primary,'createdAt',v_row.created_at,'updatedAt',v_row.updated_at);
  UPDATE platform.location_lifecycle_idempotency SET status='completed', result=v_result, completed_at=now() WHERE idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT p_action,v_row.id,v_row.tenant_id,v_row.slug,v_row.name,v_row.status,v_row.timezone,v_row.is_primary,v_row.created_at,v_row.updated_at,false;
END;
$$;
ALTER FUNCTION security.platform_mutate_location(text,text,uuid,text,text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_mutate_location(text,text,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_mutate_location(text,text,uuid,text,text,text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_transfer_primary_location(
  p_idempotency_key text,
  p_source_location_id uuid,
  p_target_location_id uuid,
  p_reason_code text
)
RETURNS TABLE (
  action_key text,
  location_id uuid,
  tenant_id uuid,
  location_slug text,
  location_name text,
  location_status text,
  location_timezone text,
  location_is_primary boolean,
  location_created_at timestamptz,
  location_updated_at timestamptz,
  previous_primary_location_id uuid,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id', true), '');
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_result jsonb;
  v_primary_count integer;
  v_source platform.locations%ROWTYPE;
  v_target platform.locations%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.locations.transfer_primary' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023'; END IF;
  IF p_source_location_id IS NULL OR p_target_location_id IS NULL OR p_source_location_id=p_target_location_id THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:primary_locations' USING ERRCODE='22023'; END IF;
  IF p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9][a-z0-9._:-]{2,63}$' THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:reason_code' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_source FROM platform.locations WHERE id=p_source_location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_LOCATION_NOT_FOUND:source' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_target FROM platform.locations WHERE id=p_target_location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIRENOS_LOCATION_NOT_FOUND:target' USING ERRCODE='P0002'; END IF;
  IF v_source.tenant_id <> v_target.tenant_id THEN RAISE EXCEPTION 'AIRENOS_LOCATION_SCOPE_MISMATCH' USING ERRCODE='P0001'; END IF;

  v_request_hash := encode(public.digest(jsonb_build_object(
    'action','transfer_primary','sourceLocationId',p_source_location_id,'targetLocationId',p_target_location_id,'reasonCode',p_reason_code
  )::text, 'sha256'), 'hex');

  INSERT INTO platform.location_lifecycle_idempotency(idempotency_key, request_hash, action_key, tenant_id, location_id, actor_identity_id)
  VALUES (p_idempotency_key, v_request_hash, 'transfer_primary', v_source.tenant_id, p_target_location_id, v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT request_hash, status, result INTO v_existing_hash, v_existing_status, v_existing_result
  FROM platform.location_lifecycle_idempotency WHERE idempotency_key=p_idempotency_key FOR UPDATE;
  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF v_existing_status='completed' THEN
    RETURN QUERY SELECT
      'transfer_primary'::text,
      (v_existing_result->>'id')::uuid,
      (v_existing_result->>'tenantId')::uuid,
      v_existing_result->>'slug',
      v_existing_result->>'name',
      v_existing_result->>'status',
      v_existing_result->>'timezone',
      (v_existing_result->>'isPrimary')::boolean,
      (v_existing_result->>'createdAt')::timestamptz,
      (v_existing_result->>'updatedAt')::timestamptz,
      (v_existing_result->>'previousPrimaryLocationId')::uuid,
      true;
    RETURN;
  END IF;

  PERFORM l.id FROM platform.locations l WHERE l.tenant_id=v_source.tenant_id FOR UPDATE;
  SELECT count(*)::int INTO v_primary_count FROM platform.locations l WHERE l.tenant_id=v_source.tenant_id AND l.is_primary=true;
  IF v_primary_count <> 1 OR NOT v_source.is_primary THEN RAISE EXCEPTION 'AIRENOS_PRIMARY_SOURCE_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF v_target.status <> 'active' THEN RAISE EXCEPTION 'AIRENOS_PRIMARY_TARGET_REQUIRES_ACTIVE' USING ERRCODE='P0001'; END IF;

  UPDATE platform.locations SET is_primary=false, updated_at=now() WHERE id=p_source_location_id;
  UPDATE platform.locations SET is_primary=true, updated_at=now() WHERE id=p_target_location_id RETURNING * INTO v_target;

  SELECT count(*)::int INTO v_primary_count FROM platform.locations l WHERE l.tenant_id=v_source.tenant_id AND l.is_primary=true;
  IF v_primary_count <> 1 THEN RAISE EXCEPTION 'AIRENOS_PRIMARY_LOCATION_INVARIANT_FAILED' USING ERRCODE='P0001'; END IF;

  INSERT INTO audit.audit_events(tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES (v_source.tenant_id,p_target_location_id,v_actor,'user','platform.location.transfer_primary','Location',p_target_location_id::text,v_correlation,'success',
    jsonb_build_object('reasonCode',p_reason_code,'previousPrimaryLocationId',p_source_location_id,'primaryLocationId',p_target_location_id));

  INSERT INTO events.outbox_events(tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES (v_source.tenant_id,p_target_location_id,'platform.location.primary_transferred','Location',p_target_location_id::text,1,
    jsonb_build_object('tenantId',v_source.tenant_id,'previousPrimaryLocationId',p_source_location_id,'primaryLocationId',p_target_location_id,'reasonCode',p_reason_code),v_correlation);

  v_result := jsonb_build_object('id',v_target.id,'tenantId',v_target.tenant_id,'slug',v_target.slug,'name',v_target.name,'status',v_target.status,'timezone',v_target.timezone,'isPrimary',v_target.is_primary,'createdAt',v_target.created_at,'updatedAt',v_target.updated_at,'previousPrimaryLocationId',p_source_location_id);
  UPDATE platform.location_lifecycle_idempotency SET status='completed', result=v_result, completed_at=now() WHERE idempotency_key=p_idempotency_key;

  RETURN QUERY SELECT 'transfer_primary'::text,v_target.id,v_target.tenant_id,v_target.slug,v_target.name,v_target.status,v_target.timezone,v_target.is_primary,v_target.created_at,v_target.updated_at,p_source_location_id,false;
END;
$$;
ALTER FUNCTION security.platform_transfer_primary_location(text,uuid,uuid,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_transfer_primary_location(text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_transfer_primary_location(text,uuid,uuid,text) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_get_location(p_location_id uuid)
RETURNS TABLE (
  location_id uuid, tenant_id uuid, location_slug text, location_name text, location_status text, location_timezone text, location_is_primary boolean, location_created_at timestamptz, location_updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.locations.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT l.id,l.tenant_id,l.slug,l.name,l.status,l.timezone,l.is_primary,l.created_at,l.updated_at FROM platform.locations l WHERE l.id=p_location_id;
END; $$;
ALTER FUNCTION security.platform_get_location(uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_get_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_get_location(uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.platform_list_locations(p_tenant_id uuid, p_status text DEFAULT NULL, p_after uuid DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS TABLE (
  location_id uuid, tenant_id uuid, location_slug text, location_name text, location_status text, location_timezone text, location_is_primary boolean, location_created_at timestamptz, location_updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM authz.platform_role_assignments pra JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key='platform.locations.read' AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN RAISE EXCEPTION 'AIRENOS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501'; END IF;
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:tenant_id' USING ERRCODE='22023'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active','inactive','suspended','archived') THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:status' USING ERRCODE='22023'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT l.id,l.tenant_id,l.slug,l.name,l.status,l.timezone,l.is_primary,l.created_at,l.updated_at
    FROM platform.locations l
    WHERE l.tenant_id=p_tenant_id AND (p_status IS NULL OR l.status=p_status) AND (p_after IS NULL OR l.id>p_after)
    ORDER BY l.id ASC LIMIT p_limit;
END; $$;
ALTER FUNCTION security.platform_list_locations(uuid,text,uuid,int) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_list_locations(uuid,text,uuid,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_list_locations(uuid,text,uuid,int) TO airen_control_plane;

COMMIT;
