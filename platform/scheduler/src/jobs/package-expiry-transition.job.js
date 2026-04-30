// Daily at 00:30 — flip packages with expires_at <= now() and status='active'
// into status='expired' and publish package.expired so notifications and
// downstream apps can react.

export const meta = {
  name:        'package-expiry-transition',
  cron:        '30 0 * * *',
  description: 'Daily transition of active → expired packages',
}

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `UPDATE platform_packages.purchased_packages
     SET status = 'expired'
     WHERE status = 'active' AND expires_at <= now()
     RETURNING id, app_id, tenant_id, client_user_id, service_id,
               remaining_sessions, expires_at`,
  )
  for (const p of rows) {
    await publish({
      type: 'package.expired',
      payload: {
        appId:             p.app_id,
        tenantId:          p.tenant_id,
        packageId:         p.id,
        clientUserId:      p.client_user_id,
        serviceId:         p.service_id,
        remainingSessions: p.remaining_sessions,
        expiresAt:         p.expires_at,
      },
    })
  }
  if (rows.length) logger.info({ count: rows.length }, 'packages expired')
  return { rowsAffected: rows.length }
}
