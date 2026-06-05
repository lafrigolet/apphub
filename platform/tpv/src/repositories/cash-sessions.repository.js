const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, device_id, status, opened_by, closed_by,
  opening_float_cents, declared_close, theoretical_close, variance_cents,
  variance_reason, opened_at, closed_at, created_at, updated_at
`

export async function insert(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.cash_sessions
       (app_id, tenant_id, sub_tenant_id, device_id, opened_by, opening_float_cents)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [s.appId, s.tenantId, s.subTenantId ?? null, s.deviceId, s.openedBy, s.openingFloatCents ?? 0],
  )
  return rows[0]
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.cash_sessions WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function findOpenByDevice(client, deviceId) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.cash_sessions
      WHERE device_id = $1 AND status = 'open' LIMIT 1`,
    [deviceId],
  )
  return rows[0] ?? null
}

export async function list(client, { deviceId, status, from, to, limit = 100, offset = 0 } = {}) {
  const conds = []
  const params = []
  if (deviceId) { params.push(deviceId); conds.push(`device_id = $${params.length}`) }
  if (status)   { params.push(status);   conds.push(`status = $${params.length}`) }
  if (from)     { params.push(from);     conds.push(`opened_at >= $${params.length}`) }
  if (to)       { params.push(to);       conds.push(`opened_at <= $${params.length}`) }
  params.push(limit, offset)
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.cash_sessions ${where}
     ORDER BY opened_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows
}

export async function close(client, id, { closedBy, declaredClose, theoreticalClose, varianceCents, varianceReason, status = 'closed' }) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.cash_sessions
        SET status = $2, closed_by = $3, declared_close = $4, theoretical_close = $5,
            variance_cents = $6, variance_reason = $7, closed_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING ${COLUMNS}`,
    [id, status, closedBy ?? null, JSON.stringify(declaredClose ?? null),
     JSON.stringify(theoreticalClose ?? null), varianceCents ?? null, varianceReason ?? null],
  )
  return rows[0] ?? null
}

// reopenedBy queda auditado vía el evento tpv.session.reopened.
export async function reopen(client, id) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.cash_sessions
        SET status = 'open', closed_by = NULL, declared_close = NULL,
            theoretical_close = NULL, variance_cents = NULL, variance_reason = NULL,
            closed_at = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('closed', 'force_closed')
      RETURNING ${COLUMNS}`,
    [id],
  )
  return rows[0] ?? null
}
