-- Chat module: in-app member chat. Three conversation types — direct (1:1),
-- group (N members), support (member ↔ staff/agent). Multi-tenant by RLS,
-- scoped on (app_id, tenant_id) via current_setting('app.*') just like the
-- other platform-core modules (inquiries, messaging, donations).

-- ─────────────────────────────────────────────────────────────────────────
-- touch_updated_at — shared trigger fn for the schema
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION platform_chat.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. conversations
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.conversations (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                 TEXT         NOT NULL,
  tenant_id              UUID         NOT NULL,
  sub_tenant_id          UUID,
  type                   TEXT         NOT NULL CHECK (type IN ('direct', 'group', 'support')),
  title                  TEXT,
  topic                  TEXT,
  avatar_object_id       UUID,
  created_by             UUID         NOT NULL,
  status                 TEXT         NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  -- Canonical key used to dedupe 'direct' conversations: the two participant
  -- ids sorted + joined. NULL for group/support (no dedup).
  dedupe_key             TEXT,
  -- Support-only columns (NULL for direct/group).
  assigned_agent_user_id UUID,
  support_status         TEXT         CHECK (support_status IN ('open', 'pending', 'resolved', 'closed')),
  priority               TEXT         CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  subject                TEXT,
  metadata               JSONB        NOT NULL DEFAULT '{}',
  last_message_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_tenant_recent
  ON platform_chat.conversations (app_id, tenant_id, type, status, last_message_at DESC);

-- Support queue lookups (unassigned / by-status).
CREATE INDEX IF NOT EXISTS idx_chat_conversations_support_queue
  ON platform_chat.conversations (app_id, tenant_id, support_status, assigned_agent_user_id)
  WHERE type = 'support';

-- Dedup of direct conversations: at most one (app, tenant, dedupe_key).
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversations_direct_dedupe
  ON platform_chat.conversations (app_id, tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE platform_chat.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.conversations FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_conversations_isolation ON platform_chat.conversations
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

DROP TRIGGER IF EXISTS trg_chat_conversations_touch ON platform_chat.conversations;
CREATE TRIGGER trg_chat_conversations_touch
  BEFORE UPDATE ON platform_chat.conversations
  FOR EACH ROW EXECUTE FUNCTION platform_chat.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. conversation_participants
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.conversation_participants (
  conversation_id      UUID         NOT NULL REFERENCES platform_chat.conversations (id) ON DELETE CASCADE,
  user_id              UUID         NOT NULL,
  app_id               TEXT         NOT NULL,
  tenant_id            UUID         NOT NULL,
  role                 TEXT         NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'agent')),
  joined_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  left_at              TIMESTAMPTZ,
  last_read_message_id UUID,
  last_read_at         TIMESTAMPTZ,
  muted_until          TIMESTAMPTZ,
  notify_pref          TEXT         NOT NULL DEFAULT 'all' CHECK (notify_pref IN ('all', 'mentions', 'none')),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user
  ON platform_chat.conversation_participants (app_id, tenant_id, user_id)
  WHERE left_at IS NULL;

ALTER TABLE platform_chat.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.conversation_participants FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_participants_isolation ON platform_chat.conversation_participants
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 3. messages
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.messages (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id              TEXT         NOT NULL,
  tenant_id           UUID         NOT NULL,
  conversation_id     UUID         NOT NULL REFERENCES platform_chat.conversations (id) ON DELETE CASCADE,
  sender_user_id      UUID,
  type                TEXT         NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'system', 'attachment')),
  body                TEXT,
  reply_to_message_id UUID         REFERENCES platform_chat.messages (id) ON DELETE SET NULL,
  edited_at           TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  metadata            JSONB        NOT NULL DEFAULT '{}',
  body_tsv            tsvector     GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON platform_chat.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_tsv
  ON platform_chat.messages USING GIN (body_tsv);

ALTER TABLE platform_chat.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_messages_isolation ON platform_chat.messages
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 4. message_attachments (storage-backed — object_id → platform_storage.objects)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.message_attachments (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        TEXT         NOT NULL,
  tenant_id     UUID         NOT NULL,
  message_id    UUID         NOT NULL REFERENCES platform_chat.messages (id) ON DELETE CASCADE,
  object_id     UUID         NOT NULL,
  kind          TEXT         NOT NULL CHECK (kind IN ('image', 'video', 'file')),
  display_order INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
  ON platform_chat.message_attachments (message_id, display_order);

ALTER TABLE platform_chat.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.message_attachments FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_attachments_isolation ON platform_chat.message_attachments
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5. message_reactions
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.message_reactions (
  message_id UUID         NOT NULL REFERENCES platform_chat.messages (id) ON DELETE CASCADE,
  user_id    UUID         NOT NULL,
  emoji      TEXT         NOT NULL,
  app_id     TEXT         NOT NULL,
  tenant_id  UUID         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

ALTER TABLE platform_chat.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.message_reactions FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_reactions_isolation ON platform_chat.message_reactions
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 6. message_mentions
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.message_mentions (
  message_id        UUID  NOT NULL REFERENCES platform_chat.messages (id) ON DELETE CASCADE,
  mentioned_user_id UUID  NOT NULL,
  app_id            TEXT  NOT NULL,
  tenant_id         UUID  NOT NULL,
  PRIMARY KEY (message_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_mentions_user
  ON platform_chat.message_mentions (app_id, tenant_id, mentioned_user_id);

ALTER TABLE platform_chat.message_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.message_mentions FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_mentions_isolation ON platform_chat.message_mentions
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 7. blocks — a user blocks another within (app, tenant)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.blocks (
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  user_id         UUID         NOT NULL,
  blocked_user_id UUID         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, tenant_id, user_id, blocked_user_id)
);

ALTER TABLE platform_chat.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.blocks FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_blocks_isolation ON platform_chat.blocks
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 8. reports — flag a message or conversation for admin review
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.reports (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id           TEXT         NOT NULL,
  tenant_id        UUID         NOT NULL,
  target_type      TEXT         NOT NULL CHECK (target_type IN ('message', 'conversation')),
  target_id        UUID         NOT NULL,
  reporter_user_id UUID         NOT NULL,
  reason           TEXT,
  status           TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_reports_status
  ON platform_chat.reports (app_id, tenant_id, status, created_at DESC);

ALTER TABLE platform_chat.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.reports FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_reports_isolation ON platform_chat.reports
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

DROP TRIGGER IF EXISTS trg_chat_reports_touch ON platform_chat.reports;
CREATE TRIGGER trg_chat_reports_touch
  BEFORE UPDATE ON platform_chat.reports
  FOR EACH ROW EXECUTE FUNCTION platform_chat.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 9. settings — per (app, tenant) chat configuration
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_chat.settings (
  app_id            TEXT         NOT NULL,
  tenant_id         UUID         NOT NULL,
  allow_groups      BOOLEAN      NOT NULL DEFAULT true,
  max_group_size    INT          NOT NULL DEFAULT 256,
  redaction_enabled BOOLEAN      NOT NULL DEFAULT false,
  retention_days    INT,
  support_enabled   BOOLEAN      NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, tenant_id)
);

ALTER TABLE platform_chat.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_chat.settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY chat_settings_isolation ON platform_chat.settings
  USING (
    app_id        = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

DROP TRIGGER IF EXISTS trg_chat_settings_touch ON platform_chat.settings;
CREATE TRIGGER trg_chat_settings_touch
  BEFORE UPDATE ON platform_chat.settings
  FOR EACH ROW EXECUTE FUNCTION platform_chat.touch_updated_at();
