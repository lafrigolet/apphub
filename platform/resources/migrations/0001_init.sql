-- Resources module: anything that can be booked. People (practitioners)
-- and physical things (rooms, equipment, vehicles).

CREATE TABLE IF NOT EXISTS platform_resources.resources (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  user_id         UUID,
  kind            TEXT         NOT NULL CHECK (kind IN ('practitioner','room','equipment','vehicle')),
  display_name    TEXT         NOT NULL,
  email           TEXT,
  phone           TEXT,
  bio             TEXT,
  capacity        INT          NOT NULL DEFAULT 1,
  internal_rate_cents BIGINT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  metadata        JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_resources_tenant_kind
  ON platform_resources.resources (tenant_id, kind, is_active);
CREATE INDEX IF NOT EXISTS idx_platform_resources_user
  ON platform_resources.resources (user_id);

ALTER TABLE platform_resources.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_resources.resources FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_resources_isolation ON platform_resources.resources
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Which services this resource can deliver (N:M with platform_services.services).
CREATE TABLE IF NOT EXISTS platform_resources.resource_services (
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  resource_id   UUID         NOT NULL REFERENCES platform_resources.resources (id) ON DELETE CASCADE,
  service_id    UUID         NOT NULL,
  PRIMARY KEY (resource_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_resources_resource_services_tenant
  ON platform_resources.resource_services (app_id, tenant_id, service_id);
ALTER TABLE platform_resources.resource_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_resources.resource_services FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_resources_rs_isolation ON platform_resources.resource_services
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Recurring weekly schedule (Mon-Sun, minute-of-day pairs).
CREATE TABLE IF NOT EXISTS platform_resources.work_hours (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  resource_id     UUID         NOT NULL REFERENCES platform_resources.resources (id) ON DELETE CASCADE,
  day_of_week     INT          NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_minute    INT          NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute      INT          NOT NULL CHECK (end_minute   BETWEEN 0 AND 1440),
  effective_from  DATE,
  effective_until DATE
);
CREATE INDEX IF NOT EXISTS idx_platform_resources_work_hours_resource
  ON platform_resources.work_hours (resource_id, day_of_week);
ALTER TABLE platform_resources.work_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_resources.work_hours FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_resources_wh_isolation ON platform_resources.work_hours
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- One-off blocks (vacation, sick leave, training).
CREATE TABLE IF NOT EXISTS platform_resources.exceptions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  resource_id     UUID         NOT NULL REFERENCES platform_resources.resources (id) ON DELETE CASCADE,
  starts_at       TIMESTAMPTZ  NOT NULL,
  ends_at         TIMESTAMPTZ  NOT NULL,
  kind            TEXT         NOT NULL CHECK (kind IN ('vacation','sick','training','holiday','other')),
  reason          TEXT
);
CREATE INDEX IF NOT EXISTS idx_platform_resources_exceptions_when
  ON platform_resources.exceptions (resource_id, starts_at, ends_at);
ALTER TABLE platform_resources.exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_resources.exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_resources_exc_isolation ON platform_resources.exceptions
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
