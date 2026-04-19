CREATE TABLE IF NOT EXISTS yoga_users.profiles (
  id          UUID PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  phone       VARCHAR(20),
  avatar_url  TEXT,
  role        VARCHAR(20) NOT NULL DEFAULT 'alumno'
              CHECK (role IN ('alumno', 'instructor', 'admin')),
  preferences JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yoga_users_profiles_email ON yoga_users.profiles (email);
CREATE INDEX IF NOT EXISTS idx_yoga_users_profiles_role  ON yoga_users.profiles (role);
