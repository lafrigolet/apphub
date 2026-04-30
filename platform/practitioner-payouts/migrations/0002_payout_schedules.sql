-- Per-tenant per-practitioner schedule for automatic payout closure. The
-- scheduler reads `next_run_at` and publishes payout.period_due; the
-- practitioner-payouts service's subscriber calls closePeriod() and the
-- scheduler advances last_closed_at + next_run_at.

CREATE TABLE IF NOT EXISTS platform_practitioner_payouts.payout_schedules (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  practitioner_id UUID         NOT NULL,
  period          TEXT         NOT NULL CHECK (period IN ('weekly','biweekly','monthly')),
  anchor_day      INT          NOT NULL DEFAULT 1,         -- day-of-week 0..6 for weekly/biweekly, day-of-month 1..28 for monthly
  next_run_at     TIMESTAMPTZ  NOT NULL,
  last_closed_at  TIMESTAMPTZ,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  metadata        JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_payout_schedules_due
  ON platform_practitioner_payouts.payout_schedules (next_run_at)
  WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_platform_payout_schedules_practitioner
  ON platform_practitioner_payouts.payout_schedules (practitioner_id);

ALTER TABLE platform_practitioner_payouts.payout_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_practitioner_payouts.payout_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_payout_schedules_isolation ON platform_practitioner_payouts.payout_schedules
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Note: cross-tenant scheduler reads of this table are handled by the
-- BYPASSRLS attribute granted to svc_platform_scheduler in the scheduler's
-- own migration (platform/scheduler/migrations/0001_init.sql).
