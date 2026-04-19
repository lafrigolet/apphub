CREATE TABLE IF NOT EXISTS yoga_auth.users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            VARCHAR(255) NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  role             VARCHAR(20) NOT NULL DEFAULT 'alumno'
                   CHECK (role IN ('alumno', 'instructor', 'admin')),
  email_confirmed  BOOLEAN NOT NULL DEFAULT false,
  failed_attempts  INT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yoga_auth_users_email ON yoga_auth.users (email);

CREATE OR REPLACE FUNCTION yoga_auth.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON yoga_auth.users
  FOR EACH ROW EXECUTE FUNCTION yoga_auth.set_updated_at();
