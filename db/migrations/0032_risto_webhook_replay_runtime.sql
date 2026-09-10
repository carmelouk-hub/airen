-- RISTO-MAT-018 — Provider-Neutral Webhook Replay Runtime Foundation
-- Durable provider-event receipt/dedupe ledger. Provider payload scope is never AIRenOS Tenant/Location authority.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airen_webhook_worker') THEN
    CREATE ROLE airen_webhook_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE events.provider_webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  provider_event_id text NOT NULL CHECK (length(btrim(provider_event_id)) BETWEEN 1 AND 240),
  event_type text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 240),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  processing_status text NOT NULL CHECK (processing_status IN ('processing','processed','failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  first_received_at timestamptz NOT NULL,
  last_attempt_at timestamptz NOT NULL,
  processed_at timestamptz,
  last_error text CHECK (last_error IS NULL OR last_error = 'WEBHOOK_PROCESSING_FAILED'),
  CONSTRAINT uq_provider_webhook_event UNIQUE (provider_key, provider_event_id),
  CONSTRAINT ck_provider_webhook_terminal_time CHECK (
    (processing_status = 'processed' AND processed_at IS NOT NULL AND last_error IS NULL)
    OR (processing_status = 'failed' AND processed_at IS NULL AND last_error = 'WEBHOOK_PROCESSING_FAILED')
    OR (processing_status = 'processing' AND processed_at IS NULL AND last_error IS NULL)
  )
);

CREATE INDEX idx_provider_webhook_receipts_status
  ON events.provider_webhook_receipts(processing_status, first_received_at, id);

ALTER TABLE events.provider_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE events.provider_webhook_receipts FORCE ROW LEVEL SECURITY;

-- No table policy is granted to runtime roles. All durable mutation is through the narrow SECURITY DEFINER API below.
REVOKE ALL ON TABLE events.provider_webhook_receipts FROM PUBLIC;
REVOKE ALL ON TABLE events.provider_webhook_receipts FROM airen_app;
REVOKE ALL ON TABLE events.provider_webhook_receipts FROM airen_webhook_worker;

CREATE OR REPLACE FUNCTION events.reserve_provider_webhook_receipt(
  p_provider_key text,
  p_provider_event_id text,
  p_event_type text,
  p_payload_digest text,
  p_received_at timestamptz
)
RETURNS TABLE (receipt_id uuid, reservation_status text, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, events
AS $$
DECLARE
  v_id uuid;
  v_digest text;
  v_status text;
  v_attempt_count integer;
BEGIN
  INSERT INTO events.provider_webhook_receipts (
    provider_key, provider_event_id, event_type, payload_digest,
    processing_status, attempt_count, first_received_at, last_attempt_at
  ) VALUES (
    p_provider_key, p_provider_event_id, p_event_type, p_payload_digest,
    'processing', 1, p_received_at, p_received_at
  )
  ON CONFLICT (provider_key, provider_event_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'new'::text, 1;
    RETURN;
  END IF;

  SELECT r.id, r.payload_digest, r.processing_status, r.attempt_count
    INTO v_id, v_digest, v_status, v_attempt_count
    FROM events.provider_webhook_receipts r
   WHERE r.provider_key = p_provider_key
     AND r.provider_event_id = p_provider_event_id;

  IF v_digest IS DISTINCT FROM p_payload_digest THEN
    RETURN QUERY SELECT v_id, 'conflict'::text, v_attempt_count;
  ELSIF v_status = 'processed' THEN
    RETURN QUERY SELECT v_id, 'duplicate_processed'::text, v_attempt_count;
  ELSIF v_status = 'failed' THEN
    RETURN QUERY SELECT v_id, 'duplicate_failed'::text, v_attempt_count;
  ELSE
    RETURN QUERY SELECT v_id, 'duplicate_in_flight'::text, v_attempt_count;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION events.mark_provider_webhook_processed(
  p_receipt_id uuid,
  p_processed_at timestamptz
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, events
AS $$
  WITH changed AS (
    UPDATE events.provider_webhook_receipts
       SET processing_status = 'processed',
           processed_at = p_processed_at,
           last_error = NULL
     WHERE id = p_receipt_id
       AND processing_status = 'processing'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION events.mark_provider_webhook_failed(p_receipt_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, events
AS $$
  WITH changed AS (
    UPDATE events.provider_webhook_receipts
       SET processing_status = 'failed',
           processed_at = NULL,
           last_error = 'WEBHOOK_PROCESSING_FAILED'
     WHERE id = p_receipt_id
       AND processing_status = 'processing'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION events.claim_provider_webhook_reconcile(
  p_provider_key text,
  p_provider_event_id text,
  p_payload_digest text,
  p_attempted_at timestamptz
)
RETURNS TABLE (receipt_id uuid, claim_status text, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, events
AS $$
DECLARE
  v_id uuid;
  v_digest text;
  v_status text;
  v_attempt_count integer;
BEGIN
  UPDATE events.provider_webhook_receipts r
     SET processing_status = 'processing',
         attempt_count = r.attempt_count + 1,
         last_attempt_at = p_attempted_at,
         last_error = NULL
   WHERE r.provider_key = p_provider_key
     AND r.provider_event_id = p_provider_event_id
     AND r.payload_digest = p_payload_digest
     AND r.processing_status = 'failed'
  RETURNING r.id, r.attempt_count INTO v_id, v_attempt_count;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'reconcile_claimed'::text, v_attempt_count;
    RETURN;
  END IF;

  SELECT r.id, r.payload_digest, r.processing_status, r.attempt_count
    INTO v_id, v_digest, v_status, v_attempt_count
    FROM events.provider_webhook_receipts r
   WHERE r.provider_key = p_provider_key
     AND r.provider_event_id = p_provider_event_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'missing'::text, 0;
  ELSIF v_digest IS DISTINCT FROM p_payload_digest THEN
    RETURN QUERY SELECT v_id, 'conflict'::text, v_attempt_count;
  ELSIF v_status = 'processed' THEN
    RETURN QUERY SELECT v_id, 'duplicate_processed'::text, v_attempt_count;
  ELSIF v_status = 'processing' THEN
    RETURN QUERY SELECT v_id, 'duplicate_in_flight'::text, v_attempt_count;
  ELSE
    RETURN QUERY SELECT v_id, 'failed_unclaimed'::text, v_attempt_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION events.reserve_provider_webhook_receipt(text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION events.mark_provider_webhook_processed(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION events.mark_provider_webhook_failed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION events.claim_provider_webhook_reconcile(text,text,text,timestamptz) FROM PUBLIC;

GRANT USAGE ON SCHEMA events TO airen_webhook_worker;
GRANT EXECUTE ON FUNCTION events.reserve_provider_webhook_receipt(text,text,text,text,timestamptz) TO airen_webhook_worker;
GRANT EXECUTE ON FUNCTION events.mark_provider_webhook_processed(uuid,timestamptz) TO airen_webhook_worker;
GRANT EXECUTE ON FUNCTION events.mark_provider_webhook_failed(uuid) TO airen_webhook_worker;
GRANT EXECUTE ON FUNCTION events.claim_provider_webhook_reconcile(text,text,text,timestamptz) TO airen_webhook_worker;

COMMIT;
