// Daily 04:00 — keep the audit table bounded. Without this the runs table grows
// without limit (high-frequency jobs like availability-hold-purge and the chat
// minute-jobs each add ~1440 rows/day). Deletes runs whose started_at is older
// than SCHEDULER_RUNS_RETENTION_DAYS (default 90). Operates on the scheduler's
// OWN schema — no cross-schema grant needed.
import { env } from '../lib/env.js'

export const meta = {
  name:        'scheduler-runs-purge',
  cron:        '0 4 * * *',
  description: 'Delete scheduler run-history rows past the retention window',
}

export async function run({ db, logger }) {
  const { rowCount } = await db.query(
    `DELETE FROM platform_scheduler.runs
      WHERE started_at < now() - ($1 || ' days')::interval`,
    [env.SCHEDULER_RUNS_RETENTION_DAYS],
  )
  if (rowCount > 0) logger.info({ rowCount, retentionDays: env.SCHEDULER_RUNS_RETENTION_DAYS }, 'scheduler runs purged by retention policy')
  return { rowsAffected: rowCount }
}
