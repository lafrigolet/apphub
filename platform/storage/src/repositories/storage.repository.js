const SCHEMA = 'platform_storage'

export async function insert(client, appId, tenantId, o) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.objects
       (app_id, tenant_id, sub_tenant_id, owner_user_id, kind, bucket, key,
        filename, content_type, size_bytes, retention_until, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'pending'),COALESCE($13,'{}'::jsonb))
     RETURNING *`,
    [
      appId, tenantId, o.subTenantId ?? null, o.ownerUserId,
      o.kind, o.bucket, o.key,
      o.filename ?? null, o.contentType ?? null, o.sizeBytes ?? null,
      o.retentionUntil ?? null, o.status ?? 'pending', o.metadata ?? {},
    ],
  )
  return rows[0]
}

export async function findById(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.objects WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

export async function listByTenant(client, appId, tenantId, { kind, ownerUserId, status, limit = 100 } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (kind)        { filters.push(`kind = $${params.length + 1}`);          params.push(kind) }
  if (ownerUserId) { filters.push(`owner_user_id = $${params.length + 1}`); params.push(ownerUserId) }
  if (status)      { filters.push(`status = $${params.length + 1}`);        params.push(status) }
  params.push(limit)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.objects WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function markUploaded(client, appId, tenantId, id, { sizeBytes, sha256 }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.objects
     SET status='uploaded', finalized_at=now(),
         size_bytes=COALESCE($4, size_bytes),
         sha256=COALESCE($5, sha256)
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id, sizeBytes ?? null, sha256 ?? null],
  )
  return rows[0] ?? null
}

export async function softDelete(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.objects
     SET status='deleted', deleted_at=now()
     WHERE app_id=$1 AND tenant_id=$2 AND id=$3 RETURNING *`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}
