CREATE TABLE IF NOT EXISTS yoga_classes.classes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  type          VARCHAR(20) NOT NULL
                CHECK (type IN ('hatha','vinyasa','yin','restaurativo','power','mindfulness')),
  instructor_id UUID NOT NULL,
  room          VARCHAR(20) NOT NULL,
  start_time    TIME NOT NULL,
  duration_min  INT NOT NULL,
  max_capacity  INT NOT NULL,
  level         VARCHAR(20) NOT NULL DEFAULT 'todos'
                CHECK (level IN ('todos','principiante','intermedio','avanzado')),
  recurrence    VARCHAR(20) NOT NULL DEFAULT 'none'
                CHECK (recurrence IN ('none','weekly','biweekly')),
  equipment     TEXT[] NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yoga_classes_type     ON yoga_classes.classes (type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_yoga_classes_instructor ON yoga_classes.classes (instructor_id) WHERE is_active = true;
