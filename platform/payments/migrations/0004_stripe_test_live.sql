-- Stripe test/live key pairs + persisted mode switch.
--
-- The console can now hold BOTH key sets (stripe_test_* and stripe_live_*)
-- and flip the active one via the plain `stripe_mode` row — no re-pasting
-- keys when switching environments. Existing rows are renamed to the *test*
-- set (what was stored to date are test keys) and the initial mode is 'test'.
--
-- Order matters (single transaction): the legacy CHECK must be dropped before
-- the renames would matter, and the renames must run before the new CHECK is
-- added — otherwise the legacy key names would violate it.

-- 1. Drop the inline CHECK from 0002 (default Postgres name for an anonymous
--    inline CHECK on config.key — same name splitpay's 0009 relied on).
ALTER TABLE platform_payments.config
  DROP CONSTRAINT IF EXISTS config_key_check;

-- 2. Rename the legacy single set to the test set.
UPDATE platform_payments.config SET key = 'stripe_test_secret_key'      WHERE key = 'stripe_secret_key';
UPDATE platform_payments.config SET key = 'stripe_test_publishable_key' WHERE key = 'stripe_publishable_key';
UPDATE platform_payments.config SET key = 'stripe_test_webhook_secret'  WHERE key = 'stripe_webhook_secret';

-- 3. stripe_mode is not a secret — payments' config table only had
--    encrypted_value until now (splitpay already has the dual columns).
ALTER TABLE platform_payments.config
  ADD COLUMN IF NOT EXISTS plain_value TEXT;

-- 4. Recreate the CHECK with the full namespaced set (legacy names out).
ALTER TABLE platform_payments.config
  ADD CONSTRAINT config_key_check CHECK (
    key IN (
      'stripe_test_secret_key',
      'stripe_test_publishable_key',
      'stripe_test_webhook_secret',
      'stripe_live_secret_key',
      'stripe_live_publishable_key',
      'stripe_live_webhook_secret',
      'stripe_mode'
    )
  );

-- 5. Seed the active mode. 'test' because that's what the renamed keys are.
INSERT INTO platform_payments.config (key, plain_value, updated_at)
VALUES ('stripe_mode', 'test', now())
ON CONFLICT (key) DO NOTHING;
