CREATE TABLE IF NOT EXISTS platform_auth.users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                TEXT NOT NULL,
  tenant_id             UUID NOT NULL,
  sub_tenant_id         UUID,
  email                 TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'user',
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_auth_users_app_tenant_email
  ON platform_auth.users (app_id, tenant_id, email);

CREATE INDEX IF NOT EXISTS idx_platform_auth_users_tenant
  ON platform_auth.users (tenant_id);

ALTER TABLE platform_auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_auth.users FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_auth_users_isolation ON platform_auth.users
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
