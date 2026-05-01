-- OAuth provider config: client_id + AES-GCM-encrypted client_secret +
-- enabled flag. One row per supported provider. Replaces (with env-fallback)
-- the GOOGLE_CLIENT_ID / FACEBOOK_APP_ID / FACEBOOK_APP_SECRET env vars so
-- staff can change OAuth credentials at runtime via voragine-console.
CREATE TABLE IF NOT EXISTS platform_auth.oauth_providers (
  provider                TEXT PRIMARY KEY CHECK (provider IN ('google', 'facebook')),
  client_id               TEXT,
  encrypted_client_secret BYTEA,
  enabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_user_id      UUID,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_auth.oauth_providers TO svc_platform_auth;
