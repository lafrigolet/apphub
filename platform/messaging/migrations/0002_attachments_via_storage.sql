-- Messaging attachments via platform_storage (replaces JSON metadata path).
-- Each row references an object owned by the storage module + a kind tag
-- so frontends can render image/video/file thumbnails differently.
-- The legacy messages.attachments JSON column stays for backward compat
-- with the existing routes — new uploads should use this table.
CREATE TABLE IF NOT EXISTS platform_messaging.message_attachments (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id          TEXT         NOT NULL,
  tenant_id       UUID         NOT NULL,
  message_id      UUID         NOT NULL REFERENCES platform_messaging.messages(id) ON DELETE CASCADE,
  object_id       UUID         NOT NULL,
  kind            TEXT         NOT NULL CHECK (kind IN ('image', 'video', 'file')),
  display_order   INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_messaging_attachments_message
  ON platform_messaging.message_attachments (message_id, display_order);

ALTER TABLE platform_messaging.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_messaging.message_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_messaging_attachments_isolation
  ON platform_messaging.message_attachments
  USING (
    app_id    = current_setting('app.app_id', true)
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON platform_messaging.message_attachments
  TO svc_platform_messaging;
