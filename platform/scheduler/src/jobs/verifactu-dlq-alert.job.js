// Cada hora: por cada tenant con registros de remisión en la DLQ (agotados los
// reintentos), publica `verifactu.remision.dlq_alert` con el recuento. Un
// consumidor (p.ej. platform/notifications) puede avisar a staff. Sólo lectura
// sobre la cola; no muta nada (el reintento es manual vía POST /dlq/:id/reintentar).

export const meta = {
  name:        'verifactu-dlq-alert',
  cron:        '0 * * * *',
  description: 'Publish verifactu.remision.dlq_alert for tenants with dead-lettered remissions',
}

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `SELECT app_id, tenant_id, COUNT(*)::int AS n
       FROM platform_verifactu.remision_queue
      WHERE estado = 'dlq'
      GROUP BY app_id, tenant_id`,
  )
  for (const t of rows) {
    await publish({
      type: 'verifactu.remision.dlq_alert',
      payload: { appId: t.app_id, tenantId: t.tenant_id, enDlq: t.n },
    })
  }
  if (rows.length) logger.info({ tenants: rows.length }, 'verifactu DLQ alerts published')
  return { rowsAffected: rows.length }
}
