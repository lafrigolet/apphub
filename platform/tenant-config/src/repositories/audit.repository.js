const COLUMNS = `id, ts, actor_user_id, actor_role, app_id, tenant_id, action, detail, ip`

export async function insert(client, { actorUserId, actorRole, appId, tenantId, action, detail, ip }) {
  const { rows } = await client.query(
    `INSERT INTO platform_tenants.audit_log
       (actor_user_id, actor_role, app_id, tenant_id, action, detail, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [actorUserId ?? null, actorRole ?? null, appId, tenantId ?? null, action, detail ?? null, ip ?? null],
  )
  return rows[0]
}

// Cursor pagination (#10): `before` is the `ts` of the last row of the
// previous page (keyset). Passing it returns the next page of older rows.
// Cheaper and stable under inserts vs OFFSET. Existing callers omit it and
// get the first page unchanged.
export async function list(client, { appId, tenantId, limit = 100, before } = {}) {
  const conditions = []
  const values = []
  let idx = 1
  if (appId)    { conditions.push(`app_id = $${idx++}`);    values.push(appId) }
  if (tenantId) { conditions.push(`tenant_id = $${idx++}`); values.push(tenantId) }
  if (before)   { conditions.push(`ts < $${idx++}`);        values.push(before) }
  values.push(Math.min(Math.max(Number(limit) || 100, 1), 1000))
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM platform_tenants.audit_log
     ${where}
     ORDER BY ts DESC
     LIMIT $${idx}`,
    values,
  )
  return rows
}
