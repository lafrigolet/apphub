CREATE TABLE IF NOT EXISTS yoga_users.class_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES yoga_users.profiles(id) ON DELETE CASCADE,
  booking_id   UUID NOT NULL UNIQUE,
  class_name   VARCHAR(100) NOT NULL,
  instructor   VARCHAR(100),
  attended_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yoga_users_history_user ON yoga_users.class_history (user_id, attended_at DESC);
