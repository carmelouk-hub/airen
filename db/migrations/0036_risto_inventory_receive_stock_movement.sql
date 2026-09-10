-- RISTO-MAT-027 / GJ2-021 — Inventory Receive / Stock Movement Runtime
-- Synthetic/non-production runtime materialization of the canonical receive -> ledger -> projection chain.
BEGIN;

CREATE TABLE ristoairen.units_of_measure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,31}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  decimal_scale integer NOT NULL DEFAULT 3 CHECK (decimal_scale BETWEEN 0 AND 6),
  active boolean NOT NULL DEFAULT true,
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_risto_uom_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_uom_code UNIQUE (tenant_id,code)
);

CREATE TABLE ristoairen.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  base_uom_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_ingredient_uom FOREIGN KEY (tenant_id,base_uom_id)
    REFERENCES ristoairen.units_of_measure(tenant_id,id),
  CONSTRAINT uq_risto_ingredient_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_ingredient_code UNIQUE (tenant_id,code)
);

CREATE TABLE ristoairen.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  active boolean NOT NULL DEFAULT true,
  environment_class text NOT NULL CHECK (environment_class IN ('PRODUCTION','DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_risto_supplier_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_supplier_code UNIQUE (tenant_id,code)
);

CREATE TABLE ristoairen.goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  purchase_order_id uuid,
  receipt_number text NOT NULL CHECK (length(btrim(receipt_number)) BETWEEN 1 AND 120),
  received_at timestamptz NOT NULL,
  received_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED')),
  source_request_key text NOT NULL CHECK (length(btrim(source_request_key)) BETWEEN 1 AND 200),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  confirmed_at timestamptz,
  confirmed_by_identity_id uuid REFERENCES identity.identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_goods_receipt_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_goods_receipt_supplier FOREIGN KEY (tenant_id,supplier_id)
    REFERENCES ristoairen.suppliers(tenant_id,id),
  CONSTRAINT uq_risto_goods_receipt_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_goods_receipt_request UNIQUE (tenant_id,location_id,source_request_key),
  CONSTRAINT ck_risto_goods_receipt_confirmed CHECK (
    (status='DRAFT' AND confirmed_at IS NULL AND confirmed_by_identity_id IS NULL)
    OR (status='CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by_identity_id IS NOT NULL)
  )
);

CREATE TABLE ristoairen.goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  goods_receipt_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  uom_id uuid NOT NULL,
  quantity_received numeric(18,6) NOT NULL CHECK (quantity_received > 0),
  rejected_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  source_line_key text NOT NULL CHECK (length(btrim(source_line_key)) BETWEEN 1 AND 200),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_goods_receipt_line_parent FOREIGN KEY (tenant_id,location_id,goods_receipt_id)
    REFERENCES ristoairen.goods_receipts(tenant_id,location_id,id),
  CONSTRAINT fk_risto_goods_receipt_line_ingredient FOREIGN KEY (tenant_id,ingredient_id)
    REFERENCES ristoairen.ingredients(tenant_id,id),
  CONSTRAINT fk_risto_goods_receipt_line_uom FOREIGN KEY (tenant_id,uom_id)
    REFERENCES ristoairen.units_of_measure(tenant_id,id),
  CONSTRAINT uq_risto_goods_receipt_line_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_goods_receipt_line_request UNIQUE (tenant_id,location_id,goods_receipt_id,source_line_key)
);

CREATE TABLE ristoairen.stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  on_hand_quantity numeric(18,6) NOT NULL DEFAULT 0,
  reserved_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  base_uom_id uuid NOT NULL,
  last_movement_at timestamptz,
  last_count_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_stock_item_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_stock_item_ingredient FOREIGN KEY (tenant_id,ingredient_id)
    REFERENCES ristoairen.ingredients(tenant_id,id),
  CONSTRAINT fk_risto_stock_item_uom FOREIGN KEY (tenant_id,base_uom_id)
    REFERENCES ristoairen.units_of_measure(tenant_id,id),
  CONSTRAINT uq_risto_stock_item_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_stock_item_ingredient UNIQUE (tenant_id,location_id,ingredient_id)
);

CREATE TABLE ristoairen.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type='RECEIPT'),
  quantity_delta numeric(18,6) NOT NULL CHECK (quantity_delta > 0),
  uom_id uuid NOT NULL,
  base_quantity_delta numeric(18,6) NOT NULL CHECK (base_quantity_delta > 0),
  source_entity_type text NOT NULL CHECK (source_entity_type='GoodsReceiptLine'),
  source_entity_id uuid NOT NULL,
  reason_code text NOT NULL DEFAULT 'GOODS_RECEIPT_CONFIRMED',
  occurred_at timestamptz NOT NULL,
  posted_at timestamptz NOT NULL,
  posted_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 240),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_stock_movement_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_stock_movement_ingredient FOREIGN KEY (tenant_id,ingredient_id)
    REFERENCES ristoairen.ingredients(tenant_id,id),
  CONSTRAINT fk_risto_stock_movement_uom FOREIGN KEY (tenant_id,uom_id)
    REFERENCES ristoairen.units_of_measure(tenant_id,id),
  CONSTRAINT fk_risto_stock_movement_source_line FOREIGN KEY (tenant_id,location_id,source_entity_id)
    REFERENCES ristoairen.goods_receipt_lines(tenant_id,location_id,id),
  CONSTRAINT uq_risto_stock_movement_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_stock_movement_idempotency UNIQUE (tenant_id,location_id,idempotency_key),
  CONSTRAINT uq_risto_stock_movement_source UNIQUE (tenant_id,location_id,source_entity_type,source_entity_id)
);

