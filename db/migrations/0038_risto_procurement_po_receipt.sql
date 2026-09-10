-- RISTO-MAT-029 / GJ2-023 — Procurement / PO-backed Goods Receipt Runtime
-- Additive procurement authority over the already-certified MAT-027 receipt -> stock ledger path.
BEGIN;

CREATE TABLE ristoairen.supplier_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  supplier_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  supplier_sku text,
  base_uom_id uuid NOT NULL,
  current_unit_cost numeric(18,6) CHECK (current_unit_cost IS NULL OR current_unit_cost > 0),
  active boolean NOT NULL DEFAULT true,
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_supplier_item_supplier FOREIGN KEY (tenant_id,supplier_id)
    REFERENCES ristoairen.suppliers(tenant_id,id),
  CONSTRAINT fk_risto_supplier_item_ingredient FOREIGN KEY (tenant_id,ingredient_id)
    REFERENCES ristoairen.ingredients(tenant_id,id),
  CONSTRAINT fk_risto_supplier_item_uom FOREIGN KEY (tenant_id,base_uom_id)
    REFERENCES ristoairen.units_of_measure(tenant_id,id),
  CONSTRAINT uq_risto_supplier_item_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_supplier_item_supplier_ingredient UNIQUE (tenant_id,supplier_id,ingredient_id)
);

CREATE TABLE ristoairen.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  order_number text NOT NULL CHECK (length(btrim(order_number)) BETWEEN 1 AND 120),
  order_date date NOT NULL,
  expected_delivery_at timestamptz,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(18,6) NOT NULL CHECK (subtotal >= 0),
  tax_total numeric(18,6) CHECK (tax_total IS NULL OR tax_total >= 0),
  total numeric(18,6) NOT NULL CHECK (total >= 0),
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  approved_by_identity_id uuid REFERENCES identity.identities(id),
  approved_at timestamptz,
  sent_at timestamptz,
  closed_at timestamptz,
  source_type text NOT NULL DEFAULT 'MANUAL' CHECK (source_type IN ('MANUAL','STELLA_SUGGESTION','REPLENISHMENT')),
  source_suggestion_id uuid,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_purchase_order_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_purchase_order_supplier FOREIGN KEY (tenant_id,supplier_id)
    REFERENCES ristoairen.suppliers(tenant_id,id),
  CONSTRAINT uq_risto_purchase_order_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_purchase_order_number UNIQUE (tenant_id,location_id,order_number),
  CONSTRAINT ck_risto_purchase_order_approval_metadata CHECK (
    (status IN ('DRAFT','PENDING_APPROVAL','CANCELLED') AND approved_by_identity_id IS NULL AND approved_at IS NULL)
    OR
    (status IN ('APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CLOSED') AND approved_by_identity_id IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE TABLE ristoairen.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  supplier_item_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  quantity_ordered numeric(18,6) NOT NULL CHECK (quantity_ordered > 0),
  uom_id uuid NOT NULL,
  unit_cost_snapshot numeric(18,6) NOT NULL CHECK (unit_cost_snapshot > 0),
  line_total numeric(18,6) NOT NULL CHECK (line_total >= 0),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_purchase_order_line_parent FOREIGN KEY (tenant_id,location_id,purchase_order_id)
    REFERENCES ristoairen.purchase_orders(tenant_id,location_id,id),
  CONSTRAINT fk_risto_purchase_order_line_supplier_item FOREIGN KEY (tenant_id,supplier_item_id)
    REFERENCES ristoairen.supplier_items(tenant_id,id),
  CONSTRAINT fk_risto_purchase_order_line_ingredient FOREIGN KEY (tenant_id,ingredient_id)
    REFERENCES ristoairen.ingredients(tenant_id,id),
  CONSTRAINT fk_risto_purchase_order_line_uom FOREIGN KEY (tenant_id,uom_id)
    REFERENCES ristoairen.units_of_measure(tenant_id,id),
  CONSTRAINT uq_risto_purchase_order_line_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_risto_purchase_order_line_item UNIQUE (tenant_id,location_id,purchase_order_id,supplier_item_id)
);

ALTER TABLE ristoairen.goods_receipts
  ADD CONSTRAINT fk_risto_goods_receipt_purchase_order
  FOREIGN KEY (tenant_id,location_id,purchase_order_id)
  REFERENCES ristoairen.purchase_orders(tenant_id,location_id,id);

ALTER TABLE ristoairen.goods_receipt_lines
  ADD COLUMN purchase_order_line_id uuid,
  ADD COLUMN unit_cost_actual numeric(18,6),
  ADD CONSTRAINT fk_risto_goods_receipt_line_purchase_order_line
    FOREIGN KEY (tenant_id,location_id,purchase_order_line_id)
    REFERENCES ristoairen.purchase_order_lines(tenant_id,location_id,id),
  ADD CONSTRAINT ck_risto_goods_receipt_line_procurement_pair
    CHECK ((purchase_order_line_id IS NULL AND unit_cost_actual IS NULL)
        OR (purchase_order_line_id IS NOT NULL AND unit_cost_actual IS NOT NULL AND unit_cost_actual > 0)),
  ADD CONSTRAINT uq_risto_goods_receipt_line_po_line
    UNIQUE (tenant_id,location_id,goods_receipt_id,purchase_order_line_id);

CREATE TABLE ristoairen.supplier_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier_item_id uuid NOT NULL,
  unit_cost numeric(18,6) NOT NULL CHECK (unit_cost > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_at timestamptz NOT NULL,
  source_entity_type text NOT NULL DEFAULT 'GoodsReceiptLine' CHECK (source_entity_type='GoodsReceiptLine'),
  source_entity_id uuid NOT NULL,
  recorded_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 240),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_supplier_price_item FOREIGN KEY (tenant_id,supplier_item_id)
    REFERENCES ristoairen.supplier_items(tenant_id,id),
  CONSTRAINT uq_risto_supplier_price_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_supplier_price_receipt_line UNIQUE (tenant_id,source_entity_type,source_entity_id)
);
CREATE INDEX idx_risto_supplier_price_history
  ON ristoairen.supplier_prices(tenant_id,supplier_item_id,effective_at DESC,id DESC);

