// Daily 05:00 — bound the notifications audit log. send_log accumulates one row
// per email/sms/push attempt; without a retention policy it grows unbounded.
// Deletes rows whose sent_at is older than NOTIFICATIONS_SEND_LOG_RETENTION_DAYS
// (default 90). Operates cross-tenant (BYPASSRLS); send_log has no RLS anyway.
import { env } from '../lib/env.js'

export const meta = {
  name:        'notification-send-log-purge',
  cron:        '0 5 * * *',
  description: 'Delete notification send_log rows past the retention window',
}

export async function run({ db, logger }) {
  const { rowCount } = await db.query(
    `DELETE FROM platform_notifications.send_log
      WHERE sent_at < now() - ($1 || ' days')::interval`,
    [env.NOTIFICATIONS_SEND_LOG_RETENTION_DAYS],
  )
  if (rowCount > 0) logger.info({ rowCount, retentionDays: env.NOTIFICATIONS_SEND_LOG_RETENTION_DAYS }, 'send_log purged by retention policy')
  return { rowsAffected: rowCount }
}
