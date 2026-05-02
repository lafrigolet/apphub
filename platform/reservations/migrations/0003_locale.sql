-- Per-reservation locale captured at create time. Optional — when null, the
-- scheduler reminder job falls back to the tenant's default_locale and then
-- to 'es'.
ALTER TABLE platform_reservations.reservations
  ADD COLUMN IF NOT EXISTS locale TEXT;