CREATE OR REPLACE FUNCTION ristoairen.validate_purchase_order_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_po_supplier uuid;
DECLARE v_po_environment text;
DECLARE v_item_supplier uuid;
DECLARE v_item_ingredient uuid;
DECLARE v_item_uom uuid;
DECLARE v_item_active boolean;
BEGIN
  SELECT supplier_id,environment_class INTO v_po_supplier,v_po_environment
    FROM ristoairen.purchase_orders
   WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.purchase_order_id;
  SELECT supplier_id,ingredient_id,base_uom_id,active INTO v_item_supplier,v_item_ingredient,v_item_uom,v_item_active
    FROM ristoairen.supplier_items
   WHERE tenant_id=NEW.tenant_id AND id=NEW.supplier_item_id;
  IF v_po_supplier IS NULL OR v_item_supplier IS NULL THEN RAISE EXCEPTION 'PURCHASE_ORDER_LINE_AUTHORITY_NOT_FOUND'; END IF;
  IF v_po_supplier<>v_item_supplier OR NEW.ingredient_id<>v_item_ingredient OR NEW.uom_id<>v_item_uom THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_LINE_MATERIAL_MISMATCH';
  END IF;
  IF v_item_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'PURCHASE_ORDER_LINE_REQUIRES_ACTIVE_SUPPLIER_ITEM'; END IF;
  IF NEW.environment_class<>v_po_environment THEN RAISE EXCEPTION 'PURCHASE_ORDER_LINE_ENVIRONMENT_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_purchase_order_line_validate
BEFORE INSERT ON ristoairen.purchase_order_lines
FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_purchase_order_line();

