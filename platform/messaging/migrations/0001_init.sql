-- Messaging module: buyer ↔ vendor threads + messages.

CREATE TABLE IF NOT EXISTS platform_messaging.threads (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  buyer_user_id   UUID         NOT NULL,
  vendor_user_id  UUID         NOT NULL,
  order_id        UUID,
  subject         TEXT,
  status          TEXT         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived')),
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_messaging_threads_buyer
  ON platform_messaging.threads (app_id, tenant_id, buyer_user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_messaging_threads_vendor
  ON platform_messaging.threads (app_id, tenant_id, vendor_user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_messaging_threads_order
  ON platform_messaging.threads (order_id);

ALTER TABLE platform_messaging.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_messaging.threads FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_messaging_threads_isolation ON platform_messaging.threads
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE TABLE IF NOT EXISTS platform_messaging.messages (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id           TEXT         NOT NULL,
  tenant_id        UUID         NOT NULL,
  thread_id        UUID         NOT NULL REFERENCES platform_messaging.threads (id) ON DELETE CASCADE,
  sender_user_id   UUID         NOT NULL,
  body             TEXT         NOT NULL,
  attachments      JSONB        NOT NULL DEFAULT '[]',
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_messaging_messages_thread
  ON platform_messaging.messages (thread_id, created_at ASC);

ALTER TABLE platform_messaging.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_messaging.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_messaging_messages_isolation ON platform_messaging.messages
  USING (
    app_id    = current_setting('app.app_id',    true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
