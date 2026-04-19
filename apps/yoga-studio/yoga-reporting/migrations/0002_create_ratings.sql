CREATE TABLE IF NOT EXISTS yoga_reporting.ratings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     UUID NOT NULL UNIQUE,
  user_id        UUID NOT NULL,
  class_id       UUID,
  instructor_id  UUID,
  stars          SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yoga_ratings_instructor ON yoga_reporting.ratings (instructor_id);
CREATE INDEX IF NOT EXISTS idx_yoga_ratings_class      ON yoga_reporting.ratings (class_id);
