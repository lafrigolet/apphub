// Repository for app_aikikan.events. Llama desde withTenantTransaction
// con el contexto RLS ya seteado, así que las queries no filtran
// app_id/tenant_id explícitamente — RLS lo hace por nosotros.

const TABLE = 'app_aikikan.events'
const COLS  = `id, app_id, tenant_id, sub_tenant_id, date, name, location, created_at, updated_at`

export async function findAll(client) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${TABLE} ORDER BY date ASC`,
  )
  return rows
}

export async function insert(client, { appId, tenantId, subTenantId, date, name, location }) {
  const { rows } = await client.query(
    `INSERT INTO ${TABLE} (app_id, tenant_id, sub_tenant_id, date, name, location)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLS}`,
    [appId, tenantId, subTenantId ?? null, date, name, location ?? null],
  )
  return rows[0]
}

export async function deleteById(client, id) {
  const { rowCount } = await client.query(
    `DELETE FROM ${TABLE} WHERE id = $1`,
    [id],
  )
  return rowCount > 0
}
