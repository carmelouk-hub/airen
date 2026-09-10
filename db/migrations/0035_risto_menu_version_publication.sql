-- RISTO-MAT-026 / GJ2-020 — Menu Version & Publication Runtime
-- Runtime materialization of the already-approved MAT-005/006 menu foundation.
BEGIN;

CREATE TABLE ristoairen.menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  description text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  default_currency text NOT NULL CHECK (default_currency ~ '^[A-Z]{3}$'),
  active_version_id uuid,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_risto_menu_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_menu_code UNIQUE (tenant_id,code)
);

CREATE TABLE ristoairen.menu_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  menu_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 1),
  label text CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','VALIDATED','PUBLISHED','RETIRED')),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  source_request_key text NOT NULL CHECK (length(btrim(source_request_key)) BETWEEN 1 AND 200),
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_menu_version_menu FOREIGN KEY (tenant_id,menu_id) REFERENCES ristoairen.menus(tenant_id,id),
  CONSTRAINT uq_risto_menu_version_scope_id UNIQUE (tenant_id,menu_id,id),
  CONSTRAINT uq_risto_menu_version_number UNIQUE (tenant_id,menu_id,version_number),
  CONSTRAINT uq_risto_menu_version_request UNIQUE (tenant_id,menu_id,source_request_key),
  CONSTRAINT ck_risto_menu_version_hash_state CHECK (
    (status='DRAFT' AND content_hash IS NULL AND validated_at IS NULL AND published_at IS NULL)
    OR (status='VALIDATED' AND content_hash IS NOT NULL AND validated_at IS NOT NULL AND published_at IS NULL)
    OR (status IN ('PUBLISHED','RETIRED') AND content_hash IS NOT NULL AND validated_at IS NOT NULL AND published_at IS NOT NULL)
  )
);

ALTER TABLE ristoairen.menus
  ADD CONSTRAINT fk_risto_menu_active_version
  FOREIGN KEY (tenant_id,id,active_version_id)
  REFERENCES ristoairen.menu_versions(tenant_id,menu_id,id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE ristoairen.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  menu_id uuid NOT NULL,
  menu_version_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  description text,
  public_label text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_menu_category_version FOREIGN KEY (tenant_id,menu_id,menu_version_id)
    REFERENCES ristoairen.menu_versions(tenant_id,menu_id,id),
  CONSTRAINT uq_risto_menu_category_scope_id UNIQUE (tenant_id,menu_id,menu_version_id,id),
  CONSTRAINT uq_risto_menu_category_code UNIQUE (tenant_id,menu_version_id,code)
);

CREATE TABLE ristoairen.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  menu_id uuid NOT NULL,
  menu_version_id uuid NOT NULL,
  category_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  description text,
  base_price_amount numeric(12,2) NOT NULL CHECK (base_price_amount >= 0),
  base_price_currency text NOT NULL CHECK (base_price_currency ~ '^[A-Z]{3}$'),
  production_route text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','ARCHIVED')),
  sort_order integer NOT NULL DEFAULT 0,
  allergen_summary_sanitized text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_menu_item_version FOREIGN KEY (tenant_id,menu_id,menu_version_id)
    REFERENCES ristoairen.menu_versions(tenant_id,menu_id,id),
  CONSTRAINT fk_risto_menu_item_category FOREIGN KEY (tenant_id,menu_id,menu_version_id,category_id)
    REFERENCES ristoairen.menu_categories(tenant_id,menu_id,menu_version_id,id),
  CONSTRAINT uq_risto_menu_item_scope_id UNIQUE (tenant_id,menu_id,menu_version_id,id),
  CONSTRAINT uq_risto_menu_item_code UNIQUE (tenant_id,menu_version_id,code)
);

CREATE TABLE ristoairen.menu_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  menu_id uuid NOT NULL,
  menu_version_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('PUBLIC_WEB','QR','STAFF','POS','FAST','SELF')),
  status text NOT NULL CHECK (status IN ('SCHEDULED','ACTIVE','ENDED','REVOKED')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  published_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_risto_menu_publication_window CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT fk_risto_menu_publication_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_menu_publication_version FOREIGN KEY (tenant_id,menu_id,menu_version_id)
    REFERENCES ristoairen.menu_versions(tenant_id,menu_id,id),
  CONSTRAINT uq_risto_menu_publication_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_menu_publication_version_channel UNIQUE (tenant_id,location_id,menu_id,menu_version_id,channel)
);

CREATE UNIQUE INDEX uq_risto_menu_publication_active_pointer
  ON ristoairen.menu_publications(tenant_id,location_id,menu_id,channel)
  WHERE status='ACTIVE';
CREATE INDEX idx_risto_menu_publication_effective
  ON ristoairen.menu_publications(tenant_id,location_id,menu_id,channel,effective_from,effective_to);

