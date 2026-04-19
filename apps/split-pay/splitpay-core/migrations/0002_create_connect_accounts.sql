-- Migration 0002: create connect_accounts table
-- Tracks Stripe Connect merchant accounts per tenant

SET search_path TO payments;

CREATE TABLE IF NOT EXISTS connect_accounts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  sub_tenant_id       UUID,
  stripe_account_id   TEXT        NOT NULL UNIQUE,
  email               TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'active', 'restricted', 'disabled')),
  payouts_enabled     BOOLEAN     NOT NULL DEFAULT false,
  charges_enabled     BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_connect_accounts_tenant ON connect_accounts (tenant_id);
CREATE INDEX idx_connect_accounts_stripe ON connect_accounts (stripe_account_id);

ALTER TABLE connect_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY connect_accounts_tenant_isolation ON connect_accounts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER connect_accounts_updated_at
  BEFORE UPDATE ON connect_accounts
  FOR EACH ROW EXECUTE FUNCTION payments.update_updated_at();
