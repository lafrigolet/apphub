CREATE TABLE IF NOT EXISTS yoga_bookings.waiting_list (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  session_id   UUID NOT NULL,
  position     INT NOT NULL,
  notified_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_yoga_waitlist_user_session
  ON yoga_bookings.waiting_list (user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_yoga_waitlist_session ON yoga_bookings.waiting_list (session_id, position);