CREATE TABLE ristoairen.availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid,
  menu_id uuid NOT NULL,
  menu_version_id uuid NOT NULL,
  menu_item_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'ANY' CHECK (channel IN ('ANY','PUBLIC_WEB','QR','STAFF','POS','FAST','SELF')),
  available boolean NOT NULL,
  reason_code text,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_risto_availability_rule_window CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT fk_risto_availability_rule_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_availability_rule_item FOREIGN KEY (tenant_id,menu_id,menu_version_id,menu_item_id)
    REFERENCES ristoairen.menu_items(tenant_id,menu_id,menu_version_id,id)
);
CREATE INDEX idx_risto_availability_rule_effective
  ON ristoairen.availability_rules(tenant_id,menu_version_id,menu_item_id,location_id,priority,effective_from);

CREATE TABLE ristoairen.price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid,
  menu_id uuid NOT NULL,
  menu_version_id uuid NOT NULL,
  menu_item_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'ANY' CHECK (channel IN ('ANY','PUBLIC_WEB','QR','STAFF','POS','FAST','SELF')),
  price_amount numeric(12,2) NOT NULL CHECK (price_amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason_code text,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by_identity_id uuid REFERENCES identity.identities(id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_risto_price_rule_window CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT fk_risto_price_rule_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_price_rule_item FOREIGN KEY (tenant_id,menu_id,menu_version_id,menu_item_id)
    REFERENCES ristoairen.menu_items(tenant_id,menu_id,menu_version_id,id)
);
CREATE INDEX idx_risto_price_rule_effective
  ON ristoairen.price_rules(tenant_id,menu_version_id,menu_item_id,location_id,priority,effective_from);

CREATE OR REPLACE FUNCTION ristoairen.guard_menu_version_identity_and_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.menu_id <> OLD.menu_id OR NEW.version_number <> OLD.version_number OR NEW.source_request_key <> OLD.source_request_key THEN
    RAISE EXCEPTION 'MENU_VERSION_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.status IN ('VALIDATED','PUBLISHED','RETIRED') AND NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'MENU_VERSION_CONTENT_HASH_IMMUTABLE';
  END IF;
  IF OLD.status='PUBLISHED' AND NEW.status NOT IN ('PUBLISHED','RETIRED') THEN
    RAISE EXCEPTION 'PUBLISHED_MENU_VERSION_IMMUTABLE';
  END IF;
  IF OLD.status='RETIRED' AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'RETIRED_MENU_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_menu_version_guard
BEFORE UPDATE ON ristoairen.menu_versions
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_menu_version_identity_and_hash();

CREATE OR REPLACE FUNCTION ristoairen.guard_menu_version_content_draft_only()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
DECLARE v_version uuid;
BEGIN
  v_version := COALESCE(NEW.menu_version_id,OLD.menu_version_id);
  SELECT status INTO v_status FROM ristoairen.menu_versions WHERE id=v_version;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'MENU_VERSION_CONTENT_IMMUTABLE';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER trg_risto_menu_category_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON ristoairen.menu_categories
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_menu_version_content_draft_only();
CREATE TRIGGER trg_risto_menu_item_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON ristoairen.menu_items
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_menu_version_content_draft_only();

ALTER TABLE ristoairen.menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menus FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menu_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menu_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menu_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menu_items FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menu_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.menu_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.availability_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.price_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.price_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_menu_tenant_policy ON ristoairen.menus FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);
CREATE POLICY risto_menu_version_tenant_policy ON ristoairen.menu_versions FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);
CREATE POLICY risto_menu_category_tenant_policy ON ristoairen.menu_categories FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);
CREATE POLICY risto_menu_item_tenant_policy ON ristoairen.menu_items FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);
CREATE POLICY risto_menu_publication_location_policy ON ristoairen.menu_publications FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid);
CREATE POLICY risto_availability_rule_scope_policy ON ristoairen.availability_rules FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND (location_id IS NULL OR location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid))
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND (location_id IS NULL OR location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid));
CREATE POLICY risto_price_rule_scope_policy ON ristoairen.price_rules FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND (location_id IS NULL OR location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid))
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND (location_id IS NULL OR location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid));

GRANT SELECT,INSERT,UPDATE ON ristoairen.menus TO airen_app;
GRANT SELECT,INSERT,UPDATE ON ristoairen.menu_versions TO airen_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ristoairen.menu_categories TO airen_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ristoairen.menu_items TO airen_app;
GRANT SELECT,INSERT,UPDATE ON ristoairen.menu_publications TO airen_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ristoairen.availability_rules TO airen_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ristoairen.price_rules TO airen_app;

COMMIT;
