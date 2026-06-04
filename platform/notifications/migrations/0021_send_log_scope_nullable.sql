-- send_log se escribe ahora desde los senders (email/sms/push). Muchos envíos
-- son de ámbito plataforma (alertas a staff, leads pre-tenant) o salen de
-- helpers que aún no reciben tenant context — app_id/tenant_id pasan a ser
-- nullable. El contexto completo llega con el refactor tenant-aware del
-- pipeline de envío (TODO-resend).
ALTER TABLE platform_notifications.send_log ALTER COLUMN app_id    DROP NOT NULL;
ALTER TABLE platform_notifications.send_log ALTER COLUMN tenant_id DROP NOT NULL;

-- status pasa de texto libre a vocabulario cerrado.
ALTER TABLE platform_notifications.send_log
  ADD CONSTRAINT send_log_status_check
  CHECK (status IN ('sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_platform_notifications_send_log_sent_at
  ON platform_notifications.send_log (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_notifications_send_log_template
  ON platform_notifications.send_log (template, sent_at DESC);
