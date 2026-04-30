// Daily 03:15: soft-delete uploaded objects whose retention_until has passed.
// Publishes storage.object.deleted so module clients can clear their refs
// (e.g. set photo_object_id = NULL on a menu_item).

export const meta = {
  name:        'storage-retention-purge',
  cron:        '15 3 * * *',
  description: 'Soft-delete uploaded objects past their retention_until',
}

export async function run({ db, publish, logger }) {
  const { rows } = await db.query(
    `UPDATE platform_storage.objects
     SET status = 'deleted', deleted_at = now()
     WHERE status = 'uploaded'
       AND retention_until IS NOT NULL
       AND retention_until <= now()
     RETURNING id, app_id, tenant_id, kind, bucket, key`,
  )
  for (const o of rows) {
    await publish({
      type: 'storage.object.deleted',
      payload: {
        appId:     o.app_id,
        tenantId:  o.tenant_id,
        objectId:  o.id,
        kind:      o.kind,
        reason:    'retention_expired',
      },
    })
  }
  if (rows.length) logger.info({ rowCount: rows.length }, 'retention-expired objects soft-deleted')
  return { rowsAffected: rows.length }
}
