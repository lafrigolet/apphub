// Daily 05:15 — GDPR/retention purge for inbound email (notifications §29).
// The scheduler doesn't touch S3 (same philosophy as storage-retention-purge):
// it computes the effective retention window and publishes
// `notifications.inbound.purge_due`; platform/notifications — which already
// holds the S3 client for inbound attachments — deletes rows, stored objects
// and expired reply tokens.
//
// Retention precedence: platform_notifications.config row 'inbound_retention_days'
// (staff-editable at runtime) → NOTIFICATIONS_INBOUND_RETENTION_DAYS env (365).
import { env } from '../lib/env.js'

export const meta = {
  name:        'notifications-inbound-purge',
  cron:        '15 5 * * *',
  description: 'Trigger retention purge of inbound emails + attachments + expired reply tokens',
}

export async function run({ db, publish, logger }) {
  let retentionDays = env.NOTIFICATIONS_INBOUND_RETENTION_DAYS
  const { rows } = await db.query(
    `SELECT plain_value FROM platform_notifications.config WHERE key = 'inbound_retention_days'`,
  )
  const override = Number(rows[0]?.plain_value)
  if (Number.isFinite(override) && override > 0) retentionDays = override

  await publish({
    type: 'notifications.inbound.purge_due',
    payload: { retentionDays },
  })
  logger.info({ retentionDays }, 'inbound purge event published')
  return { rowsAffected: 0, metadata: { retentionDays } }
}
