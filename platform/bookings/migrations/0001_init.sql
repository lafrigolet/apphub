-- Bookings module: the appointment itself.
-- Status FSM: requested → confirmed → reminded → checked_in → in_progress → completed
--                                                                       \-→ cancelled / no_show / rescheduled

CREATE TABLE IF NOT EXISTS platform_bookings.bookings (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                TEXT         NOT NULL,
  tenant_id             UUID         NOT NULL,
  sub_tenant_id         UUID,
  service_id            UUID         NOT NULL,
  client_user_id        UUID         NOT NULL,
  client_name           TEXT,
  client_email          TEXT,
  client_phone          TEXT,
  starts_at             TIMESTAMPTZ  NOT NULL,
  ends_at               TIMESTAMPTZ  NOT NULL,
  status                TEXT         NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested','confirmed','reminded','checked_in','in_progress','completed','cancelled','no_show','rescheduled')),
  notes                 TEXT,
  internal_notes        TEXT,
  recurrence_id         UUID,
  parent_booking_id     UUID,
  package_id            UUID,
  price_cents           BIGINT,
  currency              CHAR(3),
  source                TEXT         NOT NULL DEFAULT 'portal',
  metadata              JSONB        NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_bookings_tenant_when
  ON platform_bookings.bookings (tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_platform_bookings_client
  ON platform_bookings.bookings (client_user_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_bookings_status
  ON platform_bookings.bookings (tenant_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_platform_bookings_recurrence
  ON platform_bookings.bookings (recurrence_id);

ALTER TABLE platform_bookings.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_bookings.bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_bookings_isolation ON platform_bookings.bookings
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Resources allocated to a booking (an appointment can require N resources).
CREATE TABLE IF NOT EXISTS platform_bookings.booking_resources (
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  booking_id    UUID         NOT NULL REFERENCES platform_bookings.bookings (id) ON DELETE CASCADE,
  resource_id   UUID         NOT NULL,
  PRIMARY KEY (booking_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_bookings_resources_resource
  ON platform_bookings.booking_resources (app_id, tenant_id, resource_id);
ALTER TABLE platform_bookings.booking_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_bookings.booking_resources FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_bookings_resources_isolation ON platform_bookings.booking_resources
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Recurrence rules. Light RFC-5545 subset stored as RRULE-ish JSON.
CREATE TABLE IF NOT EXISTS platform_bookings.recurrences (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  rrule         JSONB        NOT NULL,
  starts_on     DATE         NOT NULL,
  ends_on       DATE,
  count         INT,
  metadata      JSONB        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
ALTER TABLE platform_bookings.recurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_bookings.recurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_bookings_recurrences_isolation ON platform_bookings.recurrences
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Audit trail of status changes.
CREATE TABLE IF NOT EXISTS platform_bookings.booking_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  booking_id      UUID         NOT NULL REFERENCES platform_bookings.bookings (id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT         NOT NULL,
  actor_user_id   UUID,
  reason          TEXT,
  ts              TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_bookings_events_booking
  ON platform_bookings.booking_events (booking_id, ts DESC);
ALTER TABLE platform_bookings.booking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_bookings.booking_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_bookings_events_isolation ON platform_bookings.booking_events
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Waitlist for fully booked services.
CREATE TABLE IF NOT EXISTS platform_bookings.waitlist (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  service_id      UUID         NOT NULL,
  resource_id     UUID,
  client_user_id  UUID         NOT NULL,
  client_name     TEXT,
  client_phone    TEXT,
  preferred_window JSONB,
  status          TEXT         NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting','notified','booked','expired','cancelled')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_bookings_waitlist_tenant_status
  ON platform_bookings.waitlist (tenant_id, status, created_at);
ALTER TABLE platform_bookings.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_bookings.waitlist FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_bookings_waitlist_isolation ON platform_bookings.waitlist
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
