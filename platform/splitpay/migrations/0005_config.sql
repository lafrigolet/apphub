-- Splitpay (Stripe Connect) global config: platform account id + secret/publishable
-- keys + webhook secret. Replaces (with env-var fallback) the SPLITPAY_STRIPE_*
-- env vars so staff can change credentials at runtime via voragine-console.
CREATE TABLE IF NOT EXISTS splitpay_core.config (
  key             TEXT PRIMARY KEY CHECK (key IN ('platform_account_id', 'stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret')),
  encrypted_value BYTEA,
  plain_value     TEXT,                                                 -- platform_account_id is not a secret
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON splitpay_core.config TO splitpay;
