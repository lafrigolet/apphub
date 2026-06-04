-- Availability control + lifecycle metadata for restaurant reservations.
--
-- 1. service_hours.max_covers — per service window seating capacity. NULL means
--    unlimited (legacy behaviour). When set, createReservation rejects requests
--    that would exceed the cap for the overlapping window.
-- 2. reservations.special_requests — structured JSONB (allergens, high chair,
--    accessibility, occasion, seating preference). Free-text `notes` stays.
-- 3. reservations.cancellation_reason / cancelled_by — who cancelled and why,
--    so cancellations are auditable (guest / staff / system).

ALTER TABLE platform_reservations.service_hours
  ADD COLUMN IF NOT EXISTS max_covers INT
    CHECK (max_covers IS NULL OR max_covers > 0);

ALTER TABLE platform_reservations.reservations
  ADD COLUMN IF NOT EXISTS special_requests    JSONB,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by        TEXT
    CHECK (cancelled_by IS NULL OR cancelled_by IN ('guest','staff','system'));

-- Capacity / overlap queries hit the active reservations of a tenant in a time
-- window. The covering index keeps party_size in the index for index-only sums.
CREATE INDEX IF NOT EXISTS idx_platform_reservations_active_window
  ON platform_reservations.reservations (tenant_id, reserved_for)
  INCLUDE (party_size, duration_minutes)
  WHERE status IN ('requested','confirmed','seated');
