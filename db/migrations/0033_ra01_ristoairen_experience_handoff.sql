BEGIN;

-- RA-01 Foundation-owned Experience handoff. The browser-visible launch code is
-- never persisted in plaintext: only its SHA-256 digest is stored. The code is
-- single-use, expires quickly, and can produce only a read-only Experience
-- projection. It cannot authorize business mutations or production enablement.
CREATE TABLE platform.ristoairen_experience_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash char(64) NOT NULL UNIQUE,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  organization_id uuid NOT NULL REFERENCES platform.organizations(id),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL REFERENCES platform.locations(id),
  subscription_id uuid NOT NULL REFERENCES billing.subscriptions(id),
  product_code text NOT NULL DEFAULT 'ristoairen' CHECK (product_code='ristoairen'),
  entitlement_key text NOT NULL DEFAULT 'vertical.ristoairen' CHECK (entitlement_key='vertical.ristoairen'),
  permission_key text NOT NULL DEFAULT 'ristoairen.access' CHECK (permission_key='ristoairen.access'),
  source_correlation_id text NOT NULL,
  exchange_correlation_id text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT ck_ra01_handoff_hash CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_ra01_handoff_source_correlation CHECK (source_correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  CONSTRAINT ck_ra01_handoff_exchange_correlation CHECK (exchange_correlation_id IS NULL OR exchange_correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  CONSTRAINT ck_ra01_handoff_expiry CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '90 seconds'),
  CONSTRAINT ck_ra01_handoff_consumption CHECK ((consumed_at IS NULL AND exchange_correlation_id IS NULL) OR (consumed_at IS NOT NULL AND exchange_correlation_id IS NOT NULL AND consumed_at >= issued_at))
);
CREATE INDEX idx_ra01_handoff_expiry ON platform.ristoairen_experience_handoffs(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX idx_ra01_handoff_tenant ON platform.ristoairen_experience_handoffs(tenant_id, issued_at DESC);

ALTER TABLE platform.ristoairen_experience_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ristoairen_experience_handoffs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.ristoairen_experience_handoffs FROM PUBLIC, airen_app, airen_control_plane;
GRANT SELECT, INSERT, UPDATE ON platform.ristoairen_experience_handoffs TO airen_control_plane_owner;
CREATE POLICY ra01_handoff_owner_policy ON platform.ristoairen_experience_handoffs
  FOR ALL TO airen_control_plane_owner USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION security.issue_ristoairen_experience_handoff(
  p_code_hash text,
  p_organization_id uuid,
  p_subscription_id uuid,
  p_expires_at timestamptz
)
RETURNS TABLE (
  handoff_id uuid,
  issued_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_identity uuid := NULLIF(current_setting('airen.identity_id', true), '')::uuid;
  v_tenant uuid := NULLIF(current_setting('airen.tenant_id', true), '')::uuid;
  v_location uuid := NULLIF(current_setting('airen.location_id', true), '')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id', true), '');
  v_handoff_id uuid;
  v_issued_at timestamptz;
BEGIN
  IF v_identity IS NULL OR v_tenant IS NULL OR v_location IS NULL OR v_correlation IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_TRUSTED_CONTEXT_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_INVALID_HASH' USING ERRCODE='22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '90 seconds' THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_INVALID_EXPIRY' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM authz.tenant_memberships tm
    JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='tenant'
     AND rpg.role_key=tm.role_key
     AND rpg.permission_key='ristoairen.access'
     AND rpg.effect='allow'
    JOIN platform.tenants t ON t.id=tm.tenant_id AND t.status='active'
    JOIN platform.locations l ON l.id=v_location AND l.tenant_id=t.id AND l.status='active'
    WHERE tm.tenant_id=v_tenant AND tm.identity_id=v_identity AND tm.status='active'
      AND (
        EXISTS (
          SELECT 1 FROM authz.location_memberships lm
          WHERE lm.tenant_membership_id=tm.id AND lm.tenant_id=v_tenant AND lm.location_id=v_location AND lm.status='active'
        )
        OR EXISTS (
          SELECT 1 FROM authz.role_permission_grants all_locations
          WHERE all_locations.scope_kind='tenant' AND all_locations.role_key=tm.role_key
            AND all_locations.permission_key='tenant.location.all' AND all_locations.effect='allow'
        )
      )
  ) THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_PERMISSION_REQUIRED' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organization_tenants ot
    JOIN platform.organizations o ON o.id=ot.organization_id AND o.status='active'
    JOIN authz.organization_memberships om ON om.organization_id=o.id AND om.identity_id=v_identity AND om.status='active'
    WHERE ot.organization_id=p_organization_id AND ot.tenant_id=v_tenant
  ) THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_ORGANIZATION_REQUIRED' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM billing.tenant_entitlements e
    JOIN billing.entitlement_catalog c ON c.entitlement_key=e.entitlement_key AND c.status='active'
    WHERE e.tenant_id=v_tenant AND e.entitlement_key='vertical.ristoairen' AND e.enabled=true
      AND COALESCE(e.valid_from,'-infinity'::timestamptz) <= now()
      AND (e.valid_until IS NULL OR e.valid_until > now())
      AND e.revoked_at IS NULL AND e.expired_at IS NULL
  ) THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_ENTITLEMENT_REQUIRED' USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.product_subscription_bindings b
    JOIN billing.subscriptions s ON s.id=b.subscription_id AND s.tenant_id=b.tenant_id
    WHERE b.organization_id=p_organization_id
      AND b.tenant_id=v_tenant
      AND b.product_code='ristoairen'
      AND b.entitlement_key='vertical.ristoairen'
      AND b.subscription_id=p_subscription_id
      AND s.status IN ('trialing','active','cancel_pending')
  ) THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_PRODUCT_ACCESS_REQUIRED' USING ERRCODE='42501';
  END IF;

  INSERT INTO platform.ristoairen_experience_handoffs AS h(
    code_hash,actor_identity_id,organization_id,tenant_id,location_id,subscription_id,source_correlation_id,expires_at
  ) VALUES (
    p_code_hash,v_identity,p_organization_id,v_tenant,v_location,p_subscription_id,v_correlation,p_expires_at
  )
  RETURNING h.id, h.issued_at INTO v_handoff_id, v_issued_at;

  INSERT INTO audit.audit_events(
    tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata
  ) VALUES (
    v_tenant,v_location,v_identity,'user','platform.ristoairen.experience_handoff.issue','RistoairenExperienceHandoff',v_handoff_id::text,v_correlation,'success',
    jsonb_build_object('organizationId',p_organization_id,'subscriptionId',p_subscription_id,'expiresAt',p_expires_at,'transport','one_time_launch_code')
  );

  INSERT INTO events.outbox_events(
    tenant_id,location_id,event_type,aggregate_type,aggregate_id,payload_version,payload,correlation_id
  ) VALUES (
    v_tenant,v_location,'platform.ristoairen.experience_handoff.issued','RistoairenExperienceHandoff',v_handoff_id::text,1,
    jsonb_build_object('handoffId',v_handoff_id,'organizationId',p_organization_id,'tenantId',v_tenant,'locationId',v_location,'subscriptionId',p_subscription_id,'expiresAt',p_expires_at),v_correlation
  );

  RETURN QUERY SELECT v_handoff_id, v_issued_at, p_expires_at;