CREATE OR REPLACE FUNCTION ristoairen.validate_procurement_receipt_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_po uuid;
DECLARE v_receipt_supplier uuid;
DECLARE v_receipt_status text;
DECLARE v_receipt_environment text;
DECLARE v_po_status text;
DECLARE v_po_supplier uuid;
DECLARE v_line_po uuid;
DECLARE v_line_supplier_item uuid;
DECLARE v_line_ingredient uuid;
DECLARE v_line_uom uuid;
DECLARE v_quantity_ordered numeric(18,6);
DECLARE v_confirmed numeric(18,6);
BEGIN
  SELECT purchase_order_id,supplier_id,status,environment_class
    INTO v_po,v_receipt_supplier,v_receipt_status,v_receipt_environment
    FROM ristoairen.goods_receipts
   WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.goods_receipt_id;
  IF v_receipt_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'GOODS_RECEIPT_LINE_REQUIRES_DRAFT'; END IF;
  IF NEW.environment_class<>v_receipt_environment THEN RAISE EXCEPTION 'GOODS_RECEIPT_LINE_ENVIRONMENT_MISMATCH'; END IF;
  IF v_po IS NULL THEN
    IF NEW.purchase_order_line_id IS NOT NULL OR NEW.unit_cost_actual IS NOT NULL THEN
      RAISE EXCEPTION 'FREE_RECEIPT_CANNOT_ASSERT_PURCHASE_ORDER_LINE';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.purchase_order_line_id IS NULL OR NEW.unit_cost_actual IS NULL THEN
    RAISE EXCEPTION 'PO_RECEIPT_LINE_REQUIRES_ORDER_LINE_AND_PRICE';
  END IF;
  SELECT status,supplier_id INTO v_po_status,v_po_supplier
    FROM ristoairen.purchase_orders
   WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=v_po;
  IF v_po_status NOT IN ('APPROVED','SENT','PARTIALLY_RECEIVED') OR v_po_supplier<>v_receipt_supplier THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_NOT_RECEIVABLE';
  END IF;
  SELECT purchase_order_id,supplier_item_id,ingredient_id,uom_id,quantity_ordered
    INTO v_line_po,v_line_supplier_item,v_line_ingredient,v_line_uom,v_quantity_ordered
    FROM ristoairen.purchase_order_lines
   WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.purchase_order_line_id;
  IF v_line_po IS DISTINCT FROM v_po OR NEW.ingredient_id IS DISTINCT FROM v_line_ingredient OR NEW.uom_id IS DISTINCT FROM v_line_uom THEN
    RAISE EXCEPTION 'GOODS_RECEIPT_LINE_PURCHASE_ORDER_MISMATCH';
  END IF;
  SELECT COALESCE(sum(grl.quantity_received),0) INTO v_confirmed
    FROM ristoairen.goods_receipt_lines grl
    JOIN ristoairen.goods_receipts gr
      ON gr.tenant_id=grl.tenant_id AND gr.location_id=grl.location_id AND gr.id=grl.goods_receipt_id
   WHERE grl.tenant_id=NEW.tenant_id AND grl.location_id=NEW.location_id
     AND grl.purchase_order_line_id=NEW.purchase_order_line_id AND gr.status='CONFIRMED';
  IF v_confirmed+NEW.quantity_received>v_quantity_ordered THEN RAISE EXCEPTION 'PURCHASE_ORDER_OVER_RECEIPT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_procurement_receipt_line_validate
BEFORE INSERT ON ristoairen.goods_receipt_lines
FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_procurement_receipt_line();

