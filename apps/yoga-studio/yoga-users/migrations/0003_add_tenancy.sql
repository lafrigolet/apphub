ALTER TABLE yoga_users.profiles
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

ALTER TABLE yoga_users.class_history
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_yoga_users_profiles_tenant ON yoga_users.profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_yoga_users_history_tenant  ON yoga_users.class_history (tenant_id);

ALTER TABLE yoga_users.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_users.profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_users_profiles_tenant_isolation ON yoga_users.profiles
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE yoga_users.class_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_users.class_history FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_users_history_tenant_isolation ON yoga_users.class_history
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
