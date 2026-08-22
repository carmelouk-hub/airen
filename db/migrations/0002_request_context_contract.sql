-- B44-FX-008 / 0002 Request Context Contract
-- Provider-neutral contract for PostgreSQL transaction-local request context.
-- The application adapter must SET LOCAL these values only after trusted auth + Tenant/Location resolution.
-- RLS policies will consume this contract in the next security migration after PostgreSQL runtime verification.

BEGIN;
CREATE SCHEMA IF NOT EXISTS security;
CREATE OR REPLACE FUNCTION security.current_identity_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('airen.identity_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION security.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('airen.tenant_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION security.current_location_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('airen.location_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION security.current_correlation_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('airen.correlation_id', true), '') $$;
COMMENT ON FUNCTION security.current_identity_id() IS 'Reads transaction-local AIRenOS identity context. Never set from untrusted request payload.';
COMMENT ON FUNCTION security.current_tenant_id() IS 'Reads transaction-local AIRenOS Tenant resolved server-side from trusted routing/membership.';
COMMENT ON FUNCTION security.current_location_id() IS 'Reads transaction-local AIRenOS Location resolved server-side.';
COMMENT ON FUNCTION security.current_correlation_id() IS 'Reads request correlation id for audit/outbox continuity.';
COMMIT;
