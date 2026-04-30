-- Reminder idempotency columns for restaurant reservations. Same pattern as
-- bookings — stamp inside the SELECT-UPDATE so re-runs are no-ops.

ALTER TABLE platform_reservations.reservations
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_reservations_due_24h
  ON platform_reservations.reservations (reserved_for)
  WHERE reminder_24h_sent_at IS NULL AND status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_platform_reservations_due_2h
  ON platform_reservations.reservations (reserved_for)
  WHERE reminder_2h_sent_at IS NULL AND status = 'confirmed';
