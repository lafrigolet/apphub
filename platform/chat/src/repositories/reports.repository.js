const SCHEMA = 'platform_chat'

const COLS = `
  id, app_id, tenant_id, target_type, target_id, target_user_id, reporter_user_id,
  reason, status, created_at, updated_at
`

export async function insert(client, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.reports
       (app_id, tenant_id, target_type, target_id, target_user_id, reporter_user_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING ${COLS}`,
    [r.appId, r.tenantId, r.targetType, r.targetId, r.targetUserId ?? null, r.reporterUserId, r.reason ?? null],
  )
  return rows[0]
}

// Report history for a single reported user: the rows plus a total count.
// Used by staff to spot repeat offenders. Scoped to the tenant by RLS.
export async function listForTargetUser(client, targetUserId, { limit = 100 } = {}) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.reports
      WHERE target_user_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [targetUserId, limit],
  )
  const { rows: counts } = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open
       FROM ${SCHEMA}.reports WHERE target_user_id = $1`,
    [targetUserId],
  )
  return { total: counts[0].total, open: counts[0].open, reports: rows }
}

export async function list(client, { status, limit = 100 } = {}) {
  const filters = []
  const params = []
  if (status) { params.push(status); filters.push(`status = $${params.length}`) }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  params.push(limit)
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${SCHEMA}.reports ${where}
      ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return rows
}

export async function updateStatus(client, id, status) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.reports SET status = $2 WHERE id = $1 RETURNING ${COLS}`,
    [id, status],
  )
  return rows[0] ?? null
}
