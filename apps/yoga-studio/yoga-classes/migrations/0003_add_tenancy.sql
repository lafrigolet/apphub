ALTER TABLE yoga_classes.classes
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

ALTER TABLE yoga_classes.sessions
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_yoga_classes_tenant  ON yoga_classes.classes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_yoga_sessions_tenant ON yoga_classes.sessions (tenant_id);

ALTER TABLE yoga_classes.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_classes.classes FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_classes_tenant_isolation ON yoga_classes.classes
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE yoga_classes.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_classes.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_sessions_tenant_isolation ON yoga_classes.sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
