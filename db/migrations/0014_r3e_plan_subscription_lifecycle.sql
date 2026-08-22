-- R3-E / 0014 Plan & Subscription schema, authority and shared permission capability
BEGIN;
-- R3-E / 0014 Plan & Subscription Lifecycle
-- Commercial state is not authorization. Subscription state is not entitlement state.

CREATE TABLE billing.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  currency text NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  billing_period text NOT NULL CHECK (billing_period IN ('monthly','annual')),
  default_trial_days integer NOT NULL DEFAULT 0 CHECK (default_trial_days BETWEEN 0 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  CONSTRAINT ck_plans_slug_normalized CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT ck_plans_name_nonempty CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT ck_plans_description_length CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT ck_plans_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT uq_plans_slug UNIQUE (slug),
  CONSTRAINT ck_plans_lifecycle_timestamps CHECK (
    (status='draft' AND activated_at IS NULL AND retired_at IS NULL)
    OR (status='active' AND activated_at IS NOT NULL AND retired_at IS NULL)
    OR (status='retired' AND activated_at IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE TABLE billing.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  plan_id uuid NOT NULL REFERENCES billing.plans(id),
  status text NOT NULL CHECK (status IN ('scheduled','trialing','active','suspended','cancel_pending','canceled','expired')),
  starts_at timestamptz NOT NULL,
  trial_ends_at timestamptz,
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_effective_at timestamptz,
  canceled_at timestamptz,
  suspended_at timestamptz,
  source_kind text NOT NULL CHECK (source_kind IN ('manual','migration','provider')),
  provider_key text,
  provider_subscription_ref text,
  provider_customer_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_subscriptions_period CHECK (current_period_end > current_period_start),
  CONSTRAINT ck_subscriptions_trial CHECK (trial_ends_at IS NULL OR trial_ends_at > starts_at),
  CONSTRAINT ck_subscriptions_provider_key CHECK (provider_key IS NULL OR (provider_key = lower(provider_key) AND provider_key ~ '^[a-z0-9][a-z0-9._:-]{1,63}$')),
  CONSTRAINT ck_subscriptions_provider_subscription_ref CHECK (provider_subscription_ref IS NULL OR char_length(provider_subscription_ref) BETWEEN 1 AND 255),
  CONSTRAINT ck_subscriptions_provider_customer_ref CHECK (provider_customer_ref IS NULL OR char_length(provider_customer_ref) BETWEEN 1 AND 255),
  CONSTRAINT ck_subscriptions_provider_refs_require_key CHECK ((provider_subscription_ref IS NULL AND provider_customer_ref IS NULL) OR provider_key IS NOT NULL),
  CONSTRAINT ck_subscriptions_provider_source CHECK (source_kind <> 'provider' OR (provider_key IS NOT NULL AND provider_subscription_ref IS NOT NULL)),
  CONSTRAINT ck_subscriptions_cancel_pending CHECK (status <> 'cancel_pending' OR cancel_effective_at IS NOT NULL),
  CONSTRAINT ck_subscriptions_canceled CHECK (status <> 'canceled' OR canceled_at IS NOT NULL)
);
CREATE INDEX idx_subscriptions_tenant_created ON billing.subscriptions(tenant_id,created_at DESC);
CREATE INDEX idx_subscriptions_plan ON billing.subscriptions(plan_id);
CREATE UNIQUE INDEX uq_subscriptions_one_current_per_tenant ON billing.subscriptions(tenant_id)
  WHERE status IN ('scheduled','trialing','active','suspended','cancel_pending');
CREATE UNIQUE INDEX uq_subscriptions_provider_subscription_ref ON billing.subscriptions(provider_key,provider_subscription_ref)
  WHERE provider_key IS NOT NULL AND provider_subscription_ref IS NOT NULL;

CREATE TABLE billing.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES billing.subscriptions(id),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  event_type text NOT NULL CHECK (event_type IN ('created','started','trial_activated','plan_changed','suspended','reactivated','cancel_scheduled','cancel_unscheduled','canceled','expired')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('scheduled','trialing','active','suspended','cancel_pending','canceled','expired')),
  to_status text NOT NULL CHECK (to_status IN ('scheduled','trialing','active','suspended','cancel_pending','canceled','expired')),
  from_plan_id uuid REFERENCES billing.plans(id),
  to_plan_id uuid NOT NULL REFERENCES billing.plans(id),
  effective_at timestamptz NOT NULL,
  actor_identity_id uuid REFERENCES identity.identities(id),
  reason_code text NOT NULL,
  correlation_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_subscription_event_reason CHECK (reason_code ~ '^[a-z0-9][a-z0-9._:-]{2,63}$')
);
CREATE INDEX idx_subscription_events_subscription_created ON billing.subscription_events(subscription_id,created_at DESC);
CREATE INDEX idx_subscription_events_tenant_created ON billing.subscription_events(tenant_id,created_at DESC);

CREATE TABLE billing.lifecycle_idempotency (
  idempotency_key text PRIMARY KEY,
  request_hash char(64) NOT NULL,
  action_key text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('plan','subscription')),
  resource_id uuid,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ck_billing_idempotency_key CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT ck_billing_idempotency_completed CHECK (status <> 'completed' OR (resource_id IS NOT NULL AND result IS NOT NULL AND completed_at IS NOT NULL))
);

