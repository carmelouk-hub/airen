-- RISTO-MAT-028 / GJ2-022 — Inventory Transfer Atomicity Runtime
-- Extends the MAT-027 stock ledger without creating a parallel stock authority.
BEGIN;

INSERT INTO authz.permission_registry(permission_key,description,sensitivity)
VALUES
  ('inventory.transfer.create','Create and edit a governed inventory transfer draft','high'),
  ('inventory.transfer.approve','Approve/post a governed inventory transfer','high')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE ristoairen.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  from_location_id uuid NOT NULL,
  to_location_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  source_request_key text NOT NULL CHECK (length(btrim(source_request_key)) BETWEEN 1 AND 200),
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  posted_by_identity_id uuid REFERENCES identity.identities(id),
  created_correlation_id text NOT NULL CHECK (length(btrim(created_correlation_id)) BETWEEN 1 AND 240),
  posted_correlation_id text,
  posted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_stock_transfer_from_location FOREIGN KEY (tenant_id,from_location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_risto_stock_transfer_to_location FOREIGN KEY (tenant_id,to_location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT ck_risto_stock_transfer_distinct_locations CHECK (from_location_id<>to_location_id),
  CONSTRAINT ck_risto_stock_transfer_state CHECK (
    (status='DRAFT' AND posted_by_identity_id IS NULL AND posted_correlation_id IS NULL AND posted_at IS NULL)
    OR
    (status='POSTED' AND posted_by_identity_id IS NOT NULL AND posted_correlation_id IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT uq_risto_stock_transfer_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_stock_transfer_request UNIQUE (tenant_id,from_location_id,source_request_key)
);

CREATE TABLE ristoairen.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  stock_transfer_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  uom_id uuid NOT NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  source_line_key text NOT NULL CHECK (length(btrim(source_line_key)) BETWEEN 1 AND 200),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  environment_class text NOT NULL CHECK (environment_class IN ('DEMO','SANDBOX','TEST_TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_risto_stock_transfer_line_parent FOREIGN KEY (tenant_id,stock_transfer_id)
    REFERENCES ristoairen.stock_transfers(tenant_id,id),
  CONSTRAINT fk_risto_stock_transfer_line_ingredient FOREIGN KEY (tenant_id,ingredient_id)
    REFERENCES ristoairen.ingredients(tenant_id,id),
  CONSTRAINT fk_risto_stock_transfer_line_uom FOREIGN KEY (tenant_id,uom_id)
    REFERENCES ristoairen.units_of_measure(tenant_id,id),
  CONSTRAINT uq_risto_stock_transfer_line_scope_id UNIQUE (tenant_id,id),
  CONSTRAINT uq_risto_stock_transfer_line_request UNIQUE (tenant_id,stock_transfer_id,source_line_key)
);

CREATE OR REPLACE FUNCTION ristoairen.guard_stock_transfer_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_from_status text;
DECLARE v_to_status text;
DECLARE v_identity uuid := NULLIF(current_setting('airen.identity_id',true),'')::uuid;
DECLARE v_correlation text := NULLIF(current_setting('airen.correlation_id',true),'');
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT status INTO v_from_status FROM platform.locations
     WHERE tenant_id=NEW.tenant_id AND id=NEW.from_location_id;
    SELECT status INTO v_to_status FROM platform.locations
     WHERE tenant_id=NEW.tenant_id AND id=NEW.to_location_id;
    IF v_from_status IS DISTINCT FROM 'active' OR v_to_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'STOCK_TRANSFER_REQUIRES_ACTIVE_LOCATIONS';
    END IF;
    IF v_identity IS NULL OR NEW.created_by_identity_id<>v_identity THEN
      RAISE EXCEPTION 'STOCK_TRANSFER_ACTOR_SCOPE_MISMATCH';
    END IF;
    IF v_correlation IS NULL OR NEW.created_correlation_id<>v_correlation THEN
      RAISE EXCEPTION 'STOCK_TRANSFER_CORRELATION_SCOPE_MISMATCH';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status='POSTED' THEN RAISE EXCEPTION 'POSTED_STOCK_TRANSFER_IMMUTABLE'; END IF;
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.from_location_id<>OLD.from_location_id OR NEW.to_location_id<>OLD.to_location_id
     OR NEW.source_request_key<>OLD.source_request_key OR NEW.created_by_identity_id<>OLD.created_by_identity_id
     OR NEW.created_correlation_id<>OLD.created_correlation_id OR NEW.environment_class<>OLD.environment_class
     OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'STOCK_TRANSFER_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.status<>'POSTED' OR NEW.posted_at IS NULL OR NEW.posted_by_identity_id IS NULL
     OR NEW.posted_correlation_id IS NULL OR NEW.row_version<>OLD.row_version+1 THEN
    RAISE EXCEPTION 'STOCK_TRANSFER_INVALID_POST';
  END IF;
  IF v_identity IS NULL OR NEW.posted_by_identity_id<>v_identity THEN
    RAISE EXCEPTION 'STOCK_TRANSFER_POST_ACTOR_SCOPE_MISMATCH';
  END IF;
  IF v_correlation IS NULL OR NEW.posted_correlation_id<>v_correlation THEN
    RAISE EXCEPTION 'STOCK_TRANSFER_POST_CORRELATION_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_stock_transfer_guard
BEFORE INSERT OR UPDATE ON ristoairen.stock_transfers
FOR EACH ROW EXECUTE FUNCTION ristoairen.guard_stock_transfer_write();

CREATE OR REPLACE FUNCTION ristoairen.validate_stock_transfer_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
DECLARE v_environment text;
DECLARE v_base_uom uuid;
DECLARE v_active boolean;
BEGIN
  SELECT status,environment_class INTO v_status,v_environment
    FROM ristoairen.stock_transfers
   WHERE tenant_id=NEW.tenant_id AND id=NEW.stock_transfer_id;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'STOCK_TRANSFER_LINE_REQUIRES_DRAFT'; END IF;
  IF v_environment IS DISTINCT FROM NEW.environment_class THEN RAISE EXCEPTION 'STOCK_TRANSFER_LINE_ENVIRONMENT_MISMATCH'; END IF;
  SELECT base_uom_id,active INTO v_base_uom,v_active
    FROM ristoairen.ingredients WHERE tenant_id=NEW.tenant_id AND id=NEW.ingredient_id;
  IF v_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'STOCK_TRANSFER_LINE_REQUIRES_ACTIVE_INGREDIENT'; END IF;
  IF v_base_uom IS DISTINCT FROM NEW.uom_id THEN RAISE EXCEPTION 'STOCK_TRANSFER_LINE_REQUIRES_BASE_UOM'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_risto_stock_transfer_line_validate
BEFORE INSERT ON ristoairen.stock_transfer_lines
FOR EACH ROW EXECUTE FUNCTION ristoairen.validate_stock_transfer_line();

-- MAT-027 created a receipt-only movement shape. Expand the same canonical ledger.
ALTER TABLE ristoairen.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check,
  DROP CONSTRAINT IF EXISTS stock_movements_quantity_delta_check,
  DROP CONSTRAINT IF EXISTS stock_movements_base_quantity_delta_check,
  DROP CONSTRAINT IF EXISTS stock_movements_source_entity_type_check,
  DROP CONSTRAINT IF EXISTS fk_risto_stock_movement_source_line;

ALTER TABLE ristoairen.stock_movements
  ADD CONSTRAINT ck_risto_stock_movement_type
    CHECK (movement_type IN ('RECEIPT','TRANSFER_OUT','TRANSFER_IN')),
  ADD CONSTRAINT ck_risto_stock_movement_nonzero
    CHECK (quantity_delta<>0 AND base_quantity_delta<>0),
  ADD CONSTRAINT ck_risto_stock_movement_base_uom_quantity
    CHECK (quantity_delta=base_quantity_delta),
  ADD CONSTRAINT ck_risto_stock_movement_source_type
    CHECK (
      (movement_type='RECEIPT' AND source_entity_type='GoodsReceiptLine' AND quantity_delta>0)
      OR (movement_type='TRANSFER_OUT' AND source_entity_type='StockTransferLine' AND quantity_delta<0)
      OR (movement_type='TRANSFER_IN' AND source_entity_type='StockTransferLine' AND quantity_delta>0)
    );

CREATE OR REPLACE FUNCTION ristoairen.validate_receipt_stock_movement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_receipt_status text;
DECLARE v_line_ingredient uuid;
DECLARE v_line_uom uuid;
DECLARE v_line_quantity numeric(18,6);
DECLARE v_transfer_status text;
DECLARE v_from_location uuid;
DECLARE v_to_location uuid;
DECLARE v_posted_correlation text;
DECLARE v_transfer_environment text;
DECLARE v_expected_key text;
BEGIN
  IF NEW.source_entity_type='GoodsReceiptLine' THEN
    SELECT r.status,l.ingredient_id,l.uom_id,l.quantity_received
      INTO v_receipt_status,v_line_ingredient,v_line_uom,v_line_quantity
      FROM ristoairen.goods_receipt_lines l
      JOIN ristoairen.goods_receipts r
        ON r.tenant_id=l.tenant_id AND r.location_id=l.location_id AND r.id=l.goods_receipt_id
     WHERE l.tenant_id=NEW.tenant_id AND l.location_id=NEW.location_id AND l.id=NEW.source_entity_id;
    IF v_receipt_status IS DISTINCT FROM 'CONFIRMED' THEN
      RAISE EXCEPTION 'STOCK_MOVEMENT_REQUIRES_CONFIRMED_RECEIPT';
    END IF;
    IF NEW.movement_type<>'RECEIPT' OR NEW.ingredient_id<>v_line_ingredient OR NEW.uom_id<>v_line_uom
       OR NEW.quantity_delta<>v_line_quantity OR NEW.base_quantity_delta<>v_line_quantity THEN
      RAISE EXCEPTION 'STOCK_MOVEMENT_SOURCE_MISMATCH';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_entity_type='StockTransferLine' THEN
    SELECT t.status,t.from_location_id,t.to_location_id,t.posted_correlation_id,t.environment_class,
           l.ingredient_id,l.uom_id,l.quantity
      INTO v_transfer_status,v_from_location,v_to_location,v_posted_correlation,v_transfer_environment,
           v_line_ingredient,v_line_uom,v_line_quantity
      FROM ristoairen.stock_transfer_lines l
      JOIN ristoairen.stock_transfers t ON t.tenant_id=l.tenant_id AND t.id=l.stock_transfer_id
     WHERE l.tenant_id=NEW.tenant_id AND l.id=NEW.source_entity_id;
    IF v_transfer_status IS DISTINCT FROM 'POSTED' THEN RAISE EXCEPTION 'STOCK_MOVEMENT_REQUIRES_POSTED_TRANSFER'; END IF;
    IF NEW.ingredient_id<>v_line_ingredient OR NEW.uom_id<>v_line_uom OR NEW.environment_class<>v_transfer_environment
       OR NEW.correlation_id IS DISTINCT FROM v_posted_correlation THEN
      RAISE EXCEPTION 'STOCK_TRANSFER_MOVEMENT_SOURCE_MISMATCH';
    END IF;
    IF NEW.movement_type='TRANSFER_OUT' THEN
      IF NEW.location_id<>v_from_location OR NEW.quantity_delta<>-v_line_quantity OR NEW.base_quantity_delta<>-v_line_quantity THEN
        RAISE EXCEPTION 'STOCK_TRANSFER_OUT_MISMATCH';
      END IF;
      v_expected_key:='stock-transfer:'||(SELECT stock_transfer_id::text FROM ristoairen.stock_transfer_lines WHERE tenant_id=NEW.tenant_id AND id=NEW.source_entity_id)||':line:'||NEW.source_entity_id::text||':out';
    ELSIF NEW.movement_type='TRANSFER_IN' THEN
      IF NEW.location_id<>v_to_location OR NEW.quantity_delta<>v_line_quantity OR NEW.base_quantity_delta<>v_line_quantity THEN
        RAISE EXCEPTION 'STOCK_TRANSFER_IN_MISMATCH';
      END IF;
      v_expected_key:='stock-transfer:'||(SELECT stock_transfer_id::text FROM ristoairen.stock_transfer_lines WHERE tenant_id=NEW.tenant_id AND id=NEW.source_entity_id)||':line:'||NEW.source_entity_id::text||':in';
    ELSE
      RAISE EXCEPTION 'STOCK_TRANSFER_MOVEMENT_TYPE_MISMATCH';
    END IF;
    IF NEW.idempotency_key<>v_expected_key THEN RAISE EXCEPTION 'STOCK_TRANSFER_MOVEMENT_IDEMPOTENCY_MISMATCH'; END IF;
    IF NEW.reason_code<>'STOCK_TRANSFER_POSTED' THEN RAISE EXCEPTION 'STOCK_TRANSFER_MOVEMENT_REASON_MISMATCH'; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'STOCK_MOVEMENT_UNKNOWN_SOURCE_TYPE';
END $$;

CREATE OR REPLACE FUNCTION ristoairen.project_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ristoairen
AS $$
DECLARE v_base_uom uuid;
DECLARE v_current numeric(18,6);
DECLARE v_item_uom uuid;
DECLARE v_item_environment text;
DECLARE v_next numeric(18,6);
BEGIN
  SELECT base_uom_id INTO v_base_uom
    FROM ristoairen.ingredients WHERE tenant_id=NEW.tenant_id AND id=NEW.ingredient_id;
  IF v_base_uom IS NULL OR NEW.uom_id<>v_base_uom THEN RAISE EXCEPTION 'STOCK_MOVEMENT_UOM_NOT_BASE_UOM'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'risto:stock:'||NEW.tenant_id::text||':'||NEW.location_id::text||':'||NEW.ingredient_id::text,0));

  SELECT on_hand_quantity,base_uom_id,environment_class
    INTO v_current,v_item_uom,v_item_environment
    FROM ristoairen.stock_items
   WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND ingredient_id=NEW.ingredient_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_item_uom<>NEW.uom_id OR v_item_environment<>NEW.environment_class THEN
      RAISE EXCEPTION 'STOCK_ITEM_PROJECTION_SCOPE_MISMATCH';
    END IF;
    v_next:=v_current+NEW.base_quantity_delta;
    IF v_next<0 THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;
    UPDATE ristoairen.stock_items
       SET on_hand_quantity=v_next,
           last_movement_at=CASE WHEN last_movement_at IS NULL OR last_movement_at<NEW.occurred_at THEN NEW.occurred_at ELSE last_movement_at END,
           updated_at=NEW.posted_at
     WHERE tenant_id=NEW.tenant_id AND location_id=NEW.location_id AND ingredient_id=NEW.ingredient_id;
  ELSE
    IF NEW.base_quantity_delta<0 THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;
    INSERT INTO ristoairen.stock_items
      (tenant_id,location_id,ingredient_id,on_hand_quantity,reserved_quantity,base_uom_id,last_movement_at,active,environment_class,created_at,updated_at)
    VALUES
      (NEW.tenant_id,NEW.location_id,NEW.ingredient_id,NEW.base_quantity_delta,0,NEW.uom_id,NEW.occurred_at,true,NEW.environment_class,NEW.posted_at,NEW.posted_at);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION ristoairen.project_stock_movement() FROM PUBLIC;

ALTER TABLE ristoairen.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.stock_transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.stock_transfer_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY risto_stock_transfer_scope_policy ON ristoairen.stock_transfers FOR ALL TO airen_app
  USING (
    tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
    AND (from_location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid OR to_location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
  )
  WITH CHECK (
    tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
    AND (from_location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid OR to_location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
  );

CREATE POLICY risto_stock_transfer_line_scope_policy ON ristoairen.stock_transfer_lines FOR ALL TO airen_app
  USING (
    tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM ristoairen.stock_transfers t
       WHERE t.tenant_id=stock_transfer_lines.tenant_id AND t.id=stock_transfer_lines.stock_transfer_id
         AND (t.from_location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid OR t.to_location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
    )
  )
  WITH CHECK (
    tenant_id=NULLIF(current_setting('airen.tenant_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM ristoairen.stock_transfers t
       WHERE t.tenant_id=stock_transfer_lines.tenant_id AND t.id=stock_transfer_lines.stock_transfer_id
         AND (t.from_location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid OR t.to_location_id=NULLIF(current_setting('airen.location_id',true),'')::uuid)
    )
  );

REVOKE ALL ON ristoairen.stock_transfers,ristoairen.stock_transfer_lines FROM airen_app;
GRANT SELECT,INSERT,UPDATE ON ristoairen.stock_transfers TO airen_app;
GRANT SELECT,INSERT ON ristoairen.stock_transfer_lines TO airen_app;

COMMIT;
