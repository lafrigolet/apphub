-- SLA-breach flag for the dispute-sla cron job. Stamped inside the UPDATE so
-- a follow-up tick doesn't re-emit dispute.sla_breached for the same row.

ALTER TABLE platform_disputes.disputes
  ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_disputes_open_sla
  ON platform_disputes.disputes (created_at)
  WHERE status = 'open' AND sla_breached_at IS NULL;
