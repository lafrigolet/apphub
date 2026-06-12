// Cada minuto: detecta los tenants de verifactu con trabajo de remisión
// pendiente — entradas de cola vencidas (pendiente/err con back-off cumplido) o
// registros (altas) que aún no se han encolado para su primer envío — y publica
// un tick `verifactu.remision.due` por tenant. El módulo platform/verifactu lo
// consume (remision-events.handler) y hace el envío real (cert mTLS + SOAP),
// porque la lógica pesada y las claves de cifrado viven allí, no en el scheduler.
//
// El advisory lock del job-runner evita ticks solapados; verifactu marca las
// filas 'enviando' al reclamarlas (FOR UPDATE SKIP LOCKED), así que un tick
// duplicado no produce doble envío.

export const meta = {
  name:        'verifactu-remision-retry',
  cron:        '* * * * *',
  description: 'Publish verifactu.remision.due for tenants with pending/retryable remissions',
}

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `SELECT app_id, tenant_id, sub_tenant_id FROM platform_verifactu.remision_queue
       WHERE estado IN ('pendiente','err') AND proximo_intento <= now()
     UNION
     SELECT r.app_id, r.tenant_id, r.sub_tenant_id FROM platform_verifactu.registros r
       WHERE NOT EXISTS (
         SELECT 1 FROM platform_verifactu.remision_queue q WHERE q.registro_id = r.id
       )`,
  )
  for (const t of rows) {
    await publish({
      type: 'verifactu.remision.due',
      payload: { appId: t.app_id, tenantId: t.tenant_id, subTenantId: t.sub_tenant_id ?? null },
    })
  }
  if (rows.length) logger.info({ tenants: rows.length }, 'verifactu remision ticks published')
  return { rowsAffected: rows.length }
}
