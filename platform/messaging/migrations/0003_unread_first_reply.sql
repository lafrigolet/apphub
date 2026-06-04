-- Priority backend features for buyer↔vendor messaging:
--   1. Unread-counter support: partial index for fast "unread by recipient" scans
--      and a thread-level bulk "mark all as read" path.
--   6. Vendor SLA core: record the vendor's first reply time on the thread so a
--      future scheduler job can detect breaches (`messaging.vendor.sla_breached`).
--
-- NOTE: never edit prior migrations; this file is additive only.

-- ── Unread support ──────────────────────────────────────────────────────
-- Partial index makes "count unread messages addressed to user X in thread Y"
-- cheap: we only index rows still pending a read receipt.
CREATE INDEX IF NOT EXISTS idx_platform_messaging_messages_unread
  ON platform_messaging.messages (app_id, tenant_id, thread_id, sender_user_id)
  WHERE read_at IS NULL;

-- ── Vendor SLA core ─────────────────────────────────────────────────────
-- first_reply_at: timestamp of the vendor's first message in the thread.
-- Recorded once (COALESCE keep-first) when the vendor posts; NULL means the
-- vendor has not replied yet. A scheduler job (cross-cutting, pending) can
-- scan `status = 'open' AND first_reply_at IS NULL AND created_at < now() - sla`.
ALTER TABLE platform_messaging.threads
  ADD COLUMN IF NOT EXISTS first_reply_at TIMESTAMPTZ;
