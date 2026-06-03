// Every minute — soft-delete ephemeral chat messages whose TTL has expired.
// The body is cleared (tombstone) so it stops being served; row stays for
// referential integrity (replies/threads). Direct UPDATE — no event needed.

export const meta = {
  name:        'chat-ephemeral-purge',
  cron:        '* * * * *',
  description: 'Soft-delete expired ephemeral chat messages',
}

export async function run({ db, logger }) {
  const { rowCount } = await db.query(
    `UPDATE platform_chat.messages
        SET deleted_at = now(), body = NULL
      WHERE expires_at IS NOT NULL
        AND expires_at <= now()
        AND deleted_at IS NULL`,
  )
  if (rowCount > 0) logger.info({ rowCount }, 'ephemeral chat messages purged')
  return { rowsAffected: rowCount }
}
