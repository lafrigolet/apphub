const SCHEMA = 'platform_tpv'

const COLUMNS = `
  id, app_id, tenant_id, sub_tenant_id, code, kind, prefix, next_number,
  device_id, active, created_at, updated_at
`

export async function insert(client, s) {
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.number_series
       (app_id, tenant_id, sub_tenant_id, code, kind, prefix, device_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [s.appId, s.tenantId, s.subTenantId ?? null, s.code, s.kind,
     s.prefix ?? '', s.deviceId ?? null],
  )
  return rows[0]
}

export async function list(client, { kind, active } = {}) {
  const conds = []
  const params = []
  if (kind)               { params.push(kind);   conds.push(`kind = $${params.length}`) }
  if (active !== undefined) { params.push(active); conds.push(`active = $${params.length}`) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.number_series ${where} ORDER BY code`,
    params,
  )
  return rows
}

export async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.number_series WHERE id = $1 LIMIT 1`, [id],
  )
  return rows[0] ?? null
}

export async function findByCode(client, code) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.number_series WHERE code = $1 AND active LIMIT 1`, [code],
  )
  return rows[0] ?? null
}

// Variante con scope explícito para handlers bajo staff bypass.
export async function findByCodeExplicit(client, appId, tenantId, code) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM ${SCHEMA}.number_series
      WHERE app_id = $1 AND tenant_id = $2 AND code = $3 AND active LIMIT 1`,
    [appId, tenantId, code],
  )
  return rows[0] ?? null
}

// Consume el siguiente correlativo de la serie. DEBE llamarse dentro de la
// misma transacción que inserta el documento: el lock de fila del UPDATE
// serializa emisiones concurrentes y un ROLLBACK devuelve el número — el
// correlativo no tiene huecos por diseño (requisito fiscal, ADR 015).
export async function consumeNextNumber(client, seriesId) {
  const { rows } = await client.query(
    `UPDATE ${SCHEMA}.number_series
        SET next_number = next_number + 1, updated_at = now()
      WHERE id = $1 AND active
      RETURNING next_number - 1 AS number, code, prefix`,
    [seriesId],
  )
  return rows[0] ?? null
}
