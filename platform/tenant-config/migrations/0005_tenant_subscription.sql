-- Subscripción tenant ↔ plataforma. Un solo tipo por tenant, parametrizado
-- individualmente por staff desde voragine-console. El cobro real lo
-- ejecuta `platform/splitpay` (Stripe Checkout, mode=subscription, no-split)
-- y los webhooks rellenan los campos `subscription_stripe_*`.

ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS subscription_period                 TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status                 TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS subscription_amount_cents           BIGINT,
  ADD COLUMN IF NOT EXISTS subscription_currency               CHAR(3) NOT NULL DEFAULT 'eur',
  ADD COLUMN IF NOT EXISTS subscription_stripe_price_id        TEXT,
  ADD COLUMN IF NOT EXISTS subscription_stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS subscription_billing_email          TEXT,
  ADD COLUMN IF NOT EXISTS subscription_started_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_renews_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_notes                  TEXT;

ALTER TABLE platform_tenants.tenants DROP CONSTRAINT IF EXISTS tenants_subscription_period_check;
ALTER TABLE platform_tenants.tenants
  ADD CONSTRAINT tenants_subscription_period_check
  CHECK (subscription_period IS NULL OR subscription_period IN ('monthly','annual'));

ALTER TABLE platform_tenants.tenants DROP CONSTRAINT IF EXISTS tenants_subscription_status_check;
ALTER TABLE platform_tenants.tenants
  ADD CONSTRAINT tenants_subscription_status_check
  CHECK (subscription_status IN ('inactive','trial','active','past_due','cancelled'));

CREATE INDEX IF NOT EXISTS idx_tenants_subscription_stripe_subscription_id
  ON platform_tenants.tenants (subscription_stripe_subscription_id)
  WHERE subscription_stripe_subscription_id IS NOT NULL;
