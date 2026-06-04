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

// Cursor pagination: ordered by (created_at DESC, id DESC). `cursor` is the
// opaque "{createdAtISO}|{id}" of the last row of the previous page; rows
// strictly older than it are returned. We fetch limit+1 to know if there's
// another page, then trim. Returns { items, nextCursor }.
export async function listByTenant(client, appId, tenantId, { kind, ownerUserId, status, limit = 100, cursor } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (kind)        { filters.push(`kind = $${params.length + 1}`);          params.push(kind) }
  if (ownerUserId) { filters.push(`owner_user_id = $${params.length + 1}`); params.push(ownerUserId) }
  if (status)      { filters.push(`status = $${params.length + 1}`);        params.push(status) }
  if (cursor) {
    const sep = cursor.lastIndexOf('|')
    const createdAt = cursor.slice(0, sep)
    const id        = cursor.slice(sep + 1)
    filters.push(`(created_at, id) < ($${params.length + 1}::timestamptz, $${params.length + 2}::uuid)`)
    params.push(createdAt, id)
  }
  params.push(limit + 1)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.objects WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  )
  let nextCursor = null
  if (rows.length > limit) {
    rows.pop()
    const last = rows[rows.length - 1]
    nextCursor = `${new Date(last.created_at).toISOString()}|${last.id}`
  }
  return { items: rows, nextCursor }
}

// Aggregate usage: total bytes + object count of uploaded objects for a tenant.
export async function usageByTenant(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS bytes_used, COUNT(*)::int AS object_count
       FROM ${SCHEMA}.objects
      WHERE app_id = $1 AND tenant_id = $2 AND status = 'uploaded'`,
    [appId, tenantId],
  )
  return { bytesUsed: Number(rows[0].bytes_used), objectCount: rows[0].object_count }
}

export async function getQuota(client, appId, tenantId) {
  const { rows } = await client.query(
    `SELECT max_bytes FROM ${SCHEMA}.quotas WHERE app_id = $1 AND tenant_id = $2`,
    [appId, tenantId],
  )
  return rows[0] ? Number(rows[0].max_bytes) : null
}

export async function upsertQuota(client, appId, tenantId, maxBytes) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.quotas (app_id, tenant_id, max_bytes)
     VALUES ($1, $2, $3)
     ON CONFLICT (app_id, tenant_id)
       DO UPDATE SET max_bytes = EXCLUDED.max_bytes, updated_at = now()
     RETURNING max_bytes`,
    [appId, tenantId, maxBytes],
  )
  return Number(rows[0].max_bytes)
}

// Restore a soft-deleted object back to 'uploaded' (only meaningful before a
// hard-delete physically removed the bytes).
export async function restore(client, appId, tenantId, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.objects
        SET status = 'uploaded', deleted_at = NULL
      WHERE app_id = $1 AND tenant_id = $2 AND id = $3 AND status = 'deleted'
      RETURNING *`,
    [appId, tenantId, id],
  )
  return rows[0] ?? null
}

// Physically remove the metadata row once the bytes have been hard-deleted
// from the bucket. Used by the hard-delete path.
export async function purgeRow(client, appId, tenantId, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${SCHEMA}.objects WHERE app_id = $1 AND tenant_id = $2 AND id = $3`,
    [appId, tenantId, id],
  )
  return rowCount > 0
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

// ── access log (download audit) ────────────────────────────────────────
// Append a download access record. Tenant-scoped; never crosses tenants.
export async function insertAccessLog(client, appId, tenantId, a) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.access_log
       (app_id, tenant_id, object_id, kind, action, user_id, ip, user_agent)
     VALUES ($1,$2,$3,$4,COALESCE($5,'download'),$6,$7,$8)
     RETURNING *`,
    [
      appId, tenantId, a.objectId, a.kind ?? null, a.action ?? 'download',
      a.userId ?? null, a.ip ?? null, a.userAgent ?? null,
    ],
  )
  return rows[0]
}

// Cursor-paginated access log for a tenant, optionally filtered to one object.
// Same (created_at DESC, id DESC) cursor contract as listByTenant.
export async function listAccessLog(client, appId, tenantId, { objectId, limit = 100, cursor } = {}) {
  const filters = ['app_id = $1', 'tenant_id = $2']
  const params  = [appId, tenantId]
  if (objectId) { filters.push(`object_id = $${params.length + 1}`); params.push(objectId) }
  if (cursor) {
    const sep = cursor.lastIndexOf('|')
    filters.push(`(created_at, id) < ($${params.length + 1}::timestamptz, $${params.length + 2}::uuid)`)
    params.push(cursor.slice(0, sep), cursor.slice(sep + 1))
  }
  params.push(limit + 1)
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.access_log WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  )
  let nextCursor = null
  if (rows.length > limit) {
    rows.pop()
    const last = rows[rows.length - 1]
    nextCursor = `${new Date(last.created_at).toISOString()}|${last.id}`
  }
  return { items: rows, nextCursor }
}

// ── retention helpers ──────────────────────────────────────────────────
// Live (pending|uploaded) objects whose retention_until has passed — these are
// the candidates the retention-purge sweep should hard-delete.
export async function findExpired(client, appId, tenantId, { limit = 500 } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.objects
      WHERE app_id = $1 AND tenant_id = $2
        AND retention_until IS NOT NULL AND retention_until <= now()
        AND status IN ('pending','uploaded','deleted')
      ORDER BY retention_until ASC
      LIMIT $3`,
    [appId, tenantId, limit],
  )
  return rows
}

// Uploaded objects whose retention_until falls within `windowDays` from now —
// used to publish storage.object.expiring_soon so owners can archive in time.
export async function findExpiringSoon(client, appId, tenantId, { windowDays = 30, limit = 1000 } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM ${SCHEMA}.objects
      WHERE app_id = $1 AND tenant_id = $2
        AND status = 'uploaded'
        AND retention_until IS NOT NULL
        AND retention_until > now()
        AND retention_until <= now() + ($3 || ' days')::interval
      ORDER BY retention_until ASC
      LIMIT $4`,
    [appId, tenantId, String(windowDays), limit],
  )
  return rows
}
