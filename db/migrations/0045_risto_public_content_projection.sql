-- RISTO-MAT-040 / GJ2-002 — Public Tenant Experience Runtime
-- Minimum C019 persistence only. Hostname -> tenant/location authority remains AIRenOS TenantDomain.
-- No PublicSite aggregate and no public/bypass database role is introduced here.
BEGIN;

CREATE TABLE ristoairen.public_seo_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  page_path text NOT NULL CHECK (left(page_path,1)='/' AND position('..' in page_path)=0 AND length(page_path) <= 512),
  locale text NOT NULL CHECK (locale IN ('it','en','fr','de','es')),
  seo_title text NOT NULL CHECK (length(btrim(seo_title)) BETWEEN 1 AND 240),
  meta_description text,
  h1 text,
  canonical_url text,
  open_graph_title text,
  open_graph_description text,
  open_graph_image_url text,
  schema_type text,
  noindex boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  published_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_public_seo_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_public_seo_scope UNIQUE (tenant_id,location_id,page_path,locale),
  CONSTRAINT ck_risto_public_seo_publish_state CHECK (
    (status='DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED','ARCHIVED') AND published_at IS NOT NULL)
  )
);

CREATE TABLE ristoairen.journal_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 120),
  locale text NOT NULL CHECK (locale IN ('it','en','fr','de','es')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  excerpt text,
  body text NOT NULL CHECK (length(btrim(body)) >= 1),
  category text,
  hero_image_url text,
  hero_image_alt text,
  seo_title text,
  meta_description text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  published_at timestamptz,
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  draft_request_key text NOT NULL CHECK (length(btrim(draft_request_key)) BETWEEN 1 AND 200),
  publish_request_key text,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_journal_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_risto_journal_slug_locale UNIQUE (tenant_id,location_id,slug,locale),
  CONSTRAINT uq_risto_journal_draft_request UNIQUE (tenant_id,location_id,draft_request_key),
  CONSTRAINT uq_risto_journal_publish_request UNIQUE (tenant_id,location_id,publish_request_key),
  CONSTRAINT ck_risto_journal_publish_state CHECK (
    (status='DRAFT' AND published_at IS NULL AND publish_request_key IS NULL)
    OR (status IN ('PUBLISHED','ARCHIVED') AND published_at IS NOT NULL AND publish_request_key IS NOT NULL)
  )
);

CREATE INDEX idx_risto_public_seo_published
  ON ristoairen.public_seo_projections(tenant_id,location_id,locale,page_path)
  WHERE status='PUBLISHED';
CREATE INDEX idx_risto_journal_published
  ON ristoairen.journal_articles(tenant_id,location_id,locale,published_at DESC,slug)
  WHERE status='PUBLISHED';

CREATE OR REPLACE FUNCTION ristoairen.guard_public_seo_projection_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.location_id <> OLD.location_id
     OR NEW.page_path <> OLD.page_path OR NEW.locale <> OLD.locale THEN
    RAISE EXCEPTION 'PUBLIC_SEO_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.status='PUBLISHED' AND NEW.status NOT IN ('PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'PUBLIC_SEO_PUBLISHED_STATE_IMMUTABLE';
  END IF;
  IF OLD.status='ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'PUBLIC_SEO_ARCHIVED_STATE_IMMUTABLE';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_risto_public_seo_projection_guard
BEFORE UPDATE ON ristoairen.public_seo_projections
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_public_seo_projection_lifecycle();

CREATE OR REPLACE FUNCTION ristoairen.guard_journal_article_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.location_id <> OLD.location_id
     OR NEW.slug <> OLD.slug OR NEW.locale <> OLD.locale
     OR NEW.created_by_identity_id <> OLD.created_by_identity_id
     OR NEW.draft_request_key <> OLD.draft_request_key THEN
    RAISE EXCEPTION 'JOURNAL_ARTICLE_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.status='PUBLISHED' AND NEW.status NOT IN ('PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'JOURNAL_PUBLISHED_STATE_IMMUTABLE';
  END IF;
  IF OLD.status='ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'JOURNAL_ARCHIVED_STATE_IMMUTABLE';
  END IF;
  IF OLD.status='DRAFT' AND NEW.status='PUBLISHED' AND NEW.row_version <> OLD.row_version THEN
    RAISE EXCEPTION 'JOURNAL_CALLER_CANNOT_SET_ROW_VERSION';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_risto_journal_article_guard
BEFORE UPDATE ON ristoairen.journal_articles
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_journal_article_lifecycle();

ALTER TABLE ristoairen.public_seo_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.public_seo_projections FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.journal_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.journal_articles FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_public_seo_scope_policy ON ristoairen.public_seo_projections
FOR ALL TO airen_app
USING (
  tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
  AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid
)
WITH CHECK (
  tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
  AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid
);

CREATE POLICY risto_journal_scope_policy ON ristoairen.journal_articles
FOR ALL TO airen_app
USING (
  tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
  AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid
)
WITH CHECK (
  tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
  AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid
);

GRANT SELECT ON ristoairen.public_seo_projections TO airen_app;
GRANT SELECT,INSERT ON ristoairen.journal_articles TO airen_app;
GRANT UPDATE (
  status,published_at,publish_request_key,row_version,updated_at
) ON ristoairen.journal_articles TO airen_app;

COMMIT;