CREATE OR REPLACE FUNCTION ristoairen.guard_goods_receipt_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='CONFIRMED' THEN
    RAISE EXCEPTION 'CONFIRMED_GOODS_RECEIPT_IMMUTABLE';
  END IF;
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.location_id<>OLD.location_id OR NEW.supplier_id<>OLD.supplier_id
     OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id OR NEW.receipt_number<>OLD.receipt_number
     OR NEW.received_at<>OLD.received_at OR NEW.received_by_identity_id<>OLD.received_by_identity_id
     OR NEW.source_request_key<>OLD.source_request_key OR NEW.environment_class<>OLD.environment_class THEN
    RAISE EXCEPTION 'GOODS_RECEIPT_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.status<>'CONFIRMED' OR NEW.confirmed_at IS NULL OR NEW.confirmed_by_identity_id IS NULL
     OR NEW.row_version<>OLD.row_version+1 THEN
    RAISE EXCEPTION 'GOODS_RECEIPT_INVALID_CONFIRMATION';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_goods_receipt_guard
BEFORE UPDATE ON ristoairen.goods_receipts
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_goods_receipt_update();

CREATE OR REPLACE FUNCTION ristoairen.validate_receipt_stock_movement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_receipt_status text;
DECLARE v_line_ingredient uuid;
DECLARE v_line_uom uuid;
DECLARE v_line_quantity numeric(18,6);
BEGIN
  SELECT r.status,l.ingredient_id,l.uom_id,l.quantity_received
    INTO v_receipt_status,v_line_ingredient,v_line_uom,v_line_quantity
    FROM ristoairen.goods_receipt_lines l
    JOIN ristoairen.goods_receipts r
      ON r.tenant_id=l.tenant_id AND r.location_id=l.location_id AND r.id=l.goods_receipt_id
   WHERE l.tenant_id=NEW.tenant_id AND l.location_id=NEW.location_id AND l.id=NEW.source_entity_id;
  IF v_receipt_status IS DISTINCT FROM 'CONFIRMED' THEN
    RAISE EXCEPTION 'STOCK_MOVEMENT_REQUIRES_CONFIRMED_RECEIPT';
  END IF;
  IF NEW.ingredient_id<>v_line_ingredient OR NEW.uom_id<>v_line_uom OR NEW.quantity_delta<>v_line_quantity
     OR NEW.base_quantity_delta<>v_line_quantity THEN
    RAISE EXCEPTION 'STOCK_MOVEMENT_SOURCE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_stock_movement_validate
BEFORE INSERT ON ristoairen.stock_movements
FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_receipt_stock_movement();

CREATE OR REPLACE FUNCTION ristoairen.project_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ristoairen
AS $$
DECLARE v_base_uom uuid;
BEGIN
  SELECT base_uom_id INTO v_base_uom
    FROM ristoairen.ingredients
   WHERE tenant_id=NEW.tenant_id AND id=NEW.ingredient_id;
  IF v_base_uom IS NULL OR NEW.uom_id<>v_base_uom THEN
    RAISE EXCEPTION 'STOCK_MOVEMENT_UOM_NOT_BASE_UOM';
  END IF;
  INSERT INTO ristoairen.stock_items
    (tenant_id,location_id,ingredient_id,on_hand_quantity,reserved_quantity,base_uom_id,last_movement_at,active,environment_class,created_at,updated_at)
  VALUES
    (NEW.tenant_id,NEW.location_id,NEW.ingredient_id,NEW.base_quantity_delta,0,NEW.uom_id,NEW.occurred_at,true,NEW.environment_class,NEW.posted_at,NEW.posted_at)
  ON CONFLICT (tenant_id,location_id,ingredient_id) DO UPDATE
    SET on_hand_quantity=ristoairen.stock_items.on_hand_quantity+EXCLUDED.on_hand_quantity,
        last_movement_at=GREATEST(ristoairen.stock_items.last_movement_at,EXCLUDED.last_movement_at),
        updated_at=EXCLUDED.updated_at;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ristoairen.project_stock_movement() FROM PUBLIC;
CREATE TRIGGER trg_risto_stock_movement_project
AFTER INSERT ON ristoairen.stock_movements
FOR EACH ROW EXECUTE FUNCTION ristoairen.project_stock_movement();

ALTER TABLE ristoairen.units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.units_of_measure FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.ingredients FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.suppliers FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.goods_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.goods_receipt_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.stock_items FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.stock_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_uom_tenant_policy ON ristoairen.units_of_measure FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);
CREATE POLICY risto_ingredient_tenant_policy ON ristoairen.ingredients FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);
CREATE POLICY risto_supplier_tenant_policy ON ristoairen.suppliers FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);
CREATE POLICY risto_goods_receipt_scope_policy ON ristoairen.goods_receipts FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid);
CREATE POLICY risto_goods_receipt_line_scope_policy ON ristoairen.goods_receipt_lines FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid);
CREATE POLICY risto_stock_item_scope_policy ON ristoairen.stock_items FOR SELECT TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid);
CREATE POLICY risto_stock_movement_scope_policy ON ristoairen.stock_movements FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid);

REVOKE ALL ON ristoairen.units_of_measure,ristoairen.ingredients,ristoairen.suppliers,
  ristoairen.goods_receipts,ristoairen.goods_receipt_lines,ristoairen.stock_items,ristoairen.stock_movements FROM airen_app;
GRANT SELECT ON ristoairen.units_of_measure,ristoairen.ingredients,ristoairen.suppliers TO airen_app;
GRANT SELECT,INSERT,UPDATE ON ristoairen.goods_receipts TO airen_app;
GRANT SELECT,INSERT ON ristoairen.goods_receipt_lines TO airen_app;
GRANT SELECT ON ristoairen.stock_items TO airen_app;
GRANT SELECT,INSERT ON ristoairen.stock_movements TO airen_app;

COMMIT;
