-- Per-app feature flag: when true, the splitpay (Stripe Connect) section appears
-- in tenant consoles and the splitpay module accepts requests scoped to this app.
-- When false (default), splitpay is hidden for this app's tenants.
ALTER TABLE platform_tenants.apps
  ADD COLUMN IF NOT EXISTS splitpay_enabled BOOLEAN NOT NULL DEFAULT FALSE;
