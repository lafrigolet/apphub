const TABLE = 'app_aikikan.dojos'
const COLS  = `id, app_id, tenant_id, sub_tenant_id, name, city, province, address, sensei, phone, email, web, position, created_at, updated_at`

export async function findAll(client) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${TABLE} ORDER BY position ASC, created_at ASC`,
  )
  return rows
}

export async function insert(client, { appId, tenantId, subTenantId, name, city, province, address, sensei, phone, email, web }) {
  const { rows } = await client.query(
    `INSERT INTO ${TABLE} (app_id, tenant_id, sub_tenant_id, name, city, province, address, sensei, phone, email, web, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE((SELECT MAX(position) FROM ${TABLE}) + 1, 1))
     RETURNING ${COLS}`,
    [appId, tenantId, subTenantId ?? null, name, city, province, address ?? null, sensei ?? null, phone ?? null, email ?? null, web ?? null],
  )
  return rows[0]
}

export async function deleteById(client, id) {
  const { rowCount } = await client.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id])
  return rowCount > 0
}
