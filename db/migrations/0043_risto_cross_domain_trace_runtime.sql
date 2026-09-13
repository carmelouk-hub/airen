-- RISTO-MAT-035 / GJ2-040 — Cross-domain audit / outbox / trace completeness
-- Read-only TEST_TEMPORARY evidence surface. Reuses existing RLS-scoped canonical
-- runtime, audit and outbox facts. No new mutation authority is introduced.
BEGIN;

CREATE OR REPLACE FUNCTION ristoairen.query_cross_domain_trace(
  p_correlation_id text
)
RETURNS TABLE (
  evidence_kind text,
  evidence_id text,
  tenant_id uuid,
  location_id uuid,
  actor_identity_id uuid,
  command_key text,
  decision text,
  state_transition text,
  emitted_fact text,
  resource_type text,
  resource_id text,
  source_id text,
  correlation_id text,
  occurred_at timestamptz,
  metadata_sanitized jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, ristoairen, audit, events, security
AS $$
DECLARE
  v_correlation_id text := btrim(p_correlation_id);
  v_tenant_id uuid := security.current_tenant_id();
  v_location_id uuid := security.current_location_id();
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'CROSS_DOMAIN_TRACE_TENANT_CONTEXT_REQUIRED';
  END IF;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'CROSS_DOMAIN_TRACE_LOCATION_CONTEXT_REQUIRED';
  END IF;

  IF v_correlation_id IS NULL OR length(v_correlation_id) < 1 OR length(v_correlation_id) > 240 THEN
    RAISE EXCEPTION 'CROSS_DOMAIN_TRACE_CORRELATION_INVALID';
  END IF;

  RETURN QUERY
  SELECT trace.evidence_kind,
         trace.evidence_id,
         trace.tenant_id,
         trace.location_id,
         trace.actor_identity_id,
         trace.command_key,
         trace.decision,
         trace.state_transition,
         trace.emitted_fact,
         trace.resource_type,
         trace.resource_id,
         trace.source_id,
         trace.correlation_id,
         trace.occurred_at,
         trace.metadata_sanitized
    FROM (
      SELECT
        'runtime'::text AS evidence_kind,
        gde.id::text AS evidence_id,
        gde.tenant_id,
        gde.location_id,
        gde.actor_identity_id,
        gde.step::text AS command_key,
        'authorized_and_persisted'::text AS decision,
        gde.step::text AS state_transition,
        gde.event_type::text AS emitted_fact,
        gde.resource_type::text AS resource_type,
        gde.resource_id::text AS resource_id,
        gde.resource_id::text AS source_id,
        gde.correlation_id,
        gde.occurred_at,
        (
          coalesce(gde.payload, '{}'::jsonb)
          - ARRAY['secret','token','password','authorization','api_key','client_secret','access_token','refresh_token']::text[]
        ) AS metadata_sanitized
      FROM ristoairen.golden_dinner_runtime_events gde
      WHERE gde.tenant_id = v_tenant_id
        AND gde.location_id = v_location_id
        AND gde.correlation_id = v_correlation_id

      UNION ALL

      SELECT
        'audit'::text AS evidence_kind,
        ae.id::text AS evidence_id,
        ae.tenant_id,
        ae.location_id,
        ae.actor_identity_id,
        ae.action_key::text AS command_key,
        ae.outcome::text AS decision,
        NULLIF(ae.metadata->>'state_transition','') AS state_transition,
        NULLIF(coalesce(ae.metadata->>'emitted_fact', ae.metadata->>'event_type'),'') AS emitted_fact,
        ae.resource_type::text AS resource_type,
        ae.resource_id::text AS resource_id,
        coalesce(NULLIF(ae.resource_id,''),ae.id::text) AS source_id,
        ae.correlation_id,
        ae.created_at AS occurred_at,
        (
          coalesce(ae.metadata, '{}'::jsonb)
          - ARRAY['secret','token','password','authorization','api_key','client_secret','access_token','refresh_token']::text[]
        ) AS metadata_sanitized
      FROM audit.audit_events ae
      WHERE ae.tenant_id = v_tenant_id
        AND ae.location_id = v_location_id
        AND ae.correlation_id = v_correlation_id

      UNION ALL

      SELECT
        'outbox'::text AS evidence_kind,
        oe.id::text AS evidence_id,
        oe.tenant_id,
        oe.location_id,
        NULL::uuid AS actor_identity_id,
        NULL::text AS command_key,
        CASE oe.delivery_status
          WHEN 'delivered' THEN 'emitted_and_delivered'
          WHEN 'dead_letter' THEN 'delivery_terminal_failure'
          WHEN 'failed' THEN 'delivery_retryable_failure'
          WHEN 'processing' THEN 'delivery_in_progress'
          ELSE 'emitted_pending_delivery'
        END::text AS decision,
        oe.delivery_status::text AS state_transition,
        oe.event_type::text AS emitted_fact,
        oe.aggregate_type::text AS resource_type,
        oe.aggregate_id::text AS resource_id,
        oe.aggregate_id::text AS source_id,
        oe.correlation_id,
        oe.created_at AS occurred_at,
        (
          (
            coalesce(oe.payload, '{}'::jsonb)
            - ARRAY['secret','token','password','authorization','api_key','client_secret','access_token','refresh_token']::text[]
          ) || jsonb_build_object(
            'delivery_status', oe.delivery_status,
            'attempt_count', oe.attempt_count,
            'delivered_at', oe.delivered_at
          )
        ) AS metadata_sanitized
      FROM events.outbox_events oe
      WHERE oe.tenant_id = v_tenant_id
        AND oe.location_id = v_location_id
        AND oe.correlation_id = v_correlation_id
    ) trace
   ORDER BY trace.occurred_at, trace.evidence_kind, trace.evidence_id;
END;
$$;

REVOKE ALL ON FUNCTION ristoairen.query_cross_domain_trace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ristoairen.query_cross_domain_trace(text) TO airen_app;

COMMENT ON FUNCTION ristoairen.query_cross_domain_trace(text) IS
  'RISTO-MAT-035/GJ2-040 read-only tenant/location-scoped trace reconstruction across Golden Dinner runtime, audit and outbox evidence. Sensitive metadata keys are redacted from the returned evidence surface.';

COMMIT;
