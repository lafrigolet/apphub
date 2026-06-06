const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, name, location, active,
  default_series_id, metadata, created_at, updated_at
`

export async function insert(client, d) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.tpv_devices
       (app_id, tenant_id, sub_tenant_id, name, location, default_series_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [d.appId, d.tenantId, d.subTenantId ?? null, d.name, d.location ?? null,
     d.defaultSeriesId ?? null, d.metadata ?? {}],
  )
  return rows[0]
}

export async function list(client, { active } = {}) {
  const conds = []
  const params = []
  if (active !== undefined) { params.push(active); conds.push(`active = $${params.length}`) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.tpv_devices ${where} ORDER BY name`,
    params,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.tpv_devices WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function update(client, id, patch) {
  const sets = []
  const params = [id]
  for (const [col, key] of [
    ['name', 'name'], ['location', 'location'],
    ['default_series_id', 'defaultSeriesId'], ['metadata', 'metadata'],
    ['active', 'active'],
  ]) {
    if (patch[key] !== undefined) {
      params.push(patch[key])
      sets.push(`${col} = $${params.length}`)
    }
  }
  if (!sets.length) return findById(client, id)
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.tpv_devices SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    params,
  )
  return rows[0] ?? null
}
