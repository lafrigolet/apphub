const SCHEMA = 'platform_chat'

const COLS = `
  id, app_id, tenant_id, target_type, target_id, reporter_user_id,
  reason, status, created_at, updated_at
`

export async function insert(client, r) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.reports
       (app_id, tenant_id, target_type, target_id, reporter_user_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${COLS}`,
    [r.appId, r.tenantId, r.targetType, r.targetId, r.reporterUserId, r.reason ?? null],
  )
  return rows[0]
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
