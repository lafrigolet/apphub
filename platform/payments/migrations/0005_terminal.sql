-- Stripe Terminal (Tap to Pay) support. We cache the Terminal Location id in
-- the existing config table so connection-token issuance can reference it
-- without recreating a Location on every call. The config.key CHECK
-- (recreated in 0004) must be widened to admit the new plain key.

ALTER TABLE platform_payments.config
  DROP CONSTRAINT IF EXISTS config_key_check;

ALTER TABLE platform_payments.config
  ADD CONSTRAINT config_key_check CHECK (
    key IN (
      'stripe_test_secret_key',
      'stripe_test_publishable_key',
      'stripe_test_webhook_secret',
      'stripe_live_secret_key',
      'stripe_live_publishable_key',
      'stripe_live_webhook_secret',
      'stripe_mode',
      'terminal_location_id'
    )
  );