ALTER TABLE billing.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.plans FORCE ROW LEVEL SECURITY;
ALTER TABLE billing.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE billing.subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.subscription_events FORCE ROW LEVEL SECURITY;
ALTER TABLE billing.lifecycle_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.lifecycle_idempotency FORCE ROW LEVEL SECURITY;

REVOKE ALL ON billing.plans,billing.subscriptions,billing.subscription_events,billing.lifecycle_idempotency FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE ON billing.plans,billing.subscriptions,billing.subscription_events,billing.lifecycle_idempotency FROM airen_app;
REVOKE INSERT,UPDATE,DELETE ON billing.plans,billing.subscriptions,billing.subscription_events,billing.lifecycle_idempotency FROM airen_control_plane;

INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES
  ('platform.plans.read','Read Plan catalog projections','high'),
  ('platform.plans.create','Create draft Plans','critical'),
  ('platform.plans.update','Update draft Plan commercial terms','critical'),
  ('platform.plans.activate','Activate a draft Plan','critical'),
  ('platform.plans.retire','Retire an active Plan','critical'),
  ('platform.subscriptions.read','Read Tenant Subscription projections','high'),
  ('platform.subscriptions.create','Create Tenant Subscriptions','critical'),
  ('platform.subscriptions.change_plan','Change Subscription Plan','critical'),
  ('platform.subscriptions.activate','Start or activate a Subscription','critical'),
  ('platform.subscriptions.suspend','Suspend an active Subscription','critical'),
  ('platform.subscriptions.reactivate','Reactivate a suspended Subscription','critical'),
  ('platform.subscriptions.schedule_cancel','Schedule Subscription cancellation','critical'),
  ('platform.subscriptions.unschedule_cancel','Unschedule Subscription cancellation','critical'),
  ('platform.subscriptions.cancel','Cancel a Subscription','critical'),
  ('platform.subscriptions.expire','Finalize Subscription expiration','critical')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
SELECT 'platform','platform_admin',p.permission_key,'allow'
FROM authz.permission_registry p
WHERE p.permission_key IN (
  'platform.plans.read','platform.plans.create','platform.plans.update','platform.plans.activate','platform.plans.retire',
  'platform.subscriptions.read','platform.subscriptions.create','platform.subscriptions.change_plan','platform.subscriptions.activate',
  'platform.subscriptions.suspend','platform.subscriptions.reactivate','platform.subscriptions.schedule_cancel',
  'platform.subscriptions.unschedule_cancel','platform.subscriptions.cancel','platform.subscriptions.expire'
)
ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow';

GRANT USAGE ON SCHEMA billing,platform,authz,audit,events,security TO airen_control_plane_owner;
GRANT SELECT ON platform.tenants TO airen_control_plane_owner;
GRANT SELECT ON authz.platform_role_assignments,authz.role_permission_grants TO airen_control_plane_owner;
GRANT SELECT,INSERT,UPDATE ON billing.plans,billing.subscriptions,billing.lifecycle_idempotency TO airen_control_plane_owner;
GRANT SELECT,INSERT ON billing.subscription_events TO airen_control_plane_owner;
GRANT INSERT ON audit.audit_events,events.outbox_events TO airen_control_plane_owner;

CREATE OR REPLACE FUNCTION security.r3e_assert_platform_permission(p_permission text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  v_actor uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
  v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
BEGIN
  IF v_actor IS NULL OR v_correlation IS NULL THEN
    RAISE EXCEPTION 'AIRENOS_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM authz.platform_role_assignments pra
    JOIN authz.role_permission_grants rpg
      ON rpg.scope_kind='platform' AND rpg.role_key=pra.role_key AND rpg.permission_key=p_permission AND rpg.effect='allow'
    WHERE pra.identity_id=v_actor AND pra.status='active'
  ) THEN
    RAISE EXCEPTION 'AIRENOS_BILLING_PLATFORM_PERMISSION_DENIED' USING ERRCODE='42501';
  END IF;
END;
$$;
ALTER FUNCTION security.r3e_assert_platform_permission(text) OWNER TO airen_control_plane_owner;
REVOKE ALL ON FUNCTION security.r3e_assert_platform_permission(text) FROM PUBLIC;


COMMIT;
