-- Disputes upgrades (priorities #1, #3, #5 of docs/use-cases/disputes.md):
--
--  1. Controlled `reason_code` vocabulary — a separate column so the legacy
--     free-text `reason` keeps working, while new disputes carry a standard
--     enum that unlocks analytics, guided UI and per-reason rules.
--  2. `dispute_status_history` — an append-only trail (actor + from/to + ts)
--     so every FSM transition is auditable instead of overwriting `status`.
--  3. `withdrawn` status — buyer can voluntarily retract a claim.
--  4. `is_internal` on messages — staff-only notes not visible to buyer/vendor.

-- ── 1. controlled reason vocabulary ─────────────────────────────────────
ALTER TABLE platform_disputes.disputes
  ADD COLUMN IF NOT EXISTS reason_code TEXT
    CHECK (reason_code IS NULL OR reason_code IN (
      'item_not_received',
      'item_not_as_described',
      'item_damaged',
      'wrong_item',
      'quantity_mismatch',
      'unauthorized_transaction',
      'duplicate_charge',
      'service_not_rendered',
      'other'
    ));

CREATE INDEX IF NOT EXISTS idx_platform_disputes_reason_code
  ON platform_disputes.disputes (tenant_id, reason_code)
  WHERE reason_code IS NOT NULL;

-- ── 2. add `withdrawn` to the status FSM ────────────────────────────────
ALTER TABLE platform_disputes.disputes
  DROP CONSTRAINT IF EXISTS disputes_status_check;
ALTER TABLE platform_disputes.disputes
  ADD CONSTRAINT disputes_status_check
    CHECK (status IN (
      'open', 'investigating',
      'resolved_buyer', 'resolved_vendor',
      'escalated_chargeback', 'withdrawn'
    ));

-- ── 3. status-history trail (append-only) ───────────────────────────────
CREATE TABLE IF NOT EXISTS platform_disputes.dispute_status_history (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  dispute_id      UUID         NOT NULL REFERENCES platform_disputes.disputes (id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT         NOT NULL,
  actor_user_id   UUID,
  actor_role      TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_disputes_history_dispute
  ON platform_disputes.dispute_status_history (dispute_id, created_at ASC);

ALTER TABLE platform_disputes.dispute_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_disputes.dispute_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_disputes_history_isolation ON platform_disputes.dispute_status_history
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ── 4. staff-only internal notes on the message thread ──────────────────
ALTER TABLE platform_disputes.dispute_messages
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;
