ALTER TABLE yoga_payments.transactions
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_yoga_payments_tenant ON yoga_payments.transactions (tenant_id);

ALTER TABLE yoga_payments.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_payments.transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_payments_tenant_isolation ON yoga_payments.transactions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
