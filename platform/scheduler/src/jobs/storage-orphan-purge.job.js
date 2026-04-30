// Hourly: delete pending storage rows that have lingered > 1h. These are
// uploads where the client got a presigned URL but never finalized — either
// they crashed, abandoned the form, or the upload failed silently.
// V1 deletes only the DB row; orphan bytes in MinIO are reaped by S3
// lifecycle policy (out of scope V1).

export const meta = {
  name:        'storage-orphan-purge',
  cron:        '0 * * * *',
  description: 'Delete pending storage objects > 1 hour old',
}

export async function run({ db, logger }) {
  const { rowCount } = await db.query(
    `DELETE FROM platform_storage.objects
     WHERE status = 'pending' AND created_at < now() - interval '1 hour'`,
  )
  if (rowCount > 0) logger.info({ rowCount }, 'orphan pending storage objects purged')
  return { rowsAffected: rowCount }
}
