// Repository for app_aikikan.videos. Llama desde withTenantTransaction
// con el contexto RLS ya seteado.

const TABLE = 'app_aikikan.videos'
const COLS  = `id, app_id, tenant_id, sub_tenant_id, youtube_id, label, name, position, created_at, updated_at`

export async function findAll(client) {
  const { rows } = await client.query(
    `SELECT ${COLS} FROM ${TABLE} ORDER BY position ASC, created_at ASC`,
  )
  return rows
}

export async function insert(client, { appId, tenantId, subTenantId, youtubeId, label, name }) {
  // Posición = max+1 al insertar — añade al final por defecto.
  const { rows } = await client.query(
    `INSERT INTO ${TABLE} (app_id, tenant_id, sub_tenant_id, youtube_id, label, name, position)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT MAX(position) FROM ${TABLE}) + 1, 1))
     RETURNING ${COLS}`,
    [appId, tenantId, subTenantId ?? null, youtubeId, label ?? null, name],
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
