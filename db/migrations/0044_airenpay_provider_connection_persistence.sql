-- AOS-AIRENPAY-CONNECT-SOURCE-042 — provider connection persistence + RLS
-- Provider identifiers and secret references only. No raw credential material.
BEGIN;

CREATE SCHEMA IF NOT EXISTS airenpay;

CREATE TABLE airenpay.provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid,
  provider_type text NOT NULL CHECK (length(btrim(provider_type)) BETWEEN 1 AND 64),
  provider_account_reference text NOT NULL CHECK (length(btrim(provider_account_reference)) BETWEEN 1 AND 240),
  capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  environment_class text NOT NULL CHECK (environment_class IN ('TEST','LIVE')),
  credential_secret_ref text NOT NULL CHECK (length(btrim(credential_secret_ref)) BETWEEN 1 AND 512),
  webhook_secret_ref text CHECK (webhook_secret_ref IS NULL OR length(btrim(webhook_secret_ref)) BETWEEN 1 AND 512),
  webhook_configuration_reference text CHECK (webhook_configuration_reference IS NULL OR length(btrim(webhook_configuration_reference)) BETWEEN 1 AND 512),
  connection_status text NOT NULL CHECK (connection_status IN ('ACTIVE','DISABLED','REVOKED')),
  provider_api_profile text NOT NULL CHECK (length(btrim(provider_api_profile)) BETWEEN 1 AND 128),
  configuration_roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  funds_flow_profile text NOT NULL CHECK (funds_flow_profile IN ('DIRECT_CHARGES','DESTINATION_CHARGES','SEPARATE_CHARGES_AND_TRANSFERS')),
  dashboard_profile text NOT NULL CHECK (dashboard_profile IN ('NONE','EXPRESS','FULL')),
  fees_responsibility text NOT NULL CHECK (fees_responsibility IN ('PROVIDER','PLATFORM','CONNECTED_MERCHANT')),
  losses_responsibility text NOT NULL CHECK (losses_responsibility IN ('PROVIDER','PLATFORM','CONNECTED_MERCHANT')),
  readiness_state text NOT NULL CHECK (readiness_state IN ('PENDING','ACTION_REQUIRED','READY','DISABLED')),
  last_reconciliation_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_airenpay_provider_connection_location_scope
    FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id),
  CONSTRAINT uq_airenpay_provider_connection_scope_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_airenpay_provider_account_environment
    UNIQUE (provider_type, environment_class, provider_account_reference)
);

CREATE INDEX idx_airenpay_provider_connections_scope
  ON airenpay.provider_connections(tenant_id, location_id, connection_status, environment_class);

ALTER TABLE airenpay.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE airenpay.provider_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY airenpay_provider_connections_scope_policy ON airenpay.provider_connections
  FOR ALL TO airen_app
  USING (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND (
      location_id IS NULL
      OR location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('airen.tenant_id', true), '')::uuid
    AND (
      location_id IS NULL
      OR location_id = NULLIF(current_setting('airen.location_id', true), '')::uuid
    )
  );

GRANT USAGE ON SCHEMA airenpay TO airen_app;
GRANT SELECT, INSERT, UPDATE ON airenpay.provider_connections TO airen_app;

COMMIT;
