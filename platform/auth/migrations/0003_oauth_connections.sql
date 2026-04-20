ALTER TABLE platform_auth.users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS platform_auth.oauth_connections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES platform_auth.users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  email        TEXT,
  name         TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_connections_provider_uid
  ON platform_auth.oauth_connections (provider, provider_uid);

CREATE INDEX IF NOT EXISTS idx_oauth_connections_user_id
  ON platform_auth.oauth_connections (user_id);
