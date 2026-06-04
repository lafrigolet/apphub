-- Three priority backend-only upgrades to platform_services:
--
--   1. Booking window per service — min_advance_minutes / max_advance_days.
--      Lets a tenant forbid last-minute bookings ("not within 2h") and
--      cap how far ahead a service can be booked ("at most 30 days").
--      platform/services only STORES + VALIDATES these limits; the actual
--      rejection at booking time is enforced by platform/bookings (it
--      reads the service row). We expose a pure check helper + endpoint so
--      bookings (and portals) can ask "is this start ok?".
--
--   2. cancellation_policy validated shape. The column already exists as a
--      free JSONB; we keep it JSONB (no breaking change) but the service
--      layer now validates the canonical shape
--      { hours_before_cancel, refund_pct, no_show_fee_cents } on write.
--      A CHECK guards the numeric ranges defensively at the DB level when
--      the canonical keys are present.
--
--   3. i18n — service_translations (service_id, locale, name, description).
--      The public catalog can now return localized name/description.

-- 1. Booking window ------------------------------------------------------
ALTER TABLE platform_services.services
  ADD COLUMN IF NOT EXISTS min_advance_minutes INT NOT NULL DEFAULT 0
    CHECK (min_advance_minutes >= 0),
  ADD COLUMN IF NOT EXISTS max_advance_days INT
    CHECK (max_advance_days IS NULL OR max_advance_days > 0);

-- 2. cancellation_policy defensive shape guard --------------------------
-- Only constrains rows that adopt the canonical keys; legacy free-form
-- policies (without these keys) remain valid. refund_pct in [0,100],
-- hours_before_cancel >= 0, no_show_fee_cents >= 0.
ALTER TABLE platform_services.services
  ADD CONSTRAINT chk_cancellation_policy_shape CHECK (
    (NOT (cancellation_policy ? 'refund_pct')
       OR ((cancellation_policy->>'refund_pct')::numeric >= 0
           AND (cancellation_policy->>'refund_pct')::numeric <= 100))
    AND
    (NOT (cancellation_policy ? 'hours_before_cancel')
       OR (cancellation_policy->>'hours_before_cancel')::numeric >= 0)
    AND
    (NOT (cancellation_policy ? 'no_show_fee_cents')
       OR (cancellation_policy->>'no_show_fee_cents')::numeric >= 0)
  );

-- 3. service_translations -----------------------------------------------
CREATE TABLE IF NOT EXISTS platform_services.service_translations (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  service_id    UUID         NOT NULL REFERENCES platform_services.services(id) ON DELETE CASCADE,
  -- BCP-47-ish locale tag (e.g. 'es', 'en', 'pt-BR'). Lowercased on write.
  locale        TEXT         NOT NULL CHECK (locale ~ '^[a-z]{2}(-[a-z0-9]{2,8})?$'),
  name          TEXT,
  description   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_services_translations_unique
  ON platform_services.service_translations (app_id, tenant_id, service_id, locale);

ALTER TABLE platform_services.service_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_services.service_translations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_services_translations_isolation ON platform_services.service_translations
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_services.service_translations
  TO svc_platform_services;
