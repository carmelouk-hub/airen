-- RISTO-MAT-016 — PostgreSQL Outbox Worker Runtime Boundary
-- Least-privilege durable delivery transitions for the AIRenOS events.outbox_events table.
-- The worker role has no direct table CRUD. Provider-specific behavior is intentionally absent.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airen_outbox_worker') THEN
    CREATE ROLE airen_outbox_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION events.claim_next_outbox_event()
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  location_id uuid,
  event_type text,
  aggregate_type text,
  aggregate_id text,
  payload_version integer,
  payload jsonb,
  correlation_id text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, events
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT oe.id
      FROM events.outbox_events oe
     WHERE oe.delivery_status IN ('pending', 'failed')
     ORDER BY oe.created_at, oe.id
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  ), claimed AS (
    UPDATE events.outbox_events oe
       SET delivery_status = 'processing',
           attempt_count = oe.attempt_count + 1,
           last_error = NULL
      FROM candidate c
     WHERE oe.id = c.id
       AND oe.delivery_status IN ('pending', 'failed')
    RETURNING oe.id, oe.tenant_id, oe.location_id, oe.event_type,
              oe.aggregate_type, oe.aggregate_id, oe.payload_version,
              oe.payload, oe.correlation_id, oe.attempt_count
  )
  SELECT c.id, c.tenant_id, c.location_id, c.event_type,
         c.aggregate_type, c.aggregate_id, c.payload_version,
         c.payload, c.correlation_id, c.attempt_count
    FROM claimed c;
END;
$$;

CREATE OR REPLACE FUNCTION events.mark_outbox_event_delivered(
  p_event_id uuid,
  p_delivered_at timestamptz
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, events
AS $$
  WITH changed AS (
    UPDATE events.outbox_events
       SET delivery_status = 'delivered',
           delivered_at = p_delivered_at,
           last_error = NULL
     WHERE id = p_event_id
       AND delivery_status = 'processing'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION events.mark_outbox_event_failed(
  p_event_id uuid,
  p_terminal boolean
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, events
AS $$
  WITH changed AS (
    UPDATE events.outbox_events
       SET delivery_status = CASE WHEN p_terminal THEN 'dead_letter' ELSE 'failed' END,
           delivered_at = NULL,
           last_error = 'ADAPTER_DELIVERY_FAILED'
     WHERE id = p_event_id
       AND delivery_status = 'processing'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

REVOKE ALL ON FUNCTION events.claim_next_outbox_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION events.mark_outbox_event_delivered(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION events.mark_outbox_event_failed(uuid, boolean) FROM PUBLIC;

GRANT USAGE ON SCHEMA events TO airen_outbox_worker;
GRANT EXECUTE ON FUNCTION events.claim_next_outbox_event() TO airen_outbox_worker;
GRANT EXECUTE ON FUNCTION events.mark_outbox_event_delivered(uuid, timestamptz) TO airen_outbox_worker;
GRANT EXECUTE ON FUNCTION events.mark_outbox_event_failed(uuid, boolean) TO airen_outbox_worker;

-- Defense in depth: the worker never receives direct durable-table privileges.
REVOKE ALL ON TABLE events.outbox_events FROM airen_outbox_worker;

COMMIT;
