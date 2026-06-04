-- KDS module — incremental:
--  * per-item status (partial bump): ticket_items.status FSM + ready_at
--  * cancellation metadata on tickets (reason + dedicated timestamp)
--
-- Rationale: until now only the whole ticket carried a status and cancellation
-- reused picked_up_at as its timestamp. Both are needed for partial bump and
-- for honest metrics / auto-cancellation auditing.

ALTER TABLE platform_kds.tickets
  ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE platform_kds.ticket_items
  ADD COLUMN IF NOT EXISTS status   TEXT NOT NULL DEFAULT 'fired'
    CHECK (status IN ('fired','in_progress','ready')),
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

-- Supports the all-day aggregate (active tickets grouped by sku/name) and the
-- metrics window scans, both scoped by (app_id, tenant_id).
CREATE INDEX IF NOT EXISTS idx_platform_kds_tickets_tenant_status
  ON platform_kds.tickets (app_id, tenant_id, status, fired_at);
