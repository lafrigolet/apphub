// Daily — GDPR retention: hard-delete closed leads (won/lost/closed) whose
// last touch is older than LEADS_RETENTION_DAYS (default 1095 = 3 años).
// Open leads (new/contacted/qualified) are never purged — they represent
// conversaciones aún vivas. lead_activities cae por ON DELETE CASCADE.
import { env } from '../lib/env.js'

export const meta = {
  name:        'lead-retention-purge',
  cron:        '45 4 * * *',
  description: 'Delete closed leads past the GDPR retention window',
}

export async function run({ db, logger }) {
  const { rowCount } = await db.query(
    `DELETE FROM platform_leads.leads
      WHERE status IN ('won', 'lost', 'closed')
        AND updated_at < now() - ($1 || ' days')::interval`,
    [env.LEADS_RETENTION_DAYS],
  )
  if (rowCount > 0) logger.info({ rowCount, retentionDays: env.LEADS_RETENTION_DAYS }, 'leads purged by retention policy')
  return { rowsAffected: rowCount }
}
