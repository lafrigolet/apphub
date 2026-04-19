CREATE TABLE IF NOT EXISTS platform_notifications.send_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      TEXT NOT NULL,
  tenant_id   UUID NOT NULL,
  user_id     UUID,
  channel     TEXT NOT NULL,
  template    TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'sent',
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_notifications_tenant ON platform_notifications.send_log (tenant_id);
