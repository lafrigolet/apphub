-- Reminder idempotency columns. The scheduler stamps these inside the same
-- UPDATE that selects rows due for a reminder, so re-runs of the cron tick
-- never re-emit booking.reminder.due for the same booking + window.

ALTER TABLE platform_bookings.bookings
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_bookings_due_24h
  ON platform_bookings.bookings (starts_at)
  WHERE reminder_24h_sent_at IS NULL AND status IN ('confirmed','reminded');
CREATE INDEX IF NOT EXISTS idx_platform_bookings_due_2h
  ON platform_bookings.bookings (starts_at)
  WHERE reminder_2h_sent_at IS NULL AND status IN ('confirmed','reminded');