END;
$$;
ALTER FUNCTION security.issue_ristoairen_experience_handoff(text,uuid,uuid,timestamptz) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.issue_ristoairen_experience_handoff(text,uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security.issue_ristoairen_experience_handoff(text,uuid,uuid,timestamptz) TO airen_app;

CREATE OR REPLACE FUNCTION security.consume_ristoairen_experience_handoff(
  p_code_hash text,
  p_exchange_correlation text
)
RETURNS TABLE (
  handoff_id uuid,
  actor_identity_id uuid,
  organization_id uuid,
  tenant_id uuid,
  location_id uuid,
  subscription_id uuid,
  product_code text,
  entitlement_key text,
  permission_key text,
  issued_at timestamptz,
  consumed_at timestamptz,
  projection_expires_at timestamptz,
  source_correlation_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_row platform.ristoairen_experience_handoffs%ROWTYPE;
BEGIN
  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_INVALID' USING ERRCODE='P0002';
  END IF;
  IF p_exchange_correlation IS NULL OR p_exchange_correlation !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_INVALID_CORRELATION' USING ERRCODE='22023';
  END IF;

  -- Consumption re-checks current authority. A code issued seconds earlier stops
  -- working immediately if membership, permission, entitlement, organization or
  -- service-granting ProductSubscription authority has been withdrawn.
  UPDATE platform.ristoairen_experience_handoffs h
     SET consumed_at=now(), exchange_correlation_id=p_exchange_correlation
   WHERE h.code_hash=p_code_hash
     AND h.consumed_at IS NULL
     AND h.expires_at > now()
     AND EXISTS (
       SELECT 1
       FROM authz.tenant_memberships tm
       JOIN authz.role_permission_grants rpg
         ON rpg.scope_kind='tenant' AND rpg.role_key=tm.role_key
        AND rpg.permission_key='ristoairen.access' AND rpg.effect='allow'
       WHERE tm.tenant_id=h.tenant_id AND tm.identity_id=h.actor_identity_id AND tm.status='active'
         AND (
           EXISTS (
             SELECT 1 FROM authz.location_memberships lm
             WHERE lm.tenant_membership_id=tm.id AND lm.tenant_id=h.tenant_id AND lm.location_id=h.location_id AND lm.status='active'
           )
           OR EXISTS (
             SELECT 1 FROM authz.role_permission_grants all_locations
             WHERE all_locations.scope_kind='tenant' AND all_locations.role_key=tm.role_key
               AND all_locations.permission_key='tenant.location.all' AND all_locations.effect='allow'
           )
         )
     )
     AND EXISTS (
       SELECT 1
       FROM platform.organization_tenants ot
       JOIN platform.organizations o ON o.id=ot.organization_id AND o.status='active'
       JOIN authz.organization_memberships om ON om.organization_id=o.id AND om.identity_id=h.actor_identity_id AND om.status='active'
       WHERE ot.organization_id=h.organization_id AND ot.tenant_id=h.tenant_id
     )
     AND EXISTS (
       SELECT 1
       FROM billing.tenant_entitlements e
       JOIN billing.entitlement_catalog c ON c.entitlement_key=e.entitlement_key AND c.status='active'
       WHERE e.tenant_id=h.tenant_id AND e.entitlement_key='vertical.ristoairen' AND e.enabled=true
         AND COALESCE(e.valid_from,'-infinity'::timestamptz) <= now()
         AND (e.valid_until IS NULL OR e.valid_until > now())
         AND e.revoked_at IS NULL AND e.expired_at IS NULL
     )
     AND EXISTS (
       SELECT 1
       FROM platform.product_subscription_bindings b
       JOIN billing.subscriptions s ON s.id=b.subscription_id AND s.tenant_id=b.tenant_id
       WHERE b.organization_id=h.organization_id AND b.tenant_id=h.tenant_id
         AND b.product_code='ristoairen' AND b.entitlement_key='vertical.ristoairen'
         AND b.subscription_id=h.subscription_id AND s.status IN ('trialing','active','cancel_pending')
     )
   RETURNING h.* INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_RISTOAIREN_HANDOFF_INVALID' USING ERRCODE='P0002';
  END IF;

  INSERT INTO audit.audit_events(
    tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata
  ) VALUES (
    v_row.tenant_id,v_row.location_id,v_row.actor_identity_id,'user','platform.ristoairen.experience_handoff.consume','RistoairenExperienceHandoff',v_row.id::text,p_exchange_correlation,'success',
    jsonb_build_object('organizationId',v_row.organization_id,'sourceCorrelationId',v_row.source_correlation_id,'projectionAuthoritativeForMutations',false)
  );

  RETURN QUERY SELECT
    v_row.id,v_row.actor_identity_id,v_row.organization_id,v_row.tenant_id,v_row.location_id,v_row.subscription_id,
    v_row.product_code,v_row.entitlement_key,v_row.permission_key,v_row.issued_at,v_row.consumed_at,
    v_row.consumed_at + interval '60 seconds',v_row.source_correlation_id;
END;
$$;
ALTER FUNCTION security.consume_ristoairen_experience_handoff(text,text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.consume_ristoairen_experience_handoff(text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA security TO airen_app;
GRANT EXECUTE ON FUNCTION security.consume_ristoairen_experience_handoff(text,text) TO airen_app;

COMMIT;
