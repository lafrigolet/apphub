CREATE TABLE IF NOT EXISTS platform_payments.transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id         TEXT NOT NULL,
  tenant_id      UUID NOT NULL,
  sub_tenant_id  UUID,
  user_id        UUID NOT NULL,
  provider       TEXT NOT NULL DEFAULT 'stripe',
  provider_tx_id TEXT UNIQUE,
  amount_cents   INT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'eur',
  status         TEXT NOT NULL DEFAULT 'pending',
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_payments_tenant ON platform_payments.transactions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_payments_user   ON platform_payments.transactions (user_id);
ALTER TABLE platform_payments.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_payments.transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payments_isolation ON platform_payments.transactions
  USING (app_id = current_setting('app.app_id', true) AND tenant_id = current_setting('app.tenant_id', true)::uuid);
