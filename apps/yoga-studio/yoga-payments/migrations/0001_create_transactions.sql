CREATE TABLE IF NOT EXISTS yoga_payments.transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  bonus_type_id   UUID,
  provider        VARCHAR(20) NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe', 'paypal')),
  provider_tx_id  VARCHAR(200) NOT NULL UNIQUE,
  amount_eur      DECIMAL(8,2) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','completed','failed','refunded')),
  invoice_url     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_yoga_payments_user   ON yoga_payments.transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_yoga_payments_status ON yoga_payments.transactions (status);
