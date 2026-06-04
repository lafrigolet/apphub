-- Telehealth lifecycle, recording consent, data-region and clinical notes.
-- Adds:
--   * rooms.data_region        — EU data-sovereignty selection (GDPR / health data).
--   * rooms.recording_consent_* — explicit recording consent capture (GDPR Art. 9).
--   * room_events              — append-only FSM transition history (actor + reason).
--   * session_notes            — post-session clinical (SOAP) notes linked to room/booking.
-- Booking-event reactions (cancelled / rescheduled / no_show) reuse existing columns.

-- 1) Data region + recording-consent fields on rooms ------------------------
ALTER TABLE platform_telehealth.rooms
  ADD COLUMN IF NOT EXISTS data_region TEXT NOT NULL DEFAULT 'eu-west'
    CHECK (data_region IN ('eu-west','eu-central','us-east','ap-southeast')),
  ADD COLUMN IF NOT EXISTS recording_consent_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (recording_consent_status IN ('not_required','pending','granted','denied')),
  ADD COLUMN IF NOT EXISTS recording_consent_by UUID,
  ADD COLUMN IF NOT EXISTS recording_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recording_consent_text TEXT;

-- 2) Append-only room-event history (FSM transitions, reasons, actors) -------
CREATE TABLE IF NOT EXISTS platform_telehealth.room_events (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      TEXT         NOT NULL,
  tenant_id   UUID         NOT NULL,
  room_id     UUID         NOT NULL REFERENCES platform_telehealth.rooms (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT         NOT NULL,
  reason      TEXT,
  actor       TEXT,        -- user id / 'system' / 'scheduler'
  metadata    JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_telehealth_room_events_room
  ON platform_telehealth.room_events (room_id, created_at);
ALTER TABLE platform_telehealth.room_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_telehealth.room_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_telehealth_room_events_isolation ON platform_telehealth.room_events
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- 3) Post-session clinical (SOAP) notes -------------------------------------
CREATE TABLE IF NOT EXISTS platform_telehealth.session_notes (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      TEXT         NOT NULL,
  tenant_id   UUID         NOT NULL,
  room_id     UUID         NOT NULL REFERENCES platform_telehealth.rooms (id) ON DELETE CASCADE,
  booking_id  UUID,
  author_id   UUID         NOT NULL,
  subjective  TEXT,
  objective   TEXT,
  assessment  TEXT,
  plan        TEXT,
  body        TEXT,        -- free-form notes when SOAP fields not used
  signed_at   TIMESTAMPTZ, -- digital sign-off timestamp (immutable once set)
  metadata    JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_telehealth_session_notes_room
  ON platform_telehealth.session_notes (room_id);
CREATE INDEX IF NOT EXISTS idx_platform_telehealth_session_notes_booking
  ON platform_telehealth.session_notes (booking_id);
ALTER TABLE platform_telehealth.session_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_telehealth.session_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_telehealth_session_notes_isolation ON platform_telehealth.session_notes
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Grants for the dedicated module role (no-op if role absent, e.g. local test DB).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_platform_telehealth') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON platform_telehealth.room_events TO svc_platform_telehealth';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON platform_telehealth.session_notes TO svc_platform_telehealth';
  END IF;
END
$$;
