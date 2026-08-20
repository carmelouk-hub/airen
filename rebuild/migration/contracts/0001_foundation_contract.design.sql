-- B44-FX-006 / 0001 Foundation PostgreSQL Contract
-- DESIGN CONTRACT. Do not run on production without implementation review and DB harness.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS authz;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS risto;
CREATE SCHEMA IF NOT EXISTS integration;
CREATE SCHEMA IF NOT EXISTS security;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS stella;
CREATE SCHEMA IF NOT EXISTS atmos;
CREATE SCHEMA IF NOT EXISTS migration;

CREATE TABLE IF NOT EXISTS platform.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text,
  status text NOT NULL DEFAULT 'active',
  locale text NOT NULL DEFAULT 'it-IT',
  timezone text NOT NULL DEFAULT 'Europe/Rome',
  currency text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  timezone text NOT NULL,
  address jsonb,
  geo jsonb,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON platform.locations(tenant_id);

CREATE TABLE IF NOT EXISTS platform.tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid REFERENCES platform.locations(id),
  hostname text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  verification_state text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lower(hostname))
);
CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant ON platform.tenant_domains(tenant_id);

CREATE TABLE IF NOT EXISTS identity.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text,
  primary_email text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_primary_email ON identity.identities(lower(primary_email)) WHERE primary_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity.provider_subject_links (
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  provider_key text NOT NULL,
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_key, provider_subject)
);

CREATE TABLE IF NOT EXISTS authz.platform_role_assignments (
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  role_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, role_key)
);

CREATE TABLE IF NOT EXISTS authz.tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  identity_id uuid NOT NULL REFERENCES identity.identities(id),
  role_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, identity_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON authz.tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_identity ON authz.tenant_memberships(identity_id);

CREATE TABLE IF NOT EXISTS authz.location_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_membership_id uuid NOT NULL REFERENCES authz.tenant_memberships(id),
  location_id uuid NOT NULL REFERENCES platform.locations(id),
  role_key text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_membership_id, location_id)
);

CREATE TABLE IF NOT EXISTS authz.permission_registry (
  permission_key text PRIMARY KEY,
  description text,
  sensitivity text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authz.role_permission_grants (
  scope_kind text NOT NULL,
  role_key text NOT NULL,
  permission_key text NOT NULL REFERENCES authz.permission_registry(permission_key),
  effect text NOT NULL DEFAULT 'allow',
  PRIMARY KEY (scope_kind, role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS authz.membership_permission_grants (
  tenant_membership_id uuid NOT NULL REFERENCES authz.tenant_memberships(id),
  permission_key text NOT NULL REFERENCES authz.permission_registry(permission_key),
  effect text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_membership_id, permission_key)
);

CREATE TABLE IF NOT EXISTS billing.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL UNIQUE,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  plan_id uuid NOT NULL REFERENCES billing.plans(id),
  provider_key text,
  provider_account_ref text,
  provider_subscription_ref text,
  status text NOT NULL,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON billing.subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS billing.entitlement_catalog (
  entitlement_key text PRIMARY KEY,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing.tenant_entitlements (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  entitlement_key text NOT NULL REFERENCES billing.entitlement_catalog(entitlement_key),
  source_kind text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  limit_value numeric,
  valid_until timestamptz,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, entitlement_key)
);

CREATE TABLE IF NOT EXISTS risto.tenant_config (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenants(id),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration.provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid REFERENCES platform.locations(id),
  provider_key text NOT NULL,
  external_account_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_key, external_account_id)
);

CREATE TABLE IF NOT EXISTS integration.credential_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid NOT NULL REFERENCES integration.provider_accounts(id),
  credential_kind text NOT NULL,
  vault_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_account_id, credential_kind)
);

CREATE TABLE IF NOT EXISTS security.guest_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid REFERENCES platform.locations(id),
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scope_key text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(id),
  location_id uuid REFERENCES platform.locations(id),
  actor_identity_id uuid REFERENCES identity.identities(id),
  actor_kind text NOT NULL,
  action_key text NOT NULL,
  resource_type text,
  resource_id text,
  correlation_id text,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit.audit_events(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(id),
  location_id uuid REFERENCES platform.locations(id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  correlation_id text,
  delivery_status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON events.outbox_events(delivery_status, created_at);

CREATE TABLE IF NOT EXISTS stella.prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenants(id),
  prompt_key text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL,
  body text NOT NULL,
  change_reason text,
  approved_reference text,
  content_hash text NOT NULL,
  effective_from timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, prompt_key, version)
);

CREATE TABLE IF NOT EXISTS stella.capability_registry (
  capability_key text PRIMARY KEY,
  permission_key text REFERENCES authz.permission_registry(permission_key),
  approval_mode text NOT NULL DEFAULT 'none',
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atmos.location_experience_config (
  location_id uuid PRIMARY KEY REFERENCES platform.locations(id),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration.migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id text NOT NULL,
  target_schema_version text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS migration.id_map (
  migration_run_id uuid NOT NULL REFERENCES migration.migration_runs(id),
  source_system text NOT NULL,
  source_entity text NOT NULL,
  source_id text NOT NULL,
  target_entity text NOT NULL,
  target_id uuid NOT NULL,
  snapshot_id text NOT NULL,
  PRIMARY KEY (migration_run_id, source_system, source_entity, source_id)
);

CREATE TABLE IF NOT EXISTS migration.record_results (
  migration_run_id uuid NOT NULL REFERENCES migration.migration_runs(id),
  source_system text NOT NULL,
  source_entity text NOT NULL,
  source_id text NOT NULL,
  result text NOT NULL,
  target_entity text,
  target_id uuid,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migration_run_id, source_system, source_entity, source_id)
);

-- RLS policies are intentionally NOT defined in 0001. They depend on the selected target auth/session context.
-- Server-side authorization remains mandatory before any executable business capability is introduced.
-- Unknown host resolution must FAIL CLOSED in application policy; there is no default tenant column here.
