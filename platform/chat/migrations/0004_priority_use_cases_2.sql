-- Chat module — second batch of priority use cases (from docs/use-cases/chat.md):
--   #2  GDPR right-to-be-forgotten — anonymize a user's chat history
--   #7  support auto first-response (canned ack on ticket open)
--   §18 report history per user (target_user_id on reports)

-- ── settings: support auto first-response ─────────────────────────────────
-- When non-null, opening a 'support' conversation auto-posts this text as a
-- system message so the member gets an immediate acknowledgement. NULL = off.
ALTER TABLE platform_chat.settings
  ADD COLUMN IF NOT EXISTS support_auto_reply TEXT;

-- ── reports: track the reported user (for report-history lookups) ─────────
-- Older rows leave this NULL; new message/conversation reports populate it
-- from the report target where the sender/creator is known. Indexed for the
-- per-user report-history admin query.
ALTER TABLE platform_chat.reports
  ADD COLUMN IF NOT EXISTS target_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_chat_reports_target_user
  ON platform_chat.reports (app_id, tenant_id, target_user_id)
  WHERE target_user_id IS NOT NULL;
