-- RISTO-MAT-041 / C001 Booking authority reconciliation — Phase A
-- Additive only. AIRen Booking / public.risto_bookings remains the single mutable Booking authority.
-- Historical migration 0044 and ristoairen.bookings are preserved as certified history/legacy compatibility.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ristoairen.bookings LIMIT 1) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'MAT-041 booking authority reconciliation blocked: legacy ristoairen.bookings contains rows';
  END IF;
END
$$;

-- Existing queue/service composite foreign keys require a canonical scoped candidate key.
-- The canonical id remains globally primary-keyed; this additive key exists only for scoped FK integrity.
ALTER TABLE public.risto_bookings
  ADD CONSTRAINT uq_risto_booking_canonical_scope_id
  UNIQUE (tenant_id, location_id, id);

ALTER TABLE ristoairen.guest_queue_entries
  DROP CONSTRAINT fk_risto_guest_queue_booking;
ALTER TABLE ristoairen.guest_queue_entries
  ADD CONSTRAINT fk_risto_guest_queue_booking
  FOREIGN KEY (tenant_id, location_id, booking_id)
  REFERENCES public.risto_bookings (tenant_id, location_id, id);

ALTER TABLE ristoairen.service_sessions
  DROP CONSTRAINT fk_risto_service_session_booking;
ALTER TABLE ristoairen.service_sessions
  ADD CONSTRAINT fk_risto_service_session_booking
  FOREIGN KEY (tenant_id, location_id, booking_id)
  REFERENCES public.risto_bookings (tenant_id, location_id, id);

-- Preserve read compatibility while removing all application-runtime mutation authority
-- from the historical MAT-039 Booking ledger. The table is deliberately not dropped.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ristoairen.bookings FROM airen_app;
GRANT SELECT ON TABLE ristoairen.bookings TO airen_app;

COMMIT;
