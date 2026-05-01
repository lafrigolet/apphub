-- Stripe configuration for the payments module. AES-GCM-encrypted secrets
-- replace (with env-var fallback) the PLATFORM_STRIPE_* env vars so staff
-- can change Stripe credentials at runtime via voragine-console without
-- redeploying.
CREATE TABLE IF NOT EXISTS platform_payments.config (
  key                TEXT PRIMARY KEY CHECK (key IN ('stripe_publishable_key', 'stripe_secret_key', 'stripe_webhook_secret')),
  encrypted_value    BYTEA,
  updated_by_user_id UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_payments.config TO svc_platform_payments;
