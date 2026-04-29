-- Packages module: prepaid session bundles (10 sesiones por 400€).

CREATE TABLE IF NOT EXISTS platform_packages.package_templates (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  code            TEXT         NOT NULL,
  name            TEXT         NOT NULL,
  description     TEXT,
  service_id      UUID         NOT NULL,
  total_sessions  INT          NOT NULL CHECK (total_sessions > 0),
  validity_days   INT          NOT NULL DEFAULT 365,
  price_cents     BIGINT       NOT NULL DEFAULT 0,
  currency        CHAR(3)      NOT NULL DEFAULT 'EUR',
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  metadata        JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_packages_templates_code
  ON platform_packages.package_templates (app_id, tenant_id, code);
ALTER TABLE platform_packages.package_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_packages.package_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_packages_templates_isolation ON platform_packages.package_templates
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_packages.purchased_packages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  template_id     UUID         NOT NULL REFERENCES platform_packages.package_templates (id),
  client_user_id  UUID         NOT NULL,
  service_id      UUID         NOT NULL,
  total_sessions  INT          NOT NULL,
  remaining_sessions INT       NOT NULL,
  price_paid_cents BIGINT      NOT NULL DEFAULT 0,
  currency        CHAR(3)      NOT NULL DEFAULT 'EUR',
  status          TEXT         NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','exhausted','expired','refunded','cancelled')),
  purchased_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ  NOT NULL,
  metadata        JSONB        NOT NULL DEFAULT '{}',
  CHECK (remaining_sessions >= 0),
  CHECK (remaining_sessions <= total_sessions)
);
CREATE INDEX IF NOT EXISTS idx_platform_packages_purchased_client
  ON platform_packages.purchased_packages (client_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_platform_packages_purchased_service
  ON platform_packages.purchased_packages (service_id, status);
ALTER TABLE platform_packages.purchased_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_packages.purchased_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_packages_purchased_isolation ON platform_packages.purchased_packages
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_packages.redemptions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  package_id      UUID         NOT NULL REFERENCES platform_packages.purchased_packages (id) ON DELETE CASCADE,
  booking_id      UUID,
  delta           INT          NOT NULL,
  reason          TEXT         NOT NULL CHECK (reason IN ('redeem','refund','adjust')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_packages_redemptions_pkg
  ON platform_packages.redemptions (package_id, created_at DESC);
ALTER TABLE platform_packages.redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_packages.redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_packages_redemptions_isolation ON platform_packages.redemptions
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- packages reads platform_bookings to look up package_id on booking lifecycle events.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_packages') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_bookings TO svc_platform_packages';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_bookings TO svc_platform_packages';
  END IF;
END
$$;
