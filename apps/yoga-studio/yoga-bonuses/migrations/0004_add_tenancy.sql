-- bonus_types: catalog table — tenant-level only, no sub_tenant_id
ALTER TABLE yoga_bonuses.bonus_types
  ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

CREATE INDEX IF NOT EXISTS idx_yoga_bonus_types_tenant ON yoga_bonuses.bonus_types (tenant_id);

ALTER TABLE yoga_bonuses.bonus_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_bonuses.bonus_types FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_bonus_types_tenant_isolation ON yoga_bonuses.bonus_types
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- bonuses and credit_log: full two-level tenancy
ALTER TABLE yoga_bonuses.bonuses
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

ALTER TABLE yoga_bonuses.credit_log
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_yoga_bonuses_tenant    ON yoga_bonuses.bonuses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_yoga_credit_log_tenant ON yoga_bonuses.credit_log (tenant_id);

ALTER TABLE yoga_bonuses.bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_bonuses.bonuses FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_bonuses_tenant_isolation ON yoga_bonuses.bonuses
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE yoga_bonuses.credit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_bonuses.credit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_credit_log_tenant_isolation ON yoga_bonuses.credit_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
