-- AOS-03 / ProductSubscription binding + effective ProductAccess runtime
-- Additive post-AOS-02 migration. R3-E commercial Subscription and R3-F Entitlement remain independent authorities.
BEGIN;

CREATE TABLE platform.product_subscription_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  product_code text NOT NULL,
  entitlement_key text NOT NULL REFERENCES billing.entitlement_catalog(entitlement_key),
  subscription_id uuid NOT NULL REFERENCES billing.subscriptions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_product_subscription_org_tenant FOREIGN KEY (organization_id, tenant_id)
    REFERENCES platform.organization_tenants(organization_id, tenant_id),
  CONSTRAINT ck_product_subscription_code CHECK (product_code = lower(product_code) AND product_code ~ '^[a-z][a-z0-9._-]{2,63}$'),
  CONSTRAINT ck_product_subscription_entitlement CHECK (entitlement_key = lower(entitlement_key) AND entitlement_key ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  CONSTRAINT uq_product_subscription_binding UNIQUE (subscription_id, product_code)
);
CREATE INDEX idx_product_subscription_tenant_product ON platform.product_subscription_bindings(tenant_id, product_code, created_at DESC);
CREATE INDEX idx_product_subscription_organization ON platform.product_subscription_bindings(organization_id, created_at DESC);

