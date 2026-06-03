// Daily — hard-delete chat messages older than each tenant's retention_days.
// Tenants opt in by setting platform_chat.settings.retention_days; tenants with
// NULL retention keep messages forever. Direct DELETE (scheduler has DELETE).

export const meta = {
  name:        'chat-retention-purge',
  cron:        '30 3 * * *',
  description: 'Delete chat messages past each tenant\'s retention window',
}

export async function run({ db, logger }) {
  const { rowCount } = await db.query(
    `DELETE FROM platform_chat.messages m
       USING platform_chat.settings s
      WHERE s.app_id = m.app_id
        AND s.tenant_id = m.tenant_id
        AND s.retention_days IS NOT NULL
        AND m.created_at < now() - (s.retention_days || ' days')::interval`,
  )
  if (rowCount > 0) logger.info({ rowCount }, 'chat messages purged by retention policy')
  return { rowsAffected: rowCount }
}
