-- Telehealth module: video rooms for telehealth bookings.
-- Provider-agnostic — the join URL + token are opaque strings supplied by an external
-- provider (Daily.co / Twilio Video / Jitsi / LiveKit / etc.).

CREATE TABLE IF NOT EXISTS platform_telehealth.rooms (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  booking_id      UUID,
  provider        TEXT         NOT NULL DEFAULT 'stub',
  external_room_id TEXT,
  join_url        TEXT,
  status          TEXT         NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created','active','ended','cancelled','expired')),
  starts_at       TIMESTAMPTZ  NOT NULL,
  ends_at         TIMESTAMPTZ  NOT NULL,
  expires_at      TIMESTAMPTZ  NOT NULL,
  recording_enabled BOOLEAN    NOT NULL DEFAULT FALSE,
  metadata        JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_telehealth_rooms_booking
  ON platform_telehealth.rooms (booking_id);
CREATE INDEX IF NOT EXISTS idx_platform_telehealth_rooms_when
  ON platform_telehealth.rooms (tenant_id, starts_at);
ALTER TABLE platform_telehealth.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_telehealth.rooms FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_telehealth_rooms_isolation ON platform_telehealth.rooms
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_telehealth.tokens (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  room_id       UUID         NOT NULL REFERENCES platform_telehealth.rooms (id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL,
  participant_role TEXT      NOT NULL CHECK (participant_role IN ('host','guest')),
  token         TEXT         NOT NULL,
  expires_at    TIMESTAMPTZ  NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_telehealth_tokens_room
  ON platform_telehealth.tokens (room_id);
ALTER TABLE platform_telehealth.tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_telehealth.tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_telehealth_tokens_isolation ON platform_telehealth.tokens
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- telehealth reads platform_services to detect modality=telehealth/hybrid on booking.confirmed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_telehealth') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA platform_services TO svc_platform_telehealth';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA platform_services TO svc_platform_telehealth';
  END IF;
END
$$;