CREATE OR REPLACE FUNCTION ristoairen.guard_goods_receipt_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_po_status text;
DECLARE v_po_supplier uuid;
DECLARE v_invalid boolean;
BEGIN
  IF OLD.status='CONFIRMED' THEN RAISE EXCEPTION 'CONFIRMED_GOODS_RECEIPT_IMMUTABLE'; END IF;
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
  IF NEW.purchase_order_id IS NOT NULL THEN
    SELECT status,supplier_id INTO v_po_status,v_po_supplier
      FROM ristoairen.purchase_orders
     WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND id=NEW.purchase_order_id;
    IF v_po_status NOT IN ('APPROVED','SENT','PARTIALLY_RECEIVED') OR v_po_supplier<>NEW.supplier_id THEN
      RAISE EXCEPTION 'PURCHASE_ORDER_NOT_RECEIVABLE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ristoairen.goods_receipt_lines l WHERE l.tenant_id=NEW.tenant_id AND l.location_id=NEW.location_id AND l.goods_receipt_id=NEW.id) THEN
      RAISE EXCEPTION 'GOODS_RECEIPT_REQUIRES_LINES';
    END IF;
    SELECT EXISTS (
      SELECT 1
        FROM ristoairen.goods_receipt_lines l
        LEFT JOIN ristoairen.purchase_order_lines pol
          ON pol.tenant_id=l.tenant_id AND pol.location_id=l.location_id AND pol.id=l.purchase_order_line_id
       WHERE l.tenant_id=NEW.tenant_id AND l.location_id=NEW.location_id AND l.goods_receipt_id=NEW.id
         AND (l.purchase_order_line_id IS NULL OR l.unit_cost_actual IS NULL OR pol.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id
              OR pol.ingredient_id IS DISTINCT FROM l.ingredient_id OR pol.uom_id IS DISTINCT FROM l.uom_id
              OR COALESCE((SELECT sum(prev.quantity_received)
                             FROM ristoairen.goods_receipt_lines prev
                             JOIN ristoairen.goods_receipts pgr ON pgr.tenant_id=prev.tenant_id AND pgr.location_id=prev.location_id AND pgr.id=prev.goods_receipt_id
                            WHERE prev.tenant_id=l.tenant_id AND prev.location_id=l.location_id
                              AND prev.purchase_order_line_id=l.purchase_order_line_id AND pgr.status='CONFIRMED'),0)+l.quantity_received>pol.quantity_ordered)
    ) INTO v_invalid;
    IF v_invalid THEN RAISE EXCEPTION 'GOODS_RECEIPT_PURCHASE_ORDER_VALIDATION_FAILED'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION ristoairen.validate_supplier_price()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_supplier_item uuid;
DECLARE v_cost numeric(18,6);
DECLARE v_currency text;
DECLARE v_effective timestamptz;
DECLARE v_environment text;
DECLARE v_identity uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
DECLARE v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
BEGIN
  SELECT pol.supplier_item_id,grl.unit_cost_actual,po.currency,gr.received_at,gr.environment_class
    INTO v_supplier_item,v_cost,v_currency,v_effective,v_environment
    FROM ristoairen.goods_receipt_lines grl
    JOIN ristoairen.goods_receipts gr
      ON gr.tenant_id=grl.tenant_id AND gr.location_id=grl.location_id AND gr.id=grl.goods_receipt_id
    JOIN ristoairen.purchase_order_lines pol
      ON pol.tenant_id=grl.tenant_id AND pol.location_id=grl.location_id AND pol.id=grl.purchase_order_line_id
    JOIN ristoairen.purchase_orders po
      ON po.tenant_id=pol.tenant_id AND po.location_id=pol.location_id AND po.id=pol.purchase_order_id
   WHERE grl.tenant_id=NEW.tenant_id AND grl.id=NEW.source_entity_id AND gr.status='CONFIRMED';
  IF v_supplier_item IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PRICE_REQUIRES_CONFIRMED_PO_RECEIPT_LINE'; END IF;
  IF NEW.supplier_item_id<>v_supplier_item OR NEW.unit_cost<>v_cost OR NEW.currency<>v_currency
     OR NEW.effective_at<>v_effective OR NEW.environment_class<>v_environment THEN
    RAISE EXCEPTION 'SUPPLIER_PRICE_SOURCE_MISMATCH';
  END IF;
  IF v_identity IS NULL OR NEW.recorded_by_identity_id<>v_identity THEN RAISE EXCEPTION 'SUPPLIER_PRICE_ACTOR_SCOPE_MISMATCH'; END IF;
  IF v_correlation IS NULL OR NEW.correlation_id<>v_correlation THEN RAISE EXCEPTION 'SUPPLIER_PRICE_CORRELATION_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_supplier_price_validate
BEFORE INSERT ON ristoairen.supplier_prices
FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_supplier_price();