CREATE TABLE platform.product_subscription_binding_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  binding_id uuid REFERENCES platform.product_subscription_bindings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_product_subscription_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_product_subscription_idempotency_completed CHECK (
    status <> 'completed' OR (binding_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);

ALTER TABLE platform.product_subscription_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.product_subscription_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.product_subscription_binding_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.product_subscription_binding_idempotency FORCE ROW LEVEL SECURITY;

REVOKE ALL ON platform.product_subscription_bindings, platform.product_subscription_binding_idempotency FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON platform.product_subscription_bindings, platform.product_subscription_binding_idempotency FROM airen_app, airen_control_plane;

INSERT INTO authz.permission_registry(permission_key, description, sensitivity) VALUES
  ('platform.product_access.bind_subscription', 'Bind an AIRenOS Product to an Organization/Tenant commercial Subscription', 'critical')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO authz.role_permission_grants(scope_kind, role_key, permission_key, effect)
VALUES ('platform','platform_admin','platform.product_access.bind_subscription','allow')
ON CONFLICT (scope_kind, role_key, permission_key) DO UPDATE SET effect='allow';

GRANT USAGE ON SCHEMA platform, billing, authz, identity, audit, events, security TO airen_control_plane_owner;
GRANT SELECT, INSERT ON platform.product_subscription_bindings TO airen_control_plane_owner;
GRANT SELECT, INSERT, UPDATE ON platform.product_subscription_binding_idempotency TO airen_control_plane_owner;
GRANT SELECT ON platform.organizations, platform.organization_tenants, platform.tenants, platform.locations TO airen_control_plane_owner;
GRANT SELECT ON billing.subscriptions, billing.entitlement_catalog TO airen_control_plane_owner;
GRANT SELECT ON authz.platform_role_assignments, authz.role_permission_grants, authz.organization_memberships, authz.tenant_memberships, authz.location_memberships TO airen_control_plane_owner;
GRANT INSERT ON audit.audit_events, events.outbox_events TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.aos03_assert_platform_permission(p_permission text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id', true), '');
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='platform'
     AND rpg.role_key=pra.role_key
     AND rpg.permission_key=p_permission
     AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PRODUCT_ACCESS_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501';
  END IF;
END;
$$;
ALTER FUNCTION security.aos03_assert_platform_permission(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.aos03_assert_platform_permission(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION security.platform_bind_product_subscription(
  p_idempotency_key text,
  p_organization_id uuid,
  p_tenant_id uuid,
  p_product_code text,
  p_entitlement_key text,
  p_subscription_id uuid
)
RETURNS TABLE (
  binding_id uuid,
  organization_id uuid,
  tenant_id uuid,
  product_code text,
  entitlement_key text,
  subscription_id uuid,
  subscription_status text,
  starts_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_effective_at timestamptz,
  binding_created_at timestamptz,
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
  v_binding_id uuid;
  v_existing_organization uuid;
  v_existing_tenant uuid;
  v_existing_entitlement text;
BEGIN
  PERFORM security.aos03_assert_platform_permission('platform.product_access.bind_subscription');

  IF p_idempotency_key IS NULL OR p_idempotency_key <> btrim(p_idempotency_key) OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:idempotency_key' USING ERRCODE='22023';
  END IF;
  IF p_product_code IS NULL OR p_product_code <> lower(p_product_code) OR p_product_code !~ '^[a-z][a-z0-9._-]{2,63}$' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:product_code' USING ERRCODE='22023';
  END IF;
  IF p_entitlement_key IS NULL OR p_entitlement_key <> lower(p_entitlement_key) OR p_entitlement_key !~ '^[a-z][a-z0-9._:-]{2,127}$' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:entitlement_key' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organization_tenants ot
    JOIN platform.organizations o ON o.id=ot.organization_id AND o.status='active'
    JOIN platform.tenants t ON t.id=ot.tenant_id AND t.status='active'
    WHERE ot.organization_id=p_organization_id AND ot.tenant_id=p_tenant_id
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PRODUCT_SUBSCRIPTION_ORGANIZATION_TENANT_REQUIRED' USING ERRCODE='P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM billing.subscriptions s
    WHERE s.id=p_subscription_id
      AND s.tenant_id=p_tenant_id
      AND s.status IN ('scheduled','trialing','active','suspended','cancel_pending')
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PRODUCT_SUBSCRIPTION_CURRENT_SUBSCRIPTION_REQUIRED' USING ERRCODE='P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM billing.entitlement_catalog c
    WHERE c.entitlement_key=p_entitlement_key AND c.status='active'
  ) THEN
    RAISE EXCEPTION 'AIRENOS_PRODUCT_SUBSCRIPTION_ENTITLEMENT_REQUIRED' USING ERRCODE='P0002';
  END IF;

  v_request_hash := encode(public.digest(concat_ws(chr(31), p_organization_id::text, p_tenant_id::text, p_product_code, p_entitlement_key, p_subscription_id::text), 'sha256'), 'hex');
  INSERT INTO platform.product_subscription_binding_idempotency(idempotency_key, request_hash, actor_identity_id)
  VALUES (p_idempotency_key, v_request_hash, v_actor)
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT i.request_hash, i.status, i.binding_id
    INTO v_existing_hash, v_existing_status, v_binding_id
  FROM platform.product_subscription_binding_idempotency i
  WHERE i.idempotency_key=p_idempotency_key
  FOR UPDATE;

  IF v_existing_hash IS DISTINCT FROM v_request_hash THEN
    RAISE EXCEPTION 'AIRENOS_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001';
  END IF;

  IF v_existing_status='completed' THEN
    RETURN QUERY
    SELECT b.id,b.organization_id,b.tenant_id,b.product_code,b.entitlement_key,b.subscription_id,s.status,s.starts_at,s.trial_ends_at,s.current_period_start,s.current_period_end,s.cancel_effective_at,b.created_at,true
    FROM platform.product_subscription_bindings b
    JOIN billing.subscriptions s ON s.id=b.subscription_id
    WHERE b.id=v_binding_id;
    RETURN;
  END IF;

  SELECT b.id,b.organization_id,b.tenant_id,b.entitlement_key
    INTO v_binding_id,v_existing_organization,v_existing_tenant,v_existing_entitlement
  FROM platform.product_subscription_bindings b
  WHERE b.subscription_id=p_subscription_id AND b.product_code=p_product_code;

  IF v_binding_id IS NOT NULL THEN
    IF v_existing_organization IS DISTINCT FROM p_organization_id
       OR v_existing_tenant IS DISTINCT FROM p_tenant_id
       OR v_existing_entitlement IS DISTINCT FROM p_entitlement_key THEN
      RAISE EXCEPTION 'AIRENOS_PRODUCT_SUBSCRIPTION_BINDING_CONFLICT' USING ERRCODE='P0001';
    END IF;
    UPDATE platform.product_subscription_binding_idempotency
       SET status='completed', binding_id=v_binding_id, completed_at=now()
     WHERE idempotency_key=p_idempotency_key;
    RETURN QUERY
    SELECT b.id,b.organization_id,b.tenant_id,b.product_code,b.entitlement_key,b.subscription_id,s.status,s.starts_at,s.trial_ends_at,s.current_period_start,s.current_period_end,s.cancel_effective_at,b.created_at,true
    FROM platform.product_subscription_bindings b
    JOIN billing.subscriptions s ON s.id=b.subscription_id
    WHERE b.id=v_binding_id;
    RETURN;
  END IF;

  INSERT INTO platform.product_subscription_bindings(organization_id,tenant_id,product_code,entitlement_key,subscription_id)
  VALUES (p_organization_id,p_tenant_id,p_product_code,p_entitlement_key,p_subscription_id)
  RETURNING id INTO v_binding_id;

  INSERT INTO audit.audit_events(tenant_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
  VALUES (p_tenant_id,v_actor,'user','platform.product_subscription.bind','ProductSubscription',v_binding_id::text,v_correlation,'success',
    jsonb_build_object('organizationId',p_organization_id,'productCode',p_product_code,'entitlementKey',p_entitlement_key,'subscriptionId',p_subscription_id,'idempotencyKey',p_idempotency_key));

  INSERT INTO events.outbox_events(tenant_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id)
  VALUES (p_tenant_id,'platform.product_subscription.bound','ProductSubscription',v_binding_id::text,1,
    jsonb_build_object('bindingId',v_binding_id,'organizationId',p_organization_id,'tenantId',p_tenant_id,'productCode',p_product_code,'entitlementKey',p_entitlement_key,'subscriptionId',p_subscription_id),v_correlation);

  UPDATE platform.product_subscription_binding_idempotency
     SET status='completed', binding_id=v_binding_id, completed_at=now()
   WHERE idempotency_key=p_idempotency_key;

  RETURN QUERY
  SELECT b.id,b.organization_id,b.tenant_id,b.product_code,b.entitlement_key,b.subscription_id,s.status,s.starts_at,s.trial_ends_at,s.current_period_start,s.current_period_end,s.cancel_effective_at,b.created_at,false
  FROM platform.product_subscription_bindings b
  JOIN billing.subscriptions s ON s.id=b.subscription_id
  WHERE b.id=v_binding_id;
END;
$$;
ALTER FUNCTION security.platform_bind_product_subscription(text,uuid,uuid,text,text,uuid) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.platform_bind_product_subscription(text,uuid,uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.platform_bind_product_subscription(text,uuid,uuid,text,text,uuid) TO airen_control_plane;

CREATE OR REPLACE FUNCTION security.resolve_current_product_subscription(p_product_code text)
RETURNS TABLE (
  binding_id uuid,
  organization_id uuid,
  tenant_id uuid,
  product_code text,
  entitlement_key text,
  subscription_id uuid,
  subscription_status text,
  starts_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_effective_at timestamptz,
  binding_created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_identity uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
  v_tenant uuid := NULLIF(current_setting('airen.tenant_id', true), '')::uuid;
  v_location uuid := NULLIF(current_setting('airen.location_id', true), '')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id', true), '');
BEGIN
  IF v_identity IS NULL OR v_tenant IS NULL OR v_location IS NULL OR v_correlation IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_TRUSTED_PRODUCT_ACCESS_CONTEXT_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_product_code IS NULL OR p_product_code <> lower(p_product_code) OR p_product_code !~ '^[a-z][a-z0-9._-]{2,63}$' THEN
    RAISE EXCEPTION 'AIRENOS_VALIDATION_FAILED:product_code' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT b.id,b.organization_id,b.tenant_id,b.product_code,b.entitlement_key,b.subscription_id,s.status,s.starts_at,s.trial_ends_at,s.current_period_start,s.current_period_end,s.cancel_effective_at,b.created_at
  FROM platform.product_subscription_bindings b
  JOIN platform.organization_tenants ot ON ot.organization_id=b.organization_id AND ot.tenant_id=b.tenant_id
  JOIN platform.organizations o ON o.id=ot.organization_id AND o.status='active'
  JOIN platform.tenants t ON t.id=ot.tenant_id AND t.status='active'
  JOIN platform.locations l ON l.id=v_location AND l.tenant_id=t.id AND l.status='active'
  JOIN billing.subscriptions s ON s.id=b.subscription_id AND s.tenant_id=b.tenant_id
  JOIN authz.organization_memberships om ON om.organization_id=o.id AND om.identity_id=v_identity AND om.status='active'
  JOIN authz.tenant_memberships tm ON tm.tenant_id=t.id AND tm.identity_id=v_identity AND tm.status='active'
  WHERE b.tenant_id=v_tenant
    AND b.product_code=p_product_code
    AND (
      EXISTS (
        SELECT 1 FROM authz.location_memberships lm
        WHERE lm.tenant_membership_id=tm.id AND lm.tenant_id=t.id AND lm.location_id=v_location AND lm.status='active'
      )
      OR EXISTS (
        SELECT 1 FROM authz.role_permission_grants rpg
        WHERE rpg.scope_kind='tenant' AND rpg.role_key=tm.role_key AND rpg.permission_key='tenant.location.all' AND rpg.effect='allow'
      )
    )
  ORDER BY (s.status IN ('scheduled','trialing','active','suspended','cancel_pending')) DESC, s.created_at DESC
  LIMIT 1;
END;
$$;
ALTER FUNCTION security.resolve_current_product_subscription(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.resolve_current_product_subscription(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_app;
GRANT EXECUTE ON FUNCTION security.resolve_current_product_subscription(text) TO airen_app;

COMMIT;
