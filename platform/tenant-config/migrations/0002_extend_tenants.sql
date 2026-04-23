ALTER TABLE platform_tenants.tenants
  ADD COLUMN IF NOT EXISTS legal_name          TEXT,
  ADD COLUMN IF NOT EXISTS cif                 TEXT,
  ADD COLUMN IF NOT EXISTS country             TEXT,
  ADD COLUMN IF NOT EXISTS contact_email       TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone       TEXT,
  ADD COLUMN IF NOT EXISTS address             TEXT,
  ADD COLUMN IF NOT EXISTS plan                TEXT,
  ADD COLUMN IF NOT EXISTS custom_domain       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_status       TEXT,
  ADD COLUMN IF NOT EXISTS suspend_reason      TEXT,
  ADD COLUMN IF NOT EXISTS archived_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS volume_month_cents  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tx_month            INT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_cents       BIGINT NOT NULL DEFAULT 0;

ALTER TABLE platform_tenants.tenants DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE platform_tenants.tenants
  ADD CONSTRAINT tenants_plan_check
  CHECK (plan IS NULL OR plan IN ('STARTER','PRO','ENTERPRISE'));

ALTER TABLE platform_tenants.tenants DROP CONSTRAINT IF EXISTS tenants_stripe_status_check;
ALTER TABLE platform_tenants.tenants
  ADD CONSTRAINT tenants_stripe_status_check
  CHECK (stripe_status IS NULL OR stripe_status IN ('VERIFIED','RESTRICTED','PENDING','DISCONNECTED'));

ALTER TABLE platform_tenants.tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE platform_tenants.tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('active','suspended','archived'));
