-- Migration 0010: Stripe test/live key pairs + persisted mode switch.
--
-- The console can hold BOTH key sets (stripe_test_* / stripe_live_*) and flip
-- the active one via the plain `stripe_mode` row — no re-pasting keys when
-- switching environments. Existing rows are renamed to the *test* set (what
-- was stored to date are test credentials) and the initial mode is 'test'.
-- platform_account_id is also namespaced: the Connect platform account differs
-- between Stripe test and live mode. Fee config stays shared (the simulated
-- test fee equals the real one).
--
-- Order matters (single transaction): drop the CHECK, rename, then recreate
-- the CHECK without the legacy names.

SET search_path TO splitpay_core;

ALTER TABLE config DROP CONSTRAINT IF EXISTS config_key_check;

UPDATE config SET key = 'stripe_test_secret_key'      WHERE key = 'stripe_secret_key';
UPDATE config SET key = 'stripe_test_publishable_key' WHERE key = 'stripe_publishable_key';
UPDATE config SET key = 'stripe_test_webhook_secret'  WHERE key = 'stripe_webhook_secret';
UPDATE config SET key = 'platform_account_id_test'    WHERE key = 'platform_account_id';

ALTER TABLE config ADD CONSTRAINT config_key_check CHECK (
  key IN (
    'platform_account_id_test',
    'platform_account_id_live',
    'stripe_test_secret_key',
    'stripe_test_publishable_key',
    'stripe_test_webhook_secret',
    'stripe_live_secret_key',
    'stripe_live_publishable_key',
    'stripe_live_webhook_secret',
    'stripe_mode',
    'stripe_fee_percent',
    'stripe_fee_fixed'
  )
);

INSERT INTO config (key, plain_value, updated_at)
VALUES ('stripe_mode', 'test', now())
ON CONFLICT (key) DO NOTHING;
