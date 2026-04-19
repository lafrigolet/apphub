CREATE TABLE IF NOT EXISTS yoga_bookings.bookings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,
  session_id           UUID NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                       CHECK (status IN ('confirmed','cancelled','attended','no_show','waiting')),
  is_recurrent         BOOLEAN NOT NULL DEFAULT false,
  recurrent_grp        UUID,
  booked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at         TIMESTAMPTZ,
  cancellation_reason  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_yoga_bookings_user_session
  ON yoga_bookings.bookings (user_id, session_id)
  WHERE status NOT IN ('cancelled');

CREATE INDEX IF NOT EXISTS idx_yoga_bookings_session ON yoga_bookings.bookings (session_id);
CREATE INDEX IF NOT EXISTS idx_yoga_bookings_user    ON yoga_bookings.bookings (user_id, booked_at DESC);
CREATE INDEX IF NOT EXISTS idx_yoga_bookings_status  ON yoga_bookings.bookings (status);
