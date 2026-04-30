// Every minute, delete expired holds from platform_availability.holds.
// Today availability.service.js purges opportunistically inside holdSlot, but
// idle resources still accumulate stale holds. This makes purge proactive and
// keeps slot listings honest.

export const meta = {
  name:        'availability-hold-purge',
  cron:        '* * * * *',
  description: 'Delete expired holds from platform_availability.holds',
}

export async function run({ db, logger }) {
  const { rowCount } = await db.query(
    `DELETE FROM platform_availability.holds WHERE expires_at <= now()`,
  )
  if (rowCount > 0) logger.info({ rowCount }, 'expired holds purged')
  return { rowsAffected: rowCount }
}
