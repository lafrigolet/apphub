// Daily at 08:00 — emit T-30d and T-7d warnings for active packages with
// remaining sessions. Idempotency via warning_30d_sent_at / warning_7d_sent_at.

export const meta = {
  name:        'package-expiry-warning',
  cron:        '0 8 * * *',
  description: 'Daily T-30d / T-7d expiry warnings for active packages',
}

const WINDOWS = [
  { offsetDays: 30, column: 'warning_30d_sent_at', label: 't_minus_30d' },
  { offsetDays: 7,  column: 'warning_7d_sent_at',  label: 't_minus_7d'  },
]

export async function run({ db, publish, logger }) {
  let total = 0
  for (const w of WINDOWS) {
    const { rows } = await db.query(
      `UPDATE platform_packages.purchased_packages
       SET ${w.column} = now()
       WHERE status = 'active'
         AND remaining_sessions > 0
         AND ${w.column} IS NULL
         AND expires_at BETWEEN now() AND now() + ($1 || ' days')::interval
       RETURNING id, app_id, tenant_id, client_user_id, service_id,
                 remaining_sessions, total_sessions, expires_at`,
      [String(w.offsetDays)],
    )
    for (const p of rows) {
      await publish({
        type: 'package.expiring',
        payload: {
          appId:             p.app_id,
          tenantId:          p.tenant_id,
          packageId:         p.id,
          clientUserId:      p.client_user_id,
          serviceId:         p.service_id,
          remainingSessions: p.remaining_sessions,
          totalSessions:     p.total_sessions,
          expiresAt:         p.expires_at,
          window:            w.label,
        },
      })
    }
    total += rows.length
    if (rows.length) logger.info({ window: w.label, count: rows.length }, 'expiry warnings published')
  }
  return { rowsAffected: total }
}
