-- services upgrades:
--   1. Photo gallery — references platform_storage.objects.id (one row per
--      image, ordered) so a service's PDP can render multiple shots.
--   2. Pricing tiers — overrides on price_cents based on day-of-week +
--      time-of-day window. Engine in service code resolves the applicable
--      tier when booking; falls back to the row-level price_cents if no tier
--      matches.

-- 1. Photo gallery -------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_services.service_images (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  service_id      UUID         NOT NULL REFERENCES platform_services.services(id) ON DELETE CASCADE,
  object_id       UUID         NOT NULL,                         -- platform_storage.objects.id
  alt_text        TEXT,
  display_order   INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_services_images_service
  ON platform_services.service_images (service_id, display_order);

ALTER TABLE platform_services.service_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_services.service_images FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_services_images_isolation ON platform_services.service_images
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_services.service_images
  TO svc_platform_services;


-- 2. Pricing tiers --------------------------------------------------------
-- A tier matches when:
--   day_of_week ∈ days_of_week (or null = any day)
--   AND start_minute ≤ booking_minute_of_day < end_minute  (or null window = any time)
-- The engine picks the most specific tier (smallest match window) so e.g. a
-- "Friday 18:00-22:00" tier wins over a "weekday afternoon" tier.
CREATE TABLE IF NOT EXISTS platform_services.service_pricing_tiers (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            TEXT         NOT NULL,
  tenant_id         UUID         NOT NULL,
  service_id        UUID         NOT NULL REFERENCES platform_services.services(id) ON DELETE CASCADE,
  label             TEXT         NOT NULL,
  days_of_week      INT[],                                -- 0=Sun .. 6=Sat. NULL = any day.
  start_minute      INT,                                  -- minute-of-day (0..1440). NULL = any time.
  end_minute        INT,
  price_cents       BIGINT       NOT NULL CHECK (price_cents >= 0),
  enabled           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (start_minute IS NULL OR (start_minute >= 0 AND start_minute <= 1440)),
  CHECK (end_minute   IS NULL OR (end_minute   >= 0 AND end_minute   <= 1440)),
  CHECK ((start_minute IS NULL) = (end_minute IS NULL)),
  CHECK (start_minute IS NULL OR start_minute < end_minute)
);

CREATE INDEX IF NOT EXISTS idx_platform_services_pricing_service
  ON platform_services.service_pricing_tiers (service_id, enabled);

ALTER TABLE platform_services.service_pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_services.service_pricing_tiers FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_services_pricing_isolation ON platform_services.service_pricing_tiers
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_services.service_pricing_tiers
  TO svc_platform_services;
