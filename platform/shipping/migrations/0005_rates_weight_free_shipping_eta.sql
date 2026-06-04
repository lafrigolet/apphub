-- Shipping priority upgrades (backend-only):
--   1. Free-shipping threshold on rates: when the order subtotal reaches
--      free_above_cents, the rate is quoted at price_cents = 0.
--   2. service_level on rates (economy/standard/express/overnight) — an
--      explicit dimension for presenting carrier speed tiers.
--   3. active flag on rates — disable a rate without deleting it.
--   4. estimated_delivery_date persisted on the shipment — the concrete ETA
--      computed at creation time (rate ETA days + business-day offset).
--
-- Columns added with ALTER ... ADD COLUMN IF NOT EXISTS inherit the table's
-- existing GRANTs and RLS policies, so no extra grant/policy statements are
-- needed here.

-- 1-3. shipping_rates ---------------------------------------------------
ALTER TABLE platform_shipping.shipping_rates
  ADD COLUMN IF NOT EXISTS free_above_cents BIGINT
    CHECK (free_above_cents IS NULL OR free_above_cents >= 0),
  ADD COLUMN IF NOT EXISTS service_level TEXT NOT NULL DEFAULT 'standard'
    CHECK (service_level IN ('economy', 'standard', 'express', 'overnight', 'in_store_pickup')),
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- 4. shipments ----------------------------------------------------------
ALTER TABLE platform_shipping.shipments
  ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE;
