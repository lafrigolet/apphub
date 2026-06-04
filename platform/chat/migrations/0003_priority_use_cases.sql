-- Chat module — priority use cases (from docs/use-cases/chat.md):
--   #4  per-tenant / per-priority SLA thresholds (configurable, not hardcoded)
--   #6  temporary bans (banned_until)
--   #9  per-tenant full-text search language (replaces hardcoded 'simple')
--   #3  scheduled-message cancellation lifecycle (cancelled_at marker)
--   #10 macro editing (no schema change — updated_at trigger already exists)

-- ── tenant_bans: temporary bans ───────────────────────────────────────────
-- NULL banned_until = indefinite (the historical behaviour). A non-null value
-- in the past means the ban has lapsed; isBanned() filters those out, and the
-- scheduler can later sweep them physically (cross-cutting, see chat.md).
ALTER TABLE platform_chat.tenant_bans
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;

-- ── messages: scheduled-message cancellation ──────────────────────────────
-- A user can cancel a still-scheduled message before dispatch. We soft-cancel
-- by flipping status away from 'scheduled' and stamping cancelled_at, so the
-- scheduler's partial index (WHERE status = 'scheduled') stops matching it.
ALTER TABLE platform_chat.messages
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Relax the status CHECK to admit the 'cancelled' terminal state.
ALTER TABLE platform_chat.messages
  DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE platform_chat.messages
  ADD CONSTRAINT messages_status_check
  CHECK (status IN ('sent', 'scheduled', 'cancelled'));

-- Per-sender lookup of their own pending scheduled messages.
CREATE INDEX IF NOT EXISTS idx_chat_messages_scheduled_sender
  ON platform_chat.messages (app_id, tenant_id, sender_user_id, scheduled_for)
  WHERE status = 'scheduled';

-- ── settings: SLA thresholds + search language ────────────────────────────
-- sla_minutes_<priority>: minutes after the support ticket's first member
-- message before it counts as breached, per priority. NULL on a priority falls
-- back to the scheduler default. search_language: a Postgres text-search
-- regconfig name ('simple', 'spanish', 'english', …) used by message search.
ALTER TABLE platform_chat.settings
  ADD COLUMN IF NOT EXISTS sla_minutes_low      INT,
  ADD COLUMN IF NOT EXISTS sla_minutes_normal   INT,
  ADD COLUMN IF NOT EXISTS sla_minutes_high     INT,
  ADD COLUMN IF NOT EXISTS sla_minutes_urgent   INT,
  ADD COLUMN IF NOT EXISTS search_language      TEXT NOT NULL DEFAULT 'simple';
