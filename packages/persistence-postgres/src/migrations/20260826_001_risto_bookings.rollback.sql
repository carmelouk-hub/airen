BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM risto_bookings WHERE environment_class <> 'TEST_TEMPORARY') THEN
    RAISE EXCEPTION 'Refusing destructive rollback: non-test Booking rows exist';
  END IF;
END $$;

DELETE FROM foundation_idempotency_keys
 WHERE tenant_id IN (SELECT DISTINCT tenant_id FROM risto_bookings WHERE environment_class='TEST_TEMPORARY');
DELETE FROM risto_bookings WHERE environment_class='TEST_TEMPORARY';

DROP TABLE IF EXISTS foundation_idempotency_keys;
DROP TABLE IF EXISTS risto_bookings;

COMMIT;
