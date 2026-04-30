-- Reservations module: table reservations + waitlist + service hours.
-- States: requested → confirmed → seated → completed | cancelled | no_show

CREATE TABLE IF NOT EXISTS platform_reservations.service_hours (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  day_of_week   INT          NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_minute   INT          NOT NULL CHECK (open_minute  BETWEEN 0 AND 1439),
  close_minute  INT          NOT NULL CHECK (close_minute BETWEEN 0 AND 1440),
  service_label TEXT,
  is_closed     BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_platform_reservations_hours_tenant
  ON platform_reservations.service_hours (tenant_id, day_of_week);

ALTER TABLE platform_reservations.service_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reservations.service_hours FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reservations_hours_isolation ON platform_reservations.service_hours
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_reservations.reservations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  sub_tenant_id   UUID,
  guest_user_id   UUID,
  guest_name      TEXT         NOT NULL,
  guest_email     TEXT,
  guest_phone     TEXT,
  party_size      INT          NOT NULL CHECK (party_size > 0),
  reserved_for    TIMESTAMPTZ  NOT NULL,
  duration_minutes INT         NOT NULL DEFAULT 90,
  table_id        UUID,
  status          TEXT         NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','confirmed','seated','completed','cancelled','no_show')),
  notes           TEXT,
  guarantee_payment_intent_id TEXT,
  source          TEXT         NOT NULL DEFAULT 'portal',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_reservations_tenant_when
  ON platform_reservations.reservations (tenant_id, reserved_for);
CREATE INDEX IF NOT EXISTS idx_platform_reservations_status
  ON platform_reservations.reservations (tenant_id, status, reserved_for);

ALTER TABLE platform_reservations.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reservations.reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reservations_reservations_isolation ON platform_reservations.reservations
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_reservations.waitlist (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  guest_name      TEXT         NOT NULL,
  guest_phone     TEXT,
  party_size      INT          NOT NULL CHECK (party_size > 0),
  status          TEXT         NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting','notified','seated','left','cancelled')),
  estimated_wait_minutes INT,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_reservations_waitlist_tenant_status
  ON platform_reservations.waitlist (tenant_id, status, created_at);

ALTER TABLE platform_reservations.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reservations.waitlist FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reservations_waitlist_isolation ON platform_reservations.waitlist
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_reservations.blackouts (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  starts_at     TIMESTAMPTZ  NOT NULL,
  ends_at       TIMESTAMPTZ  NOT NULL,
  reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_reservations_blackouts_when
  ON platform_reservations.blackouts (tenant_id, starts_at, ends_at);

ALTER TABLE platform_reservations.blackouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_reservations.blackouts FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_reservations_blackouts_isolation ON platform_reservations.blackouts
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
