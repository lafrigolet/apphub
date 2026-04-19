ALTER TABLE yoga_notifications.send_log
  ADD COLUMN IF NOT EXISTS tenant_id     UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  ADD COLUMN IF NOT EXISTS sub_tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_yoga_notif_log_tenant ON yoga_notifications.send_log (tenant_id);

ALTER TABLE yoga_notifications.send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoga_notifications.send_log FORCE ROW LEVEL SECURITY;
CREATE POLICY yoga_notif_log_tenant_isolation ON yoga_notifications.send_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
