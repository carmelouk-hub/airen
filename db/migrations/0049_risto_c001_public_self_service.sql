-- RISTO-MAT-041 / C001 — public self-service ownership boundary.
-- AIRen Booking remains the sole mutable Booking authority; GuestQueueEntry remains the sole Queue aggregate.
-- This migration adds only the fixed technical service identity and Booking credential invariants.
BEGIN;

DO $$
DECLARE
  existing identity.identities%ROWTYPE;
BEGIN
  SELECT * INTO existing
  FROM identity.identities
  WHERE id = 'c0010000-0000-4000-8000-000000000001'::uuid;

  IF FOUND THEN
    IF existing.display_name IS DISTINCT FROM 'RISTOAIREN Public Self-Service'
       OR existing.status IS DISTINCT FROM 'active'
       OR existing.primary_email IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'MAT-041 C001 technical identity collision';
    END IF;
  ELSE
    INSERT INTO identity.identities (id, display_name, primary_email, status)
    VALUES (
      'c0010000-0000-4000-8000-000000000001'::uuid,
      'RISTOAIREN Public Self-Service',
      NULL,
      'active'
    );
  END IF;
END $$;

ALTER TABLE public.risto_bookings
  DROP CONSTRAINT IF EXISTS ck_risto_bookings_public_self_service_credential;

ALTER TABLE public.risto_bookings
  ADD CONSTRAINT ck_risto_bookings_public_self_service_credential
  CHECK (
    source <> 'RISTOAIREN_PUBLIC_SELF_SERVICE'
    OR external_reference ~ '^[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_risto_bookings_public_self_service_credential
  ON public.risto_bookings (tenant_id, location_id, external_reference)
  WHERE source = 'RISTOAIREN_PUBLIC_SELF_SERVICE'
    AND external_reference IS NOT NULL;

COMMIT;
