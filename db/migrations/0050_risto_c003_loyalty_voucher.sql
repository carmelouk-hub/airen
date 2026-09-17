-- RISTO-MAT-041 / C003 — Loyalty/Voucher public self-service
-- Guest commercial value is deliberately separate from AIRenOS product entitlements.
BEGIN;

CREATE TABLE ristoairen.customer_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  credential_hash text NOT NULL CHECK (length(credential_hash)=64),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_customer_pass_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT uq_customer_pass_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_customer_pass_credential UNIQUE (tenant_id,location_id,credential_hash)
);

CREATE TABLE ristoairen.loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  customer_pass_id uuid NOT NULL,
  entry_kind text NOT NULL CHECK (entry_kind IN ('EARN','REDEEM','ADJUST')),
  points_delta integer NOT NULL CHECK (points_delta <> 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 240),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  actor_identity_id uuid NOT NULL,
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_loyalty_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_loyalty_pass FOREIGN KEY (tenant_id,location_id,customer_pass_id)
    REFERENCES ristoairen.customer_passes(tenant_id,location_id,id),
  CONSTRAINT uq_loyalty_idem UNIQUE (tenant_id,location_id,idempotency_key)
);

CREATE TABLE ristoairen.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  customer_pass_id uuid NOT NULL,
  public_reference text NOT NULL CHECK (length(btrim(public_reference)) BETWEEN 6 AND 80),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT fk_voucher_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_voucher_pass FOREIGN KEY (tenant_id,location_id,customer_pass_id)
    REFERENCES ristoairen.customer_passes(tenant_id,location_id,id),
  CONSTRAINT uq_voucher_scope_id UNIQUE (tenant_id,location_id,id),
  CONSTRAINT uq_voucher_public_reference UNIQUE (tenant_id,location_id,public_reference)
);

CREATE TABLE ristoairen.voucher_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  location_id uuid NOT NULL,
  voucher_id uuid NOT NULL,
  entry_kind text NOT NULL CHECK (entry_kind IN ('ISSUE','REDEEM','CANCEL')),
  value_delta_minor integer NOT NULL CHECK (value_delta_minor <> 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 240),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  actor_identity_id uuid NOT NULL,
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_voucher_ledger_location FOREIGN KEY (tenant_id,location_id)
    REFERENCES platform.locations(tenant_id,id),
  CONSTRAINT fk_voucher_ledger_voucher FOREIGN KEY (tenant_id,location_id,voucher_id)
    REFERENCES ristoairen.vouchers(tenant_id,location_id,id),
  CONSTRAINT uq_voucher_ledger_idem UNIQUE (tenant_id,location_id,idempotency_key)
);

CREATE INDEX idx_customer_pass_credential ON ristoairen.customer_passes(tenant_id,location_id,credential_hash) WHERE status='ACTIVE';
CREATE INDEX idx_loyalty_pass ON ristoairen.loyalty_ledger(tenant_id,location_id,customer_pass_id,created_at,id);
CREATE INDEX idx_voucher_pass ON ristoairen.vouchers(tenant_id,location_id,customer_pass_id,created_at,id);
CREATE INDEX idx_voucher_ledger_voucher ON ristoairen.voucher_ledger(tenant_id,location_id,voucher_id,created_at,id);

ALTER TABLE ristoairen.customer_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.customer_passes FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.loyalty_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.loyalty_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.voucher_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ristoairen.voucher_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY customer_pass_scope ON ristoairen.customer_passes FOR ALL TO airen_app
USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id())
WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY loyalty_ledger_scope ON ristoairen.loyalty_ledger FOR ALL TO airen_app
USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id())
WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY voucher_scope ON ristoairen.vouchers FOR ALL TO airen_app
USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id())
WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());
CREATE POLICY voucher_ledger_scope ON ristoairen.voucher_ledger FOR ALL TO airen_app
USING (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id())
WITH CHECK (tenant_id=security.current_tenant_id() AND location_id=security.current_location_id());

REVOKE ALL ON ristoairen.customer_passes, ristoairen.loyalty_ledger, ristoairen.vouchers, ristoairen.voucher_ledger FROM airen_app;
GRANT SELECT,INSERT ON ristoairen.customer_passes TO airen_app;
GRANT SELECT,INSERT ON ristoairen.loyalty_ledger TO airen_app;
GRANT SELECT,INSERT ON ristoairen.vouchers TO airen_app;
GRANT SELECT,INSERT ON ristoairen.voucher_ledger TO airen_app;

COMMIT;
