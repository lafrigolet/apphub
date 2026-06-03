-- Chat module — feature expansion (blocks A + B):
--   threads, scheduled send, ephemeral messages, delivered receipts, DM
--   requests, public groups, support queue routing, pins, invites, tenant
--   bans, CSAT, support macros, per-tenant attachment/word policies.

-- ── conversations: requests, public, support queue ────────────────────────
ALTER TABLE platform_chat.conversations
  ADD COLUMN IF NOT EXISTS is_public       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_request      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requested_by    UUID,
  ADD COLUMN IF NOT EXISTS queue           TEXT,
  ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ;  -- stamped by chat-support-sla job

-- Public groups discoverable within a tenant.
CREATE INDEX IF NOT EXISTS idx_chat_conversations_public
  ON platform_chat.conversations (app_id, tenant_id, last_message_at DESC)
  WHERE type = 'group' AND is_public AND status = 'active';

-- ── participants: delivered receipts ──────────────────────────────────────
ALTER TABLE platform_chat.conversation_participants
  ADD COLUMN IF NOT EXISTS last_delivered_message_id UUID,
  ADD COLUMN IF NOT EXISTS last_delivered_at         TIMESTAMPTZ;

-- ── messages: threads, scheduled send, ephemeral ──────────────────────────
ALTER TABLE platform_chat.messages
  ADD COLUMN IF NOT EXISTS thread_root_id UUID REFERENCES platform_chat.messages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'scheduled')),
  ADD COLUMN IF NOT EXISTS scheduled_for  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at  TIMESTAMPTZ,  -- stamped by chat-scheduled-send job
  ADD COLUMN IF NOT EXISTS expires_at     TIMESTAMPTZ;

-- Thread replies under a root.
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
  ON platform_chat.messages (thread_root_id, created_at)
  WHERE thread_root_id IS NOT NULL;

-- Due scheduled messages (scanned by platform-scheduler).
CREATE INDEX IF NOT EXISTS idx_chat_messages_scheduled
  ON platform_chat.messages (scheduled_for)
  WHERE status = 'scheduled';

-- Ephemeral messages past their TTL (scanned by platform-scheduler).
CREATE INDEX IF NOT EXISTS idx_chat_messages_expiring
  ON platform_chat.messages (expires_at)
  WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

-- ── settings: DM requests, attachment + word policies ──────────────────────
ALTER TABLE platform_chat.settings
  ADD COLUMN IF NOT EXISTS dm_requests              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_attachment_mb        INT,
  ADD COLUMN IF NOT EXISTS allowed_attachment_kinds TEXT[],
  ADD COLUMN IF NOT EXISTS banned_words             TEXT[];

-- ── pinned_messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.pinned_messages (
  conversation_id UUID         NOT NULL REFERENCES platform_chat.conversations (id) ON DELETE CASCADE,
  message_id      UUID         NOT NULL REFERENCES platform_chat.messages (id) ON DELETE CASCADE,
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  pinned_by       UUID         NOT NULL,
  pinned_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id)
);
ALTER TABLE platform_chat.pinned_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.pinned_messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_pins_isolation ON platform_chat.pinned_messages
  USING (app_id = current_setting('app.app_id', true) AND tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── conversation_invites ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.conversation_invites (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  conversation_id UUID         NOT NULL REFERENCES platform_chat.conversations (id) ON DELETE CASCADE,
  code            TEXT         NOT NULL UNIQUE,
  created_by      UUID         NOT NULL,
  role            TEXT         NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  max_uses        INT,
  uses            INT          NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_invites_conversation
  ON platform_chat.conversation_invites (conversation_id);
ALTER TABLE platform_chat.conversation_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.conversation_invites FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_invites_isolation ON platform_chat.conversation_invites
  USING (app_id = current_setting('app.app_id', true) AND tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── tenant_bans ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.tenant_bans (
  app_id     TEXT         NOT NULL,
  tenant_id  UUID         NOT NULL,
  user_id    UUID         NOT NULL,
  banned_by  UUID         NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, tenant_id, user_id)
);
ALTER TABLE platform_chat.tenant_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.tenant_bans FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_tenant_bans_isolation ON platform_chat.tenant_bans
  USING (app_id = current_setting('app.app_id', true) AND tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── support_csat ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.support_csat (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  conversation_id UUID         NOT NULL REFERENCES platform_chat.conversations (id) ON DELETE CASCADE,
  rating          INT          NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT,
  submitted_by    UUID         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, submitted_by)
);
ALTER TABLE platform_chat.support_csat ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.support_csat FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_csat_isolation ON platform_chat.support_csat
  USING (app_id = current_setting('app.app_id', true) AND tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── support_macros (canned responses) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.support_macros (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id     TEXT         NOT NULL,
  tenant_id  UUID         NOT NULL,
  title      TEXT         NOT NULL,
  body       TEXT         NOT NULL,
  created_by UUID         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_macros_tenant
  ON platform_chat.support_macros (app_id, tenant_id, title);
ALTER TABLE platform_chat.support_macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.support_macros FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_macros_isolation ON platform_chat.support_macros
  USING (app_id = current_setting('app.app_id', true) AND tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP TRIGGER IF EXISTS trg_chat_macros_touch ON platform_chat.support_macros;
CREATE TRIGGER trg_chat_macros_touch
  BEFORE UPDATE ON platform_chat.support_macros
  FOR EACH ROW EXECUTE FUNCTION platform_chat.touch_updated_at();
