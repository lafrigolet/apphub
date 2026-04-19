CREATE TABLE IF NOT EXISTS platform_auth.password_resets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES platform_auth.users(id) ON DELETE CASCADE,
  app_id     TEXT NOT NULL,
  tenant_id  UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_auth_resets_user ON platform_auth.password_resets (user_id);
