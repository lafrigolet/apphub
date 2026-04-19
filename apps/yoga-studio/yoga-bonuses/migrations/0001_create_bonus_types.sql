CREATE TABLE IF NOT EXISTS yoga_bonuses.bonus_types (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(100) NOT NULL,
  type           VARCHAR(30) NOT NULL CHECK (type IN ('sessions', 'monthly_unlimited')),
  sessions_count INT,
  validity_days  INT NOT NULL,
  price_eur      DECIMAL(8,2) NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
