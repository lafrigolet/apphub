// Daily 03:30 — delete expired single-use auth tokens that the auth module
// issues but never garbage-collects (password resets, owner-activation magic
// links, passwordless magic links). Each table carries an expires_at; once
// past it the row is useless and only widens the dump surface. One DELETE per
// table so a failure on one doesn't mask the others' rowcounts. The scheduler
// role has BYPASSRLS, so the RLS on activation_tokens / magic_links is bypassed
// and the purge is cross-tenant in a single statement.

export const meta = {
  name:        'auth-token-purge',
  cron:        '30 3 * * *',
  description: 'Delete expired auth tokens (password resets, magic links, activation tokens)',
}

const TABLES = ['password_resets', 'magic_links', 'activation_tokens']

export async function run({ db, logger }) {
  let total = 0
  for (const table of TABLES) {
    const { rowCount } = await db.query(
      `DELETE FROM platform_auth.${table} WHERE expires_at < now()`,
    )
    total += rowCount
    if (rowCount > 0) logger.info({ table, rowCount }, 'expired auth tokens purged')
  }
  return { rowsAffected: total }
}
