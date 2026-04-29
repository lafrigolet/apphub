-- Services module: catalog of bookable services (consultations, treatments,
-- haircuts, classes…). Differs from platform_catalog (commerce products) in
-- duration, buffers, modality and cancellation policy.

CREATE TABLE IF NOT EXISTS platform_services.services (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                TEXT         NOT NULL,
  tenant_id             UUID         NOT NULL,
  sub_tenant_id         UUID,
  code                  TEXT         NOT NULL,
  name                  TEXT         NOT NULL,
  description           TEXT,
  category              TEXT,
  modality              TEXT         NOT NULL DEFAULT 'in_person'
                          CHECK (modality IN ('in_person','telehealth','at_home','hybrid')),
  duration_minutes      INT          NOT NULL CHECK (duration_minutes > 0),
  buffer_before_minutes INT          NOT NULL DEFAULT 0,
  buffer_after_minutes  INT          NOT NULL DEFAULT 0,
  price_cents           BIGINT       NOT NULL DEFAULT 0,
  currency              CHAR(3)      NOT NULL DEFAULT 'EUR',
  cancellation_policy   JSONB        NOT NULL DEFAULT '{}',
  requires_intake_form  BOOLEAN      NOT NULL DEFAULT FALSE,
  intake_form_id        UUID,
  capacity              INT          NOT NULL DEFAULT 1,
  min_age               INT,
  metadata              JSONB        NOT NULL DEFAULT '{}',
  is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_services_unique_code
  ON platform_services.services (app_id, tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_platform_services_tenant_active
  ON platform_services.services (tenant_id, is_active);

ALTER TABLE platform_services.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_services.services FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_services_isolation ON platform_services.services
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Optional service categories (for grouping / browse views)
CREATE TABLE IF NOT EXISTS platform_services.categories (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  name          TEXT         NOT NULL,
  display_order INT          NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_platform_services_categories_tenant
  ON platform_services.categories (tenant_id, display_order);
ALTER TABLE platform_services.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_services.categories FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_services_categories_isolation ON platform_services.categories
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
