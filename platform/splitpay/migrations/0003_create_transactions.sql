-- Migration 0003: create transactions table
-- Records every PaymentIntent with its split context

SET search_path TO splitpay_core;

CREATE TABLE IF NOT EXISTS transactions (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID        NOT NULL,
  sub_tenant_id             UUID,
  stripe_payment_intent_id  TEXT        NOT NULL UNIQUE,
  amount                    INTEGER     NOT NULL CHECK (amount > 0),
  currency                  CHAR(3)     NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'requires_payment_method',
  split_rule_id             UUID        NOT NULL REFERENCES split_rules (id),
  merchant_account_id       TEXT        NOT NULL,
  platform_fee              INTEGER     NOT NULL DEFAULT 0,
  metadata                  JSONB       NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_tenant ON transactions (tenant_id, created_at DESC);
CREATE INDEX idx_transactions_stripe ON transactions (stripe_payment_intent_id);
CREATE INDEX idx_transactions_status ON transactions (tenant_id, status);
CREATE INDEX idx_transactions_merchant ON transactions (merchant_account_id);

-- Partition hint for future partitioning by tenant_id
COMMENT ON TABLE transactions IS 'High-volume table — candidate for partitioning by tenant_id';

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_tenant_isolation ON transactions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION payments.update_updated_at();