CREATE OR REPLACE FUNCTION ristoairen.guard_purchase_order_receiving_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_line_count integer;
DECLARE v_any_received boolean;
DECLARE v_all_received boolean;
BEGIN
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.location_id<>OLD.location_id OR NEW.supplier_id<>OLD.supplier_id
     OR NEW.order_number<>OLD.order_number OR NEW.order_date<>OLD.order_date
     OR NEW.expected_delivery_at IS DISTINCT FROM OLD.expected_delivery_at OR NEW.currency<>OLD.currency
     OR NEW.subtotal<>OLD.subtotal OR NEW.tax_total IS DISTINCT FROM OLD.tax_total OR NEW.total<>OLD.total
     OR NEW.created_by_identity_id<>OLD.created_by_identity_id OR NEW.approved_by_identity_id IS DISTINCT FROM OLD.approved_by_identity_id
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.source_type<>OLD.source_type
     OR NEW.source_suggestion_id IS DISTINCT FROM OLD.source_suggestion_id OR NEW.environment_class<>OLD.environment_class
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_RECEIVING_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.status NOT IN ('APPROVED','SENT','PARTIALLY_RECEIVED') OR NEW.status NOT IN ('PARTIALLY_RECEIVED','RECEIVED')
     OR NEW.row_version<>OLD.row_version+1 THEN
    RAISE EXCEPTION 'PURCHASE_ORDER_INVALID_RECEIVING_TRANSITION';
  END IF;
  SELECT count(*)::int,
         bool_or(COALESCE(r.received,0)>0),
         bool_and(COALESCE(r.received,0)=pol.quantity_ordered)
    INTO v_line_count,v_any_received,v_all_received
    FROM ristoairen.purchase_order_lines pol
    LEFT JOIN (
      SELECT grl.purchase_order_line_id,sum(grl.quantity_received) AS received
        FROM ristoairen.goods_receipt_lines grl
        JOIN ristoairen.goods_receipts gr
          ON gr.tenant_id=grl.tenant_id AND gr.location_id=grl.location_id AND gr.id=grl.goods_receipt_id
       WHERE grl.tenant_id=NEW.tenant_id AND grl.location_id=NEW.location_id AND gr.status='CONFIRMED'
       GROUP BY grl.purchase_order_line_id
    ) r ON r.purchase_order_line_id=pol.id
   WHERE pol.tenant_id=NEW.tenant_id AND pol.location_id=NEW.location_id AND pol.purchase_order_id=NEW.id;
  IF v_line_count=0 OR v_any_received IS DISTINCT FROM true THEN RAISE EXCEPTION 'PURCHASE_ORDER_RECEIVING_REQUIRES_CONFIRMED_QUANTITY'; END IF;
  IF NEW.status='RECEIVED' AND v_all_received IS DISTINCT FROM true THEN RAISE EXCEPTION 'PURCHASE_ORDER_NOT_FULLY_RECEIVED'; END IF;
  IF NEW.status='PARTIALLY_RECEIVED' AND v_all_received IS true THEN RAISE EXCEPTION 'PURCHASE_ORDER_PARTIAL_STATUS_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_purchase_order_receiving_guard
BEFORE UPDATE ON ristoairen.purchase_orders
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_purchase_order_receiving_update();

ALTER TABLE ristoairen.supplier_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.supplier_items FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.purchase_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.purchase_order_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.supplier_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.supplier_prices FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_supplier_item_tenant_policy ON ristoairen.supplier_items FOR SELECT TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);
CREATE POLICY risto_purchase_order_scope_policy ON ristoairen.purchase_orders FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid);
CREATE POLICY risto_purchase_order_line_scope_policy ON ristoairen.purchase_order_lines FOR SELECT TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid AND location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid);
CREATE POLICY risto_supplier_price_tenant_policy ON ristoairen.supplier_prices FOR ALL TO airen_app
  USING (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid);

REVOKE ALL ON ristoairen.supplier_items,ristoairen.purchase_orders,ristoairen.purchase_order_lines,ristoairen.supplier_prices FROM airen_app;
GRANT SELECT ON ristoairen.supplier_items,ristoairen.purchase_orders,ristoairen.purchase_order_lines TO airen_app;
GRANT UPDATE(status,row_version,updated_at) ON ristoairen.purchase_orders TO airen_app;
GRANT SELECT,INSERT ON ristoairen.supplier_prices TO airen_app;

COMMIT;
