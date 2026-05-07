-- Per-booking locale captured at create time. Optional — when null, the
-- scheduler reminder job falls back to the tenant's default_locale and then
-- to 'es'. Lets a single tenant serve mixed-locale clients without UI gymnastics.
ALTER TABLE platform_bookings.bookings
  ADD COLUMN IF NOT EXISTS locale TEXT;
