ALTER TABLE yoga_auth.users
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

ALTER TABLE yoga_auth.password_resets
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_yoga_auth_users_tenant      ON yoga_auth.users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_yoga_auth_pw_resets_tenant  ON yoga_auth.password_resets (tenant_id);

ALTER TABLE yoga_auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_auth.users FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_auth_users_tenant_isolation ON yoga_auth.users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE yoga_auth.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_auth.password_resets FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_auth_pw_resets_tenant_isolation ON yoga_auth.password_resets
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
