CREATE TABLE IF NOT EXISTS yoga_notifications.send_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  template    VARCHAR(100),
  channel     VARCHAR(20) NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'push', 'sms')),
  status      VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced')),
  error_msg   TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yoga_notif_log_user   ON yoga_notifications.send_log (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_yoga_notif_log_status ON yoga_notifications.send_log (status) WHERE status != 'sent';
