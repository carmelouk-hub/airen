-- B44-FX-008 / 0001 Foundation Runtime Core
-- Executable-target migration for Runtime Slice 1.
-- PostgreSQL runtime execution is still pending because no PostgreSQL server is available in the authoring environment.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS authz;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS events;

CREATE TABLE platform.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL, name text NOT NULL, legal_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  locale text NOT NULL DEFAULT 'it-IT', timezone text NOT NULL DEFAULT 'Europe/Rome', currency text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tenants_slug_normalized CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT uq_tenants_slug UNIQUE (slug)
);

CREATE TABLE platform.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id), slug text NOT NULL, name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended','archived')), timezone text NOT NULL,
  address jsonb, geo jsonb, is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_locations_slug_normalized CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT uq_locations_tenant_slug UNIQUE (tenant_id, slug), CONSTRAINT uq_locations_tenant_id_id UNIQUE (tenant_id, id)
);
CREATE INDEX idx_locations_tenant ON platform.locations(tenant_id);
CREATE UNIQUE INDEX uq_locations_one_primary_per_tenant ON platform.locations(tenant_id) WHERE is_primary;

CREATE TABLE platform.tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id), location_id uuid, hostname text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','active','disabled','error')), verification_state text NOT NULL DEFAULT 'unverified',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tenant_domains_hostname_normalized CHECK (hostname = lower(hostname) AND hostname !~ '[[:space:]/]'),
  CONSTRAINT fk_tenant_domains_location_scope FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id)
);
CREATE UNIQUE INDEX uq_tenant_domains_hostname_ci ON platform.tenant_domains(lower(hostname));
CREATE INDEX idx_tenant_domains_tenant ON platform.tenant_domains(tenant_id);

CREATE TABLE identity.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text, primary_email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_identity_primary_email ON identity.identities(lower(primary_email)) WHERE primary_email IS NOT NULL;
CREATE TABLE identity.provider_subject_links (
  identity_id uuid NOT NULL REFERENCES identity.identities(id), provider_key text NOT NULL, provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (provider_key, provider_subject)
);

CREATE TABLE authz.platform_role_assignments (
  identity_id uuid NOT NULL REFERENCES identity.identities(id), role_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, role_key)
);
CREATE TABLE authz.tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id), identity_id uuid NOT NULL REFERENCES identity.identities(id),
  role_key text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_memberships_tenant_identity UNIQUE (tenant_id, identity_id), CONSTRAINT uq_tenant_memberships_tenant_id_id UNIQUE (tenant_id, id)
);
CREATE INDEX idx_tenant_memberships_identity ON authz.tenant_memberships(identity_id);
CREATE TABLE authz.location_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id), tenant_membership_id uuid NOT NULL, location_id uuid NOT NULL,
  role_key text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_location_memberships_membership_location UNIQUE (tenant_membership_id, location_id),
  CONSTRAINT fk_location_memberships_membership_scope FOREIGN KEY (tenant_id, tenant_membership_id) REFERENCES authz.tenant_memberships(tenant_id, id),
  CONSTRAINT fk_location_memberships_location_scope FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id)
);
CREATE TABLE authz.permission_registry (permission_key text PRIMARY KEY, description text, sensitivity text NOT NULL DEFAULT 'normal', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE authz.role_permission_grants (
  scope_kind text NOT NULL CHECK (scope_kind IN ('platform','tenant','location')), role_key text NOT NULL,
  permission_key text NOT NULL REFERENCES authz.permission_registry(permission_key), effect text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
  PRIMARY KEY (scope_kind, role_key, permission_key)
);
CREATE TABLE authz.membership_permission_grants (
  tenant_membership_id uuid NOT NULL REFERENCES authz.tenant_memberships(id), permission_key text NOT NULL REFERENCES authz.permission_registry(permission_key),
  effect text NOT NULL CHECK (effect IN ('allow','deny')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_membership_id, permission_key)
);

CREATE TABLE billing.entitlement_catalog (entitlement_key text PRIMARY KEY, description text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE billing.tenant_entitlements (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id), entitlement_key text NOT NULL REFERENCES billing.entitlement_catalog(entitlement_key),
  source_kind text NOT NULL, enabled boolean NOT NULL DEFAULT true, limit_value numeric, valid_until timestamptz, config jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, entitlement_key)
);

CREATE TABLE audit.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES platform.tenants(id), location_id uuid,
  actor_identity_id uuid REFERENCES identity.identities(id), actor_kind text NOT NULL, action_key text NOT NULL, resource_type text, resource_id text,
  correlation_id text NOT NULL, outcome text NOT NULL CHECK (outcome IN ('success','denied','failure')), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT ck_audit_location_requires_tenant CHECK (location_id IS NULL OR tenant_id IS NOT NULL),
  CONSTRAINT fk_audit_location_scope FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id)
);
CREATE INDEX idx_audit_tenant_created ON audit.audit_events(tenant_id, created_at DESC);
CREATE TABLE events.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES platform.tenants(id), location_id uuid,
  event_type text NOT NULL, aggregate_type text NOT NULL, aggregate_id text NOT NULL, payload_version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL,
  correlation_id text NOT NULL, delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','processing','delivered','failed','dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), last_error text, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
  CONSTRAINT ck_outbox_location_requires_tenant CHECK (location_id IS NULL OR tenant_id IS NOT NULL),
  CONSTRAINT fk_outbox_location_scope FOREIGN KEY (tenant_id, location_id) REFERENCES platform.locations(tenant_id, id)
);
CREATE INDEX idx_outbox_pending ON events.outbox_events(delivery_status, created_at);
COMMIT;
