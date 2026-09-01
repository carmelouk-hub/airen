-- AB-03 — AIRen Booking product-neutral canonical idempotency namespace.
-- Additive compatibility migration: new AIRenOS identifiers are authoritative for
-- new mutations while historical RISTOAIREN identifiers remain valid for replay.
BEGIN;

ALTER TABLE foundation_idempotency_keys
  DROP CONSTRAINT IF EXISTS foundation_idempotency_keys_canonical_function_id_check;

ALTER TABLE foundation_idempotency_keys
  ADD CONSTRAINT foundation_idempotency_keys_canonical_function_id_check
  CHECK (canonical_function_id IN (
    'AIREN-F-BKG-001',
    'AIREN-F-BKG-002',
    'AIREN-F-BKG-003',
    'AIREN-F-BKG-HOLD-001',
    'AIREN-F-BKG-HOLD-002',
    'AIREN-F-BKG-HOLD-003',
    'RST-F-BKG-001',
    'RST-F-BKG-002',
    'RST-F-BKG-003',
    'RST-F-BKG-HOLD-001',
    'RST-F-BKG-HOLD-002',
    'RST-F-BKG-HOLD-003'
  ));

COMMIT;
