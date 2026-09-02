-- Gate E — Direct Booking E2E guarantee transition idempotency namespace.
-- Additive only: preserves every historical RISTOAIREN and AIRen Booking identifier.
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
    'AIREN-F-BKG-HOLD-004',
    'AIREN-F-BKG-HOLD-005',
    'RST-F-BKG-001',
    'RST-F-BKG-002',
    'RST-F-BKG-003',
    'RST-F-BKG-HOLD-001',
    'RST-F-BKG-HOLD-002',
    'RST-F-BKG-HOLD-003'
  ));

COMMIT;
