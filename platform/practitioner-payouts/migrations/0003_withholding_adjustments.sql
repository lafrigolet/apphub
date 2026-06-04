-- Priority backlog (see docs/use-cases/practitioner-payouts.md §"Recomendaciones"):
--   #2 net_amount_cents + withholding_cents columns on payouts (PDF already refs them)
--   #3 IRPF withholding applied at closePeriod (configurable per tenant / per practitioner)
--   #5 clawback: reversing an already-paid accrual creates a negative adjustment
--   #8 manual adjustments: accruals.type ('booking_commission'|'adjustment'|'advance'|'reversal')

-- ── #2: real columns for gross / withholding / net on payouts ───────────
ALTER TABLE platform_practitioner_payouts.payouts
  ADD COLUMN IF NOT EXISTS gross_commission_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withholding_pct        NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (withholding_pct >= 0 AND withholding_pct <= 100),
  ADD COLUMN IF NOT EXISTS withholding_cents      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_commission_cents   BIGINT NOT NULL DEFAULT 0;

-- ── #8: accrual type discriminator (default keeps existing rows valid) ───
ALTER TABLE platform_practitioner_payouts.accruals
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'booking_commission';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_payouts_accruals_type_chk'
  ) THEN
    ALTER TABLE platform_practitioner_payouts.accruals
      ADD CONSTRAINT platform_payouts_accruals_type_chk
      CHECK (type IN ('booking_commission','adjustment','advance','reversal'));
  END IF;
END
$$;

-- Adjustment / advance / reversal accruals may carry a negative commission
-- (a deduction or clawback that reduces the next payout). The original
-- non-negative CHECK only applies to booking_commission accruals now.
ALTER TABLE platform_practitioner_payouts.accruals
  DROP CONSTRAINT IF EXISTS accruals_commission_cents_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_payouts_accruals_commission_sign_chk'
  ) THEN
    ALTER TABLE platform_practitioner_payouts.accruals
      ADD CONSTRAINT platform_payouts_accruals_commission_sign_chk
      CHECK (type <> 'booking_commission' OR commission_cents >= 0);
  END IF;
END
$$;

-- #222 in §18: index on accruals(payout_id) for the payout → accruals join.
CREATE INDEX IF NOT EXISTS idx_platform_payouts_accruals_payout
  ON platform_practitioner_payouts.accruals (payout_id);

-- ── #3: per-tenant / per-practitioner IRPF withholding configuration ─────
-- practitioner_id NULL  => tenant-wide default.
-- practitioner_id set   => override for that practitioner (takes precedence).
CREATE TABLE IF NOT EXISTS platform_practitioner_payouts.withholding_settings (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  practitioner_id UUID,
  withholding_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (withholding_pct >= 0 AND withholding_pct <= 100),
  metadata        JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- One default row per tenant and one row per practitioner.
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_withholding_tenant_default
  ON platform_practitioner_payouts.withholding_settings (app_id, tenant_id)
  WHERE practitioner_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_withholding_practitioner
  ON platform_practitioner_payouts.withholding_settings (app_id, tenant_id, practitioner_id)
  WHERE practitioner_id IS NOT NULL;

ALTER TABLE platform_practitioner_payouts.withholding_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_practitioner_payouts.withholding_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payouts_withholding_isolation ON platform_practitioner_payouts.withholding_settings
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
