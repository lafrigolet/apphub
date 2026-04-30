-- T-30d / T-7d expiry-warning idempotency columns.

ALTER TABLE platform_packages.purchased_packages
  ADD COLUMN IF NOT EXISTS warning_30d_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warning_7d_sent_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_packages_due_warning
  ON platform_packages.purchased_packages (expires_at)
  WHERE status = 'active'
    AND remaining_sessions > 0
    AND (warning_30d_sent_at IS NULL OR warning_7d_sent_at IS NULL);

-- Allow status='expired' so package-expiry-transition can flip rows.
ALTER TABLE platform_packages.purchased_packages
  DROP CONSTRAINT IF EXISTS purchased_packages_status_check;
ALTER TABLE platform_packages.purchased_packages
  ADD CONSTRAINT purchased_packages_status_check
  CHECK (status IN ('active','exhausted','expired','refunded','cancelled'));
