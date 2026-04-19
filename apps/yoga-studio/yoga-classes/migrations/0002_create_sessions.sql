CREATE TABLE IF NOT EXISTS yoga_classes.sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     UUID NOT NULL REFERENCES yoga_classes.classes(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  spots_taken  INT NOT NULL DEFAULT 0,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_yoga_sessions_class_date ON yoga_classes.sessions (class_id, date);
CREATE INDEX IF NOT EXISTS idx_yoga_sessions_date ON yoga_classes.sessions (date) WHERE is_cancelled = false;
